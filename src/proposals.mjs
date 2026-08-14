import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizeApiPath } from './client.mjs';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isWriteMethod(method) {
  return WRITE_METHODS.has(String(method || '').toUpperCase());
}

export function proposalDigest(proposal) {
  const canonical = JSON.stringify({
    version: proposal.version,
    storeHash: proposal.storeHash,
    method: proposal.method,
    path: proposal.path,
    query: proposal.query || {},
    body: proposal.body ?? null,
    reason: proposal.reason,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function createProposal({ storeHash, method, apiPath, query = {}, body, reason }) {
  const normalizedMethod = String(method || '').toUpperCase();
  if (!isWriteMethod(normalizedMethod)) throw new Error('Proposals are only required for write methods.');
  if (!String(reason || '').trim()) throw new Error('A concrete reason is required for a write proposal.');
  const proposal = {
    version: 1,
    createdAt: new Date().toISOString(),
    storeHash: String(storeHash || '').trim(),
    method: normalizedMethod,
    path: normalizeApiPath(apiPath),
    query,
    body: body ?? null,
    reason: String(reason).trim(),
  };
  proposal.digest = proposalDigest(proposal);
  return proposal;
}

function requireBaseDir(baseDir) {
  if (!String(baseDir || '').trim()) throw new Error('A configured proposals directory is required.');
  return path.resolve(baseDir);
}

function resolveRelativePath(baseDir, inputPath) {
  const input = String(inputPath || '').trim();
  if (!input || path.isAbsolute(input)) throw new Error('Proposal paths must be relative to the configured proposals directory.');
  const base = requireBaseDir(baseDir);
  const resolved = path.resolve(base, input);
  if (resolved === base || !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error('Proposal path escapes the configured proposals directory.');
  }
  return { base, resolved };
}

async function realBaseDir(baseDir) {
  await fs.mkdir(baseDir, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(baseDir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Configured proposals directory must be a real directory.');
  return fs.realpath(baseDir);
}

export function approvalCodeFor(proposal, approvalSecret) {
  const secret = String(approvalSecret || '');
  if (secret.length < 32) throw new Error('BIGCOMMERCE_APPROVAL_SECRET must contain at least 32 characters.');
  return crypto.createHmac('sha256', secret).update(proposalDigest(proposal)).digest('hex').slice(0, 16);
}

export async function saveProposal(proposal, outputPath, baseDir) {
  const { base, resolved } = resolveRelativePath(baseDir, outputPath);
  const realBase = await realBaseDir(base);
  await fs.mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const realParent = await fs.realpath(path.dirname(resolved));
  if (realParent !== realBase && !realParent.startsWith(`${realBase}${path.sep}`)) {
    throw new Error('Proposal path resolves outside the configured proposals directory.');
  }
  const handle = await fs.open(resolved, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(proposal, null, 2)}\n`);
  } finally {
    await handle.close();
  }
  return resolved;
}

export async function loadProposal(inputPath, baseDir) {
  const { base, resolved } = resolveRelativePath(baseDir, inputPath);
  const realBase = await realBaseDir(base);
  const stat = await fs.lstat(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Proposal must be a regular file, not a symlink.');
  const realResolved = await fs.realpath(resolved);
  if (!realResolved.startsWith(`${realBase}${path.sep}`)) {
    throw new Error('Proposal path resolves outside the configured proposals directory.');
  }
  const proposal = JSON.parse(await fs.readFile(resolved, 'utf8'));
  const expected = proposalDigest(proposal);
  if (proposal.digest !== expected) throw new Error('Proposal integrity check failed.');
  return { proposal, resolved };
}

export async function applyProposal(client, proposal, approvalCode, approvalSecret) {
  const expected = approvalCodeFor(proposal, approvalSecret);
  const supplied = String(approvalCode || '');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    throw new Error('Approval code does not match the proposal.');
  }
  if (client.storeHash !== proposal.storeHash) {
    throw new Error('Proposal store hash does not match the configured store.');
  }
  const before = await captureSnapshot(client, proposal);
  const mutation = await client.request(proposal.path, {
    method: proposal.method,
    query: proposal.query,
    body: proposal.body,
  });
  const after = await captureSnapshot(client, proposal);
  return { mutation, snapshots: { before, after } };
}

async function captureSnapshot(client, proposal) {
  try {
    return {
      captured: true,
      response: await client.request(proposal.path, {
        method: 'GET',
        query: proposal.query,
      }),
    };
  } catch (error) {
    return {
      captured: false,
      error: {
        message: error.message,
        status: error.status || null,
      },
    };
  }
}

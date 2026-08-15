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

export async function applySavedProposal(client, inputPath, baseDir, approvalCode, approvalSecret) {
  const { proposal, resolved } = await loadProposal(inputPath, baseDir);
  const response = await applyProposal(client, proposal, approvalCode, approvalSecret, resolved);
  return { proposalPath: resolved, response };
}

async function applyProposal(client, proposal, approvalCode, approvalSecret, proposalPath) {
  if (proposal.digest !== proposalDigest(proposal)) throw new Error('Proposal integrity check failed.');
  const expected = approvalCodeFor(proposal, approvalSecret);
  const supplied = Buffer.from(String(approvalCode || ''));
  const expectedBuffer = Buffer.from(expected);
  if (supplied.length !== expectedBuffer.length || !crypto.timingSafeEqual(supplied, expectedBuffer)) {
    throw new Error('Approval code does not match the proposal.');
  }
  if (client.storeHash !== proposal.storeHash) {
    throw new Error('Proposal store hash does not match the configured store.');
  }
  const auditPaths = await claimProposalApplication(proposalPath, proposal);
  const before = await captureSnapshot(client, proposal);
  try {
    const mutation = await client.request(proposal.path, {
      method: proposal.method,
      query: proposal.query,
      body: proposal.body,
    });
    const after = await captureSnapshot(client, proposal);
    const result = { mutation, snapshots: { before, after } };
    await finalizeProposalApplication(auditPaths, {
      status: 'applied',
      proposalDigest: proposal.digest,
      proposal: auditProposal(proposal),
      appliedAt: new Date().toISOString(),
      ...result,
    });
    return result;
  } catch (error) {
    await finalizeProposalApplication(auditPaths, {
      status: 'failed-or-uncertain',
      proposalDigest: proposal.digest,
      proposal: auditProposal(proposal),
      appliedAt: new Date().toISOString(),
      snapshots: { before, after: null },
      error: { message: error.message, status: error.status || null },
    });
    throw error;
  }
}

async function claimProposalApplication(proposalPath, proposal) {
  const resolved = path.resolve(String(proposalPath || ''));
  if (!proposalPath) throw new Error('A saved proposal path is required to enforce one-time application.');
  const appliedPath = `${resolved}.applied.json`;
  const claimPath = `${resolved}.applying`;
  if (await pathExists(appliedPath)) throw new Error('Proposal was already applied or consumed.');
  let handle;
  try {
    handle = await fs.open(claimPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
    await handle.writeFile(`${JSON.stringify({
      status: 'applying', proposalDigest: proposal.digest, startedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    await handle.sync();
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Proposal was already consumed or its application is unresolved.');
    throw error;
  } finally {
    await handle?.close();
  }
  return { appliedPath, claimPath };
}

async function finalizeProposalApplication({ appliedPath, claimPath }, audit) {
  const tempPath = `${appliedPath}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(tempPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
    await handle.writeFile(`${JSON.stringify(audit, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tempPath, appliedPath);
    await fs.unlink(claimPath);
  } catch (error) {
    await handle?.close();
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function auditProposal(proposal) {
  return {
    storeHash: proposal.storeHash,
    method: proposal.method,
    path: proposal.path,
    query: proposal.query,
    body: proposal.body,
    reason: proposal.reason,
  };
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

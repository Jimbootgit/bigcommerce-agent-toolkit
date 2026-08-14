import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BigCommerceClient } from '../src/client.mjs';
import { approvalCodeFor, applyProposal, createProposal, loadProposal, saveProposal } from '../src/proposals.mjs';

const APPROVAL_SECRET = 'test-only-approval-secret-at-least-32-characters';

test('proposal integrity and approval code gate writes', async () => {
  const proposal = createProposal({
    storeHash: 'abc123', method: 'PUT', apiPath: '/v3/catalog/products/42',
    body: { name: 'Updated' }, reason: 'Approved catalog correction',
  });
  assert.equal(proposal.digest.length, 64);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bcat-'));
  const proposalPath = await saveProposal(proposal, 'proposal.json', dir);
  const loaded = await loadProposal('proposal.json', dir);
  assert.equal(loaded.proposal.digest, proposal.digest);

  const calls = [];
  const client = new BigCommerceClient({
    storeHash: 'abc123', accessToken: 'token',
    fetchImpl: async (url, options) => {
      calls.push({ url: url.toString(), options });
      const name = options.method === 'GET' && calls.length === 1 ? 'Original' : 'Updated';
      return new Response(JSON.stringify({ data: { id: 42, name } }), { status: 200 });
    },
  });
  await assert.rejects(() => applyProposal(client, proposal, 'wrong-code'));
  assert.equal(calls.length, 0);
  const approvalCode = approvalCodeFor(proposal, APPROVAL_SECRET);
  const result = await applyProposal(client, proposal, approvalCode, APPROVAL_SECRET);
  assert.equal(result.mutation.data.data.name, 'Updated');
  assert.equal(result.snapshots.before.response.data.data.name, 'Original');
  assert.equal(result.snapshots.after.response.data.data.name, 'Updated');
  assert.deepEqual(calls.map((call) => call.options.method), ['GET', 'PUT', 'GET']);
});

test('snapshot failures are recorded without bypassing an approved write', async () => {
  const proposal = createProposal({
    storeHash: 'abc123', method: 'DELETE', apiPath: '/v3/content/scripts/4', reason: 'Remove obsolete script',
  });
  const methods = [];
  const client = {
    storeHash: 'abc123',
    request: async (_path, options) => {
      methods.push(options.method);
      if (options.method === 'GET') {
        const error = new Error('Resource not found');
        error.status = 404;
        throw error;
      }
      return { status: 204, data: null };
    },
  };
  const result = await applyProposal(client, proposal, approvalCodeFor(proposal, APPROVAL_SECRET), APPROVAL_SECRET);
  assert.equal(result.mutation.status, 204);
  assert.deepEqual(methods, ['GET', 'DELETE', 'GET']);
  assert.deepEqual(result.snapshots.before, {
    captured: false, error: { message: 'Resource not found', status: 404 },
  });
  assert.equal(result.snapshots.after.captured, false);
});

test('tampered proposals are rejected', async () => {
  const proposal = createProposal({ storeHash: 'abc123', method: 'DELETE', apiPath: '/v3/content/scripts/4', reason: 'Remove obsolete script' });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bcat-'));
  const proposalPath = await saveProposal(proposal, 'proposal.json', dir);
  proposal.path = '/v3/content/scripts/5';
  await fs.writeFile(proposalPath, JSON.stringify(proposal));
  await assert.rejects(() => loadProposal('proposal.json', dir), /integrity/i);
});

test('proposal paths cannot escape the configured directory', async () => {
  const proposal = createProposal({ storeHash: 'abc123', method: 'DELETE', apiPath: '/v3/content/scripts/4', reason: 'Remove obsolete script' });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bcat-'));
  await assert.rejects(() => saveProposal(proposal, '../escape.json', dir), /escapes/i);
  await assert.rejects(() => saveProposal(proposal, path.join(dir, 'absolute.json'), dir), /relative/i);
  await assert.rejects(() => loadProposal('../escape.json', dir), /escapes/i);
});

test('proposal reads and writes reject symlinks', async () => {
  const proposal = createProposal({ storeHash: 'abc123', method: 'DELETE', apiPath: '/v3/content/scripts/4', reason: 'Remove obsolete script' });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bcat-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'bcat-outside-'));
  await fs.symlink(outside, path.join(dir, 'linked'));
  await assert.rejects(() => saveProposal(proposal, 'linked/proposal.json', dir), /outside/i);
  await fs.writeFile(path.join(outside, 'proposal.json'), JSON.stringify(proposal));
  await fs.symlink(path.join(outside, 'proposal.json'), path.join(dir, 'proposal.json'));
  await assert.rejects(() => loadProposal('proposal.json', dir), /symlink/i);
});

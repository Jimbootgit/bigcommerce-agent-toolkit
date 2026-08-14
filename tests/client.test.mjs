import assert from 'node:assert/strict';
import test from 'node:test';

import { BigCommerceClient, normalizeApiPath, normalizeStoreHash, redactHeaders } from '../src/client.mjs';

test('normalizers reject unsafe hosts and invalid store hashes', () => {
  assert.equal(normalizeStoreHash('abc123'), 'abc123');
  assert.throws(() => normalizeStoreHash('store.example.com'));
  assert.equal(normalizeApiPath('v3/catalog/products'), '/v3/catalog/products');
  assert.throws(() => normalizeApiPath('https://evil.example/v3/catalog/products'));
  assert.throws(() => normalizeApiPath('/admin/users'));
});

test('credential-bearing headers are redacted', () => {
  assert.deepEqual(redactHeaders({
    Accept: 'application/json',
    'X-Auth-Token': 'secret-token',
    Authorization: 'Bearer secret',
    'X-Api-Key': 'secret-key',
  }), {
    Accept: 'application/json',
    'X-Auth-Token': '[REDACTED]',
    Authorization: '[REDACTED]',
    'X-Api-Key': '[REDACTED]',
  });
});

test('client sends credentials only to the fixed BigCommerce origin', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: url.toString(), options });
    return new Response(JSON.stringify({ data: [{ id: 1 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const client = new BigCommerceClient({ storeHash: 'abc123', accessToken: 'secret-token', fetchImpl });
  const result = await client.request('/v3/catalog/products', { query: { include: 'variants' } });
  assert.equal(result.status, 200);
  assert.match(calls[0].url, /^https:\/\/api\.bigcommerce\.com\/stores\/abc123\/v3\/catalog\/products/);
  assert.equal(calls[0].options.headers['X-Auth-Token'], 'secret-token');
});

test('pagination stops on a short page', async () => {
  let count = 0;
  const fetchImpl = async () => {
    count += 1;
    const data = count === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }];
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  const client = new BigCommerceClient({ storeHash: 'abc123', accessToken: 'token', fetchImpl });
  const result = await client.paginate('/v3/catalog/products', { pageSize: 2, maxPages: 10 });
  assert.deepEqual(result.items.map((item) => item.id), [1, 2, 3]);
  assert.equal(count, 2);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { BigCommerceClient, containsGraphqlMutation, normalizeApiPath, normalizeStoreHash } from '../src/client.mjs';

test('normalizers reject unsafe hosts and invalid store hashes', () => {
  assert.equal(normalizeStoreHash('abc123'), 'abc123');
  assert.throws(() => normalizeStoreHash('store.example.com'));
  assert.equal(normalizeApiPath('v3/catalog/products'), '/v3/catalog/products');
  assert.throws(() => normalizeApiPath('https://evil.example/v3/catalog/products'));
  assert.throws(() => normalizeApiPath('/admin/users'));
  assert.throws(() => normalizeApiPath('/v3/../../OTHERSTORE/v3/catalog/products'), /traversal/i);
  assert.throws(() => normalizeApiPath('/v3/%2e%2e/%2e%2e/OTHERSTORE/v3/catalog/products'), /traversal/i);
  assert.throws(() => normalizeApiPath('/v3/%252e%252e/OTHERSTORE/v3/catalog/products'), /traversal/i);
  assert.throws(() => normalizeApiPath('/v3/%2e%2e%2fOTHERSTORE/v3/catalog/products'), /traversal/i);
});

test('GraphQL mutation detection inspects operation definitions only', () => {
  assert.equal(containsGraphqlMutation('{ mutation { id } }'), false);
  assert.equal(containsGraphqlMutation('query { search(term: "mutation") { id } }'), false);
  assert.equal(containsGraphqlMutation('# mutation\nquery Read { store { name } }'), false);
  assert.equal(containsGraphqlMutation('fragment F on Store { name } mutation Change { deleteCart { id } }'), true);
});

test('client sends credentials only to the fixed BigCommerce origin', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: url.toString(), options });
    return new Response(JSON.stringify({ data: [{ id: 1 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const client = new BigCommerceClient({ storeHash: 'abc123', accessToken: 'secret-token', fetchImpl });
  const result = await client.request('/v3/catalog/products', {
    query: { include: 'variants' }, headers: { 'X-Auth-Token': 'caller-override' },
  });
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

test('requests include a timeout signal', async () => {
  const fetchImpl = async (_url, options) => {
    assert.equal(options.signal instanceof AbortSignal, true);
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  const client = new BigCommerceClient({ storeHash: 'abc123', accessToken: 'token', fetchImpl, timeoutMs: 100 });
  await client.request('/v3/catalog/products');
});

test('requests abort when the timeout expires', async () => {
  const fetchImpl = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  const client = new BigCommerceClient({ storeHash: 'abc123', accessToken: 'token', fetchImpl, timeoutMs: 5 });
  await assert.rejects(() => client.request('/v3/catalog/products'), /timed out after 5ms/i);
});

test('429 responses retry after the advertised reset interval', async () => {
  let count = 0;
  const fetchImpl = async () => {
    count += 1;
    if (count === 1) {
      return new Response(JSON.stringify({ title: 'rate limited' }), {
        status: 429,
        headers: { 'X-Rate-Limit-Time-Reset-Ms': '0' },
      });
    }
    return new Response(JSON.stringify({ data: [{ id: 1 }] }), {
      status: 200,
      headers: {
        'X-Rate-Limit-Requests-Left': '17',
        'X-Rate-Limit-Requests-Quota': '20',
        'X-Rate-Limit-Time-Reset-Ms': '1000',
      },
    });
  };
  const client = new BigCommerceClient({ storeHash: 'abc123', accessToken: 'token', fetchImpl, maxRetries: 1 });
  const result = await client.request('/v3/catalog/products');
  assert.equal(count, 2);
  assert.deepEqual(result.rateLimit, { requestsLeft: 17, requestsQuota: 20, resetMs: 1000 });
});

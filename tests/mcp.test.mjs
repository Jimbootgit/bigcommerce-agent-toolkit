import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../src/server.mjs';

test('MCP server discovers tools and executes a read through the client', async () => {
  const fetchImpl = async (url) => {
    if (url.toString().includes('/developer/llms.txt')) {
      return new Response('- [Product Reviews](https://docs.bigcommerce.com/developer/docs/storefront/graphql/product-reviews.md)', { status: 200 });
    }
    if (url.toString().includes('/v3/catalog/products/42/reviews')) {
      return new Response(JSON.stringify({ data: [{ id: 7, title: 'Fixture Review' }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { name: 'Fixture Store' } }), { status: 200 });
  };
  const server = createServer({ env: { BIGCOMMERCE_STORE_HASH: 'abc123', BIGCOMMERCE_ACCESS_TOKEN: 'token' }, fetchImpl });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
    'catalog_list', 'docs_get', 'docs_search', 'graphql_query', 'mutation_apply', 'mutation_propose', 'resource_list', 'store_get',
  ]);
  const called = await client.callTool({ name: 'store_get', arguments: { path: '/v3/store', query: {} } });
  assert.match(called.content[0].text, /Fixture Store/);

  const reviews = await client.callTool({
    name: 'resource_list',
    arguments: { resource: 'product_reviews', productId: 42, query: {}, pageSize: 50, maxPages: 2 },
  });
  assert.match(reviews.content[0].text, /Fixture Review/);

  const rejected = await client.callTool({
    name: 'graphql_query',
    arguments: { query: 'mutation { deleteCart { id } }', variables: {} },
  });
  assert.equal(rejected.isError, true);
  assert.match(rejected.content[0].text, /mutations require a proposal/i);

  await client.close();
  await server.close();
});

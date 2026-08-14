import assert from 'node:assert/strict';
import test from 'node:test';

import { listResource, RESOURCE_NAMES, resourcePath } from '../src/resources.mjs';

test('first-class resources map only to reviewed API paths', () => {
  assert.deepEqual(RESOURCE_NAMES, [
    'product_reviews', 'redirects', 'placements', 'widget_templates', 'themes', 'channels',
  ]);
  assert.equal(resourcePath('product_reviews', { productId: 42 }), '/v3/catalog/products/42/reviews');
  assert.equal(resourcePath('redirects'), '/v3/storefront/redirects');
  assert.equal(resourcePath('placements'), '/v3/content/placements');
  assert.equal(resourcePath('widget_templates'), '/v3/content/widget-templates');
  assert.equal(resourcePath('themes'), '/v3/themes');
  assert.equal(resourcePath('channels'), '/v3/channels');
});

test('product reviews require a valid product ID and unknown resources fail closed', () => {
  assert.throws(() => resourcePath('product_reviews'), /positive integer productId/);
  assert.throws(() => resourcePath('product_reviews', { productId: '../42' }), /positive integer productId/);
  assert.throws(() => resourcePath('orders'), /unsupported resource/);
});

test('resource listing delegates pagination with the reviewed path', async () => {
  const calls = [];
  const client = {
    paginate: async (path, options) => {
      calls.push({ path, options });
      return { items: [{ id: 1 }], pagesFetched: 1 };
    },
  };
  const result = await listResource(client, 'placements', {
    query: { channel_id: 1 }, pageSize: 25, maxPages: 3,
  });
  assert.deepEqual(result.items, [{ id: 1 }]);
  assert.deepEqual(calls, [{
    path: '/v3/content/placements',
    options: { query: { channel_id: 1 }, pageSize: 25, maxPages: 3 },
  }]);
});

test('themes use one request because the endpoint is not paginated', async () => {
  const calls = [];
  const client = {
    request: async (path, options) => {
      calls.push({ path, options });
      return { data: [{ uuid: 'theme-1' }] };
    },
  };
  const result = await listResource(client, 'themes', { query: {} });
  assert.equal(result.data[0].uuid, 'theme-1');
  assert.deepEqual(calls, [{ path: '/v3/themes', options: { query: {} } }]);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchDocs, normalizeDocsPath, searchDocs } from '../src/docs.mjs';

test('docs path normalizes official pages to Markdown', () => {
  assert.equal(
    normalizeDocsPath('https://developer.bigcommerce.com/docs/storefront/graphql/product-reviews'),
    'https://docs.bigcommerce.com/developer/docs/storefront/graphql/product-reviews.md',
  );
  assert.throws(() => normalizeDocsPath('https://example.com/docs/foo'));
});

test('docs search ranks matching index rows', async () => {
  const fetchImpl = async () => new Response([
    '- [Product Reviews](/docs/storefront/graphql/product-reviews)',
    '- [Catalog Products](/docs/rest/catalog/products)',
    '- [Widgets](/docs/storefront/widgets)',
  ].join('\n'), { status: 200 });
  const result = await searchDocs('product reviews', { fetchImpl });
  assert.equal(result.results[0].score, 2);
  assert.match(result.results[0].line, /Product Reviews/);
  const page = await fetchDocs('/docs/storefront/graphql/product-reviews', { fetchImpl, maxChars: 20 });
  assert.equal(page.truncated, true);
});

test('docs fetch rejects branded 200 not-found pages', async () => {
  const fetchImpl = async () => new Response('# Page Not Found\n\nThis page does not exist.', { status: 200 });
  await assert.rejects(() => fetchDocs('/docs/missing', { fetchImpl }), /not found/i);
});

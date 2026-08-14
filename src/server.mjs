import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { clientFromEnv } from './client.mjs';
import { fetchDocs, searchDocs } from './docs.mjs';
import { applyProposal, createProposal, loadProposal, saveProposal } from './proposals.mjs';
import { listResource, RESOURCE_NAMES } from './resources.mjs';

export function createServer({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const server = new McpServer({ name: 'bigcommerce-agent-toolkit', version: '0.1.0' });
  const getClient = () => clientFromEnv(env, fetchImpl);
  const proposalsDir = () => env.BIGCOMMERCE_PROPOSALS_DIR;

  server.tool('docs_search', 'Search BigCommerce AI-friendly documentation index.', {
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(20).default(8),
  }, async ({ query, maxResults }) => textResult(await searchDocs(query, { fetchImpl, maxResults })));

  server.tool('docs_get', 'Fetch a BigCommerce documentation page as Markdown.', {
    path: z.string().min(1),
    maxChars: z.number().int().min(1000).max(100000).default(30000),
  }, async ({ path, maxChars }) => textResult(await fetchDocs(path, { fetchImpl, maxChars })));

  server.tool('store_get', 'Run an authenticated read-only request against a relative BigCommerce API path.', {
    path: z.string().min(1).describe('Relative path beginning /v2, /v3, or /graphql.'),
    query: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  }, async ({ path, query }) => textResult(await getClient().request(path, { query })));

  server.tool('catalog_list', 'Read and paginate a common BigCommerce catalog/content resource.', {
    resource: z.enum(['products', 'categories', 'brands', 'pages', 'scripts', 'widgets']),
    query: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
    maxPages: z.number().int().min(1).max(100).default(10),
  }, async ({ resource, query, maxPages }) => {
    const paths = {
      products: '/v3/catalog/products', categories: '/v3/catalog/categories', brands: '/v3/catalog/brands',
      pages: '/v3/content/pages', scripts: '/v3/content/scripts', widgets: '/v3/content/widgets',
    };
    return textResult(await getClient().paginate(paths[resource], { query, maxPages }));
  });

  server.tool('resource_list', 'List a first-class BigCommerce resource using a fixed, reviewed endpoint.', {
    resource: z.enum(RESOURCE_NAMES),
    productId: z.number().int().positive().optional(),
    query: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
    pageSize: z.number().int().min(1).max(250).default(50),
    maxPages: z.number().int().min(1).max(100).default(20),
  }, async ({ resource, productId, query, pageSize, maxPages }) => textResult(await listResource(getClient(), resource, {
    productId, query, pageSize, maxPages,
  })));

  server.tool('graphql_query', 'Run a read-only BigCommerce GraphQL query. Mutations are rejected.', {
    query: z.string().min(1),
    variables: z.record(z.any()).default({}),
  }, async ({ query, variables }) => {
    if (/\bmutation\b/i.test(query)) throw new Error('GraphQL mutations require a proposal and explicit approval.');
    return textResult(await getClient().request('/graphql', { method: 'POST', body: { query, variables } }));
  });

  server.tool('mutation_propose', 'Write an immutable mutation proposal to disk. This does not call BigCommerce.', {
    method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']),
    path: z.string().min(1),
    query: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
    body: z.any().optional(),
    reason: z.string().min(3),
    outputPath: z.string().min(1).describe('Path relative to BIGCOMMERCE_PROPOSALS_DIR.'),
  }, async ({ method, path, query, body, reason, outputPath }) => {
    const client = getClient();
    const proposal = createProposal({ storeHash: client.storeHash, method, apiPath: path, query, body, reason });
    const savedTo = await saveProposal(proposal, outputPath, proposalsDir());
    return textResult({ proposal, savedTo, applied: false });
  });

  server.tool('mutation_apply', 'Apply a saved proposal only when its exact approval code is supplied.', {
    proposalPath: z.string().min(1),
    approvalCode: z.string().length(16),
  }, async ({ proposalPath, approvalCode }) => {
    const { proposal, resolved } = await loadProposal(proposalPath, proposalsDir());
    const response = await applyProposal(getClient(), proposal, approvalCode, env.BIGCOMMERCE_APPROVAL_SECRET);
    return textResult({ proposalPath: resolved, response });
  });

  return server;
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

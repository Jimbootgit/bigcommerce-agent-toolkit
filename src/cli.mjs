#!/usr/bin/env node
import { clientFromEnv, containsGraphqlMutation } from './client.mjs';
import { fetchDocs, searchDocs } from './docs.mjs';
import { approvalCodeFor, applySavedProposal, createProposal, loadProposal, saveProposal } from './proposals.mjs';
import { listResource, RESOURCE_NAMES } from './resources.mjs';

function usage() {
  console.log(`BigCommerce Agent Toolkit

Usage:
  bcat docs search <query>
  bcat docs get <path-or-url>
  bcat get <api-path> [query-json]
  bcat list <products|categories|brands|pages|scripts|widgets> [query-json]
  bcat resource <${RESOURCE_NAMES.join('|')}> [query-json] [product-id]
  bcat graphql <query> [variables-json]
  bcat propose <METHOD> <api-path> <reason> <output-file> [body-json]
  bcat approve <proposal-file>
  bcat apply <proposal-file> <approval-code>

Environment:
  BIGCOMMERCE_STORE_HASH
  BIGCOMMERCE_ACCESS_TOKEN (or BIGCOMMERCE_API_TOKEN)
  BIGCOMMERCE_PROPOSALS_DIR
  BIGCOMMERCE_APPROVAL_SECRET (32+ chars; keep outside the agent environment when approving)
`);
}

function parseJson(value, fallback = {}) {
  if (value === undefined) return fallback;
  return JSON.parse(value);
}

async function main(args) {
  const [area, action, ...rest] = args;
  if (!area || ['help', '--help', '-h'].includes(area)) return usage();
  if (area === 'docs' && action === 'search') return print(await searchDocs(rest.join(' ')));
  if (area === 'docs' && action === 'get') return print(await fetchDocs(rest[0]));

  const getClient = () => clientFromEnv();
  if (area === 'get') return print(await getClient().request(action, { query: parseJson(rest[0]) }));
  if (area === 'list') {
    const paths = { products: '/v3/catalog/products', categories: '/v3/catalog/categories', brands: '/v3/catalog/brands', pages: '/v3/content/pages', scripts: '/v3/content/scripts', widgets: '/v3/content/widgets' };
    if (!paths[action]) throw new Error(`Unsupported resource: ${action}`);
    return print(await getClient().paginate(paths[action], { query: parseJson(rest[0]) }));
  }
  if (area === 'resource') {
    const productId = rest[1] === undefined ? undefined : Number(rest[1]);
    return print(await listResource(getClient(), action, { query: parseJson(rest[0]), productId }));
  }
  if (area === 'graphql') {
    if (containsGraphqlMutation(action)) throw new Error('Use bcat propose for mutations.');
    return print(await getClient().request('/graphql', { method: 'POST', body: { query: action, variables: parseJson(rest[0]) } }));
  }
  if (area === 'propose') {
    const [method, apiPath, reason, outputFile, bodyJson] = [action, ...rest];
    const proposal = createProposal({ storeHash: getClient().storeHash, method, apiPath, reason, body: parseJson(bodyJson, null) });
    return print({ proposal, savedTo: await saveProposal(proposal, outputFile, process.env.BIGCOMMERCE_PROPOSALS_DIR), applied: false });
  }
  if (area === 'approve') {
    const { proposal } = await loadProposal(action, process.env.BIGCOMMERCE_PROPOSALS_DIR);
    return print({ approvalCode: approvalCodeFor(proposal, process.env.BIGCOMMERCE_APPROVAL_SECRET) });
  }
  if (area === 'apply') {
    return print(await applySavedProposal(
      getClient(), action, process.env.BIGCOMMERCE_PROPOSALS_DIR, rest[0], process.env.BIGCOMMERCE_APPROVAL_SECRET,
    ));
  }
  usage();
  process.exitCode = 2;
}

function print(value) { console.log(JSON.stringify(value, null, 2)); }

main(process.argv.slice(2)).catch((error) => {
  console.error(JSON.stringify({
    error: error.message,
    status: error.status || null,
    details: error.details || null,
    rateLimit: error.rateLimit || null,
  }, null, 2));
  process.exitCode = 1;
});

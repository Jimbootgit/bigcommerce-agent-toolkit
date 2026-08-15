# BigCommerce Agent Toolkit

A read-first BigCommerce toolkit for Hermes and other MCP clients. It combines official BigCommerce documentation retrieval, authenticated REST/GraphQL reads, catalog/content helpers, and approval-gated writes.

It is intentionally smaller and safer than a generic “run any request” wrapper.

> [!WARNING]
> This repository is an early alpha. Read operations are the intended default. Writes require a separately held approval secret, but this control still depends on keeping that secret outside the agent environment. Keep write-capable tokens disabled unless that independent approval boundary is configured and verified.

## Capabilities

- Search BigCommerce's official AI-friendly `llms.txt` documentation index.
- BigCommerce also exposes an official documentation-only MCP endpoint at `https://docs.bigcommerce.com/_mcp/server`. This toolkit uses the same official docs corpus, then adds store reads and approval-gated operations that the docs MCP does not provide.
- Fetch official documentation as Markdown.
- Run authenticated reads against `/v2`, `/v3`, and `/graphql`.
- Paginate products, categories, brands, pages, scripts, and widgets.
- Read product reviews, redirects, placements, widget templates, themes, and channels through fixed first-class routes.
- Reject GraphQL mutations through the read tool.
- Save writes as tamper-evident proposal files inside a configured directory.
- Apply a proposal only with an HMAC approval code created from a separately held secret and a matching store hash.
- Capture best-effort before-and-after reads around every approved mutation.

## Safety model

1. Credentials only go to the fixed `https://api.bigcommerce.com/stores/{storeHash}` origin.
2. API tools accept relative paths only. Arbitrary external URLs are rejected.
3. Ordinary store tools are read-only.
4. Writes require separate propose, approve, and apply operations. The MCP server never returns an approval code.
5. Proposal files include the method, path, body, reason, store hash, and integrity digest. Reads and writes are confined to `BIGCOMMERCE_PROPOSALS_DIR`; traversal and symlink paths are rejected.
6. Secrets come from the environment and are never stored in proposal files.
7. Approved writes return the mutation response and best-effort snapshots. An unreadable resource records a snapshot error instead of fabricating evidence.

This is an approval mechanism, not a substitute for least-privilege BigCommerce API scopes. Create separate read-only and write-capable API accounts where practical.

See [`SCOPES.md`](SCOPES.md) for the verified scope map. BigCommerce requires the modify-only Themes scope even for listing themes.

## Setup

Requirements: Node.js 20 or newer.

```bash
cd /path/to/bigcommerce-agent-toolkit
npm install
npm test
```

Set credentials in the launching environment:

```bash
export BIGCOMMERCE_STORE_HASH='your_store_hash'
export BIGCOMMERCE_ACCESS_TOKEN='your_scoped_token'
export BIGCOMMERCE_PROPOSALS_DIR='/absolute/path/to/private/operations'
```

Do not put live tokens in this repository.

## CLI

```bash
bcat docs search 'product reviews'
bcat docs get '/developer/docs/storefront/guides/graphql-storefront-api/products-and-catalog/product-reviews'
bcat get '/v3/store'
bcat list products '{"include":"variants,custom_fields"}'
bcat graphql 'query { store { storeName } }'
bcat resource product_reviews '{"status":1}' 42
bcat resource redirects '{"include":"to_url"}'
bcat resource placements '{"channel_id:in":"1"}'
bcat resource widget_templates '{}'
bcat resource themes '{}'
bcat resource channels '{"type:in":"storefront"}'
```

Propose a write without applying it:

```bash
bcat propose \
  PUT \
  '/v3/catalog/products/42' \
  'Approved product-title correction' \
  'demo-store/product-42-title.proposal.json' \
  '{"name":"Correct title"}'
```

Review the proposal file. In a separate trusted shell that is not exposed to the agent, set a random secret of at least 32 characters and create the approval code:

```bash
export BIGCOMMERCE_APPROVAL_SECRET='use-a-random-secret-from-a-secret-manager'
bcat approve 'demo-store/product-42-title.proposal.json'
```

Supply that code only after explicit approval:

```bash
bcat apply \
  'demo-store/product-42-title.proposal.json' \
  'the-16-char-code'
```

## Hermes MCP configuration

Add this under `mcp_servers` in the active Hermes profile configuration. Use environment variable interpolation or another local secret mechanism supported by the launcher. Do not commit the token.

```yaml
mcp_servers:
  bigcommerce:
    command: "/opt/homebrew/bin/node"
    args:
      - "/absolute/path/to/bigcommerce-agent-toolkit/src/server.mjs"
    env:
      BIGCOMMERCE_STORE_HASH: "your_store_hash"
      BIGCOMMERCE_ACCESS_TOKEN: "your_scoped_token"
      BIGCOMMERCE_PROPOSALS_DIR: "/absolute/path/to/private/operations"
      BIGCOMMERCE_APPROVAL_SECRET: "interpolate-from-a-secret-store-never-exposed-to-the-agent"
    timeout: 120
```

Restart Hermes after adding the server. MCP hosts may prefix these bare tool names with the server name:

- `docs_search`
- `docs_get`
- `store_get`
- `catalog_list`
- `resource_list`
- `graphql_query`
- `mutation_propose`
- `mutation_apply`

## Recommended first use

Use a read-only API account first. Inspect:

- Store identity and channels.
- Native review/product data.
- Web pages and redirects.
- Scripts and widgets.
- Theme inventory through the relevant Themes endpoints or Stencil CLI.

Private embedded apps are outside the API account's permission boundary. BigCommerce API access does not automatically grant access to an app's private dashboard. A staff or collaborator user may separately need the **Launch applications** control-panel permission to open an app such as Fera.

## Development

```bash
npm run check
npm test
```

The test suite uses mocked HTTP responses. It never needs or touches a live store.

# BigCommerce OAuth scopes

Use a separate store-level API account for this toolkit and grant only the scopes needed for the tools you enable. BigCommerce access tokens do not expire based on time, so delete the API account to revoke a compromised token.

## Read tools

| Toolkit operation | BigCommerce endpoint | Minimum accepted scope |
| --- | --- | --- |
| `resource_list: product_reviews` | `GET /v3/catalog/products/{product_id}/reviews` | Products, read-only: `store_v2_products_read_only` |
| `resource_list: redirects` | `GET /v3/storefront/redirects` | Content, read-only: `store_v2_content_read_only` |
| `resource_list: placements` | `GET /v3/content/placements` | Content, read-only: `store_v2_content_read_only` |
| `resource_list: widget_templates` | `GET /v3/content/widget-templates` | Content, read-only: `store_v2_content_read_only` |
| `resource_list: themes` | `GET /v3/themes` | Themes, modify: `store_themes_manage` |
| `resource_list: channels` | `GET /v3/channels` | One accepted read-only channel scope: `store_channel_listings_read_only`, `store_channel_settings_read_only`, or `store_sites_read_only` |
| `catalog_list: products`, `categories`, `brands` | Catalog V3 reads | Products, read-only: `store_v2_products_read_only` |
| `catalog_list: pages`, `scripts`, `widgets` | Content V3 reads | Content, read-only: `store_v2_content_read_only` |
| `store_get: /v3/store` | Store information | Information & Settings, read-only: `store_v2_information_read_only` |
| `graphql_query` | `POST /graphql` with a query document | Field-dependent. Grant only the read scopes required by the fields queried. Mutations are rejected by the toolkit. |
| `docs_search`, `docs_get` | Public BigCommerce documentation | None |

BigCommerce does not publish a read-only Themes scope for `GET /v3/themes`. The endpoint requires `store_themes_manage`, which also permits theme changes. Treat a token with this scope as write-capable even when the toolkit only calls the read endpoint.

The Channels endpoint accepts several scope families. Prefer one read-only scope already required by the channel data you need. Do not grant all three unless the workflow needs them.

## Mutation tools

`mutation_propose` does not call BigCommerce and needs no additional scope. CLI-only `bcat apply` needs the modify scope required by the exact proposed endpoint. The toolkit cannot safely reduce that requirement because it supports reviewed relative API paths.

Keep write-capable credentials and `BIGCOMMERCE_APPROVAL_SECRET` in separate trust domains. Do not place the approval secret in the MCP server environment. An approval secret available to the agent does not provide an independent human approval boundary.

## Embedded apps are separate

BigCommerce API scopes do not grant access to a third-party app dashboard embedded in the control panel. A staff or collaborator user may also need the control-panel permission that lets them launch applications. For Fera, this is the **Launch applications** permission. Configure that in BigCommerce user permissions, not in the API account.

## Official references

- [API Accounts and OAuth scopes](https://docs.bigcommerce.com/developer/docs/overview/api-fundamentals/api-accounts)
- [List Product Reviews](https://docs.bigcommerce.com/developer/api-reference/rest/admin/catalog/products/reviews/get-product-reviews)
- [List Redirects V3](https://docs.bigcommerce.com/developer/api-reference/rest/admin/management/redirects/get-redirects)
- [List Placements](https://docs.bigcommerce.com/developer/api-reference/rest/admin/content/widgets/placement/get-placements)
- [List Widget Templates](https://docs.bigcommerce.com/developer/api-reference/rest/admin/content/widgets/widget-template/get-widget-templates)
- [List Themes](https://docs.bigcommerce.com/developer/api-reference/rest/admin/content/themes/get-store-themes)
- [List Channels](https://docs.bigcommerce.com/developer/api-reference/rest/admin/management/channels/get-channels)

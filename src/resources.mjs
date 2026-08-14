const RESOURCE_DEFINITIONS = Object.freeze({
  product_reviews: {
    path: ({ productId } = {}) => {
      const id = Number(productId);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error('product_reviews requires a positive integer productId');
      }
      return `/v3/catalog/products/${id}/reviews`;
    },
  },
  redirects: { path: () => '/v3/storefront/redirects' },
  placements: { path: () => '/v3/content/placements' },
  widget_templates: { path: () => '/v3/content/widget-templates' },
  themes: { path: () => '/v3/themes', paginated: false },
  channels: { path: () => '/v3/channels' },
});

export const RESOURCE_NAMES = Object.freeze(Object.keys(RESOURCE_DEFINITIONS));

export function resourcePath(resource, options = {}) {
  const definition = RESOURCE_DEFINITIONS[resource];
  if (!definition) {
    throw new Error(`unsupported resource: ${resource}`);
  }
  return definition.path(options);
}

export function listResource(client, resource, {
  productId,
  query = {},
  pageSize = 50,
  maxPages = 20,
} = {}) {
  const definition = RESOURCE_DEFINITIONS[resource];
  const path = resourcePath(resource, { productId });
  if (definition.paginated === false) {
    return client.request(path, { query });
  }
  return client.paginate(path, {
    query,
    pageSize,
    maxPages,
  });
}

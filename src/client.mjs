export class BigCommerceError extends Error {
  constructor(message, { status = null, details = null } = {}) {
    super(message);
    this.name = 'BigCommerceError';
    this.status = status;
    this.details = details;
  }
}

export function normalizeStoreHash(value) {
  const storeHash = String(value || '').trim();
  if (!/^[a-z0-9]+$/i.test(storeHash)) {
    throw new BigCommerceError('A valid BigCommerce store hash is required.');
  }
  return storeHash;
}

export function normalizeApiPath(value) {
  const input = String(value || '').trim();
  if (!input) throw new BigCommerceError('API path is required.');
  if (/^https?:\/\//i.test(input)) {
    throw new BigCommerceError('Use a relative BigCommerce API path, not an absolute URL.');
  }
  const path = input.startsWith('/') ? input : `/${input}`;
  if (!/^\/(v2|v3|graphql)(\/|$)/.test(path)) {
    throw new BigCommerceError('API path must start with /v2, /v3, or /graphql.');
  }
  return path;
}

export function redactHeaders(headers = {}) {
  const output = { ...headers };
  for (const key of Object.keys(output)) {
    if (/token|authorization|secret|key/i.test(key)) output[key] = '[REDACTED]';
  }
  return output;
}

export class BigCommerceClient {
  constructor({ storeHash, accessToken, fetchImpl = globalThis.fetch, userAgent = 'bigcommerce-agent-toolkit/0.1' }) {
    this.storeHash = normalizeStoreHash(storeHash);
    this.accessToken = String(accessToken || '').trim();
    if (!this.accessToken) throw new BigCommerceError('A BigCommerce access token is required.');
    if (typeof fetchImpl !== 'function') throw new BigCommerceError('A fetch implementation is required.');
    this.fetchImpl = fetchImpl;
    this.userAgent = userAgent;
  }

  async request(path, { method = 'GET', query = {}, body, headers = {} } = {}) {
    const normalizedPath = normalizeApiPath(path);
    const url = new URL(`https://api.bigcommerce.com/stores/${this.storeHash}${normalizedPath}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }

    const requestHeaders = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': this.userAgent,
      'X-Auth-Token': this.accessToken,
      ...headers,
    };
    const response = await this.fetchImpl(url, {
      method: String(method).toUpperCase(),
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await response.text();
    let payload = null;
    if (raw) {
      try { payload = JSON.parse(raw); } catch { payload = raw; }
    }
    if (!response.ok) {
      throw new BigCommerceError(`BigCommerce request failed with HTTP ${response.status}.`, {
        status: response.status,
        details: payload,
      });
    }
    return {
      status: response.status,
      method: String(method).toUpperCase(),
      url: url.toString(),
      data: payload,
    };
  }

  async paginate(path, { query = {}, maxPages = 10, pageSize = 250 } = {}) {
    const items = [];
    const pages = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const result = await this.request(path, { query: { ...query, page, limit: pageSize } });
      const payload = result.data;
      const data = Array.isArray(payload) ? payload : payload?.data;
      if (!Array.isArray(data)) {
        throw new BigCommerceError('Paginated endpoint did not return an array.', { details: payload });
      }
      items.push(...data);
      pages.push({ page, count: data.length });
      const totalPages = Number(payload?.meta?.pagination?.total_pages || 0);
      if (data.length < pageSize || (totalPages && page >= totalPages)) break;
    }
    return { items, pages, count: items.length };
  }
}

export function clientFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
  return new BigCommerceClient({
    storeHash: env.BIGCOMMERCE_STORE_HASH,
    accessToken: env.BIGCOMMERCE_ACCESS_TOKEN || env.BIGCOMMERCE_API_TOKEN,
    fetchImpl,
  });
}

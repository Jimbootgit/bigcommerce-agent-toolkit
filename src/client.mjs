export class BigCommerceError extends Error {
  constructor(message, { status = null, details = null, rateLimit = null } = {}) {
    super(message);
    this.name = 'BigCommerceError';
    this.status = status;
    this.details = details;
    this.rateLimit = rateLimit;
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
  for (const segment of path.split('/')) {
    let decoded = segment;
    try {
      for (let pass = 0; pass < 10; pass += 1) {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        if (pass === 9) throw new Error('excessive encoding');
        decoded = next;
      }
    } catch {
      throw new BigCommerceError('API path contains invalid percent encoding.');
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
      throw new BigCommerceError('API path traversal segments are not allowed.');
    }
  }
  return path;
}

export function containsGraphqlMutation(document) {
  const input = String(document || '');
  let braceDepth = 0;
  for (let index = 0; index < input.length;) {
    const char = input[index];
    if (char === '#') {
      while (index < input.length && input[index] !== '\n') index += 1;
      continue;
    }
    if (input.startsWith('"""', index)) {
      index += 3;
      while (index < input.length && !input.startsWith('"""', index)) index += 1;
      index += 3;
      continue;
    }
    if (char === '"') {
      index += 1;
      while (index < input.length) {
        if (input[index] === '\\') index += 2;
        else if (input[index++] === '"') break;
      }
      continue;
    }
    if (char === '{') { braceDepth += 1; index += 1; continue; }
    if (char === '}') { braceDepth = Math.max(0, braceDepth - 1); index += 1; continue; }
    if (/[_A-Za-z]/.test(char)) {
      const start = index;
      while (index < input.length && /[_0-9A-Za-z]/.test(input[index])) index += 1;
      if (braceDepth === 0 && input.slice(start, index) === 'mutation') return true;
      continue;
    }
    index += 1;
  }
  return false;
}

export class BigCommerceClient {
  constructor({
    storeHash,
    accessToken,
    fetchImpl = globalThis.fetch,
    userAgent = 'bigcommerce-agent-toolkit/0.1.0-alpha.1',
    timeoutMs = 30000,
    maxRetries = 2,
  }) {
    this.storeHash = normalizeStoreHash(storeHash);
    this.accessToken = String(accessToken || '').trim();
    if (!this.accessToken) throw new BigCommerceError('A BigCommerce access token is required.');
    if (typeof fetchImpl !== 'function') throw new BigCommerceError('A fetch implementation is required.');
    this.fetchImpl = fetchImpl;
    this.userAgent = userAgent;
    this.timeoutMs = positiveInteger(timeoutMs, 'timeoutMs');
    this.maxRetries = nonNegativeInteger(maxRetries, 'maxRetries');
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
      ...headers,
      'X-Auth-Token': this.accessToken,
    };
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response;
      try {
        response = await this.fetchImpl(url, {
          method: String(method).toUpperCase(),
          headers: requestHeaders,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new BigCommerceError(`BigCommerce request timed out after ${this.timeoutMs}ms.`);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
      const raw = await response.text();
      let payload = null;
      if (raw) {
        try { payload = JSON.parse(raw); } catch { payload = raw; }
      }
      const rateLimit = rateLimitFromHeaders(response.headers);
      if (response.status === 429 && attempt < this.maxRetries) {
        await delay(Math.min(rateLimit.resetMs ?? 1000, 30000));
        continue;
      }
      if (!response.ok) {
        throw new BigCommerceError(`BigCommerce request failed with HTTP ${response.status}.`, {
          status: response.status,
          details: payload,
          rateLimit,
        });
      }
      return {
        status: response.status,
        method: String(method).toUpperCase(),
        url: url.toString(),
        data: payload,
        rateLimit,
      };
    }
    throw new BigCommerceError('BigCommerce request exhausted its retry budget.');
  }

  async paginate(path, { query = {}, maxPages = 10, pageSize = 250 } = {}) {
    const items = [];
    const pages = [];
    let rateLimit = null;
    for (let page = 1; page <= maxPages; page += 1) {
      const result = await this.request(path, { query: { ...query, page, limit: pageSize } });
      rateLimit = result.rateLimit;
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
    return { items, pages, count: items.length, rateLimit };
  }
}

export function clientFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
  return new BigCommerceClient({
    storeHash: env.BIGCOMMERCE_STORE_HASH,
    accessToken: env.BIGCOMMERCE_ACCESS_TOKEN || env.BIGCOMMERCE_API_TOKEN,
    fetchImpl,
    timeoutMs: env.BIGCOMMERCE_TIMEOUT_MS || 30000,
    maxRetries: env.BIGCOMMERCE_MAX_RETRIES ?? 2,
  });
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new BigCommerceError(`${name} must be a positive integer.`);
  return number;
}

function nonNegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new BigCommerceError(`${name} must be a non-negative integer.`);
  return number;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rateLimitFromHeaders(headers) {
  return {
    requestsLeft: optionalNumber(headers.get('X-Rate-Limit-Requests-Left')),
    requestsQuota: optionalNumber(headers.get('X-Rate-Limit-Requests-Quota')),
    resetMs: optionalNumber(headers.get('X-Rate-Limit-Time-Reset-Ms')),
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

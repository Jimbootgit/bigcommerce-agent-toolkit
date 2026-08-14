const DOCS_ORIGIN = 'https://docs.bigcommerce.com';

export function normalizeDocsPath(value = '/docs/overview/quick-start') {
  const input = String(value || '').trim();
  if (!input) return '/docs/overview/quick-start';
  const url = input.startsWith('http') ? new URL(input) : new URL(input.startsWith('/') ? input : `/${input}`, DOCS_ORIGIN);
  if (!['developer.bigcommerce.com', 'docs.bigcommerce.com'].includes(url.hostname)) {
    throw new Error('Docs URL must be on developer.bigcommerce.com or docs.bigcommerce.com.');
  }
  let path = url.pathname;
  if (url.hostname === 'developer.bigcommerce.com' && !path.startsWith('/developer/')) path = `/developer${path}`;
  if (!path.startsWith('/developer/')) path = `/developer${path}`;
  if (path.endsWith('.md')) return `${DOCS_ORIGIN}${path}`;
  if (path.endsWith('/llms.txt')) return `${DOCS_ORIGIN}${path}`;
  path = path.replace(/\/$/, '');
  return `${DOCS_ORIGIN}${path}.md`;
}

export async function fetchDocs(path, { fetchImpl = globalThis.fetch, maxChars = 30000 } = {}) {
  const url = normalizeDocsPath(path);
  const response = await fetchImpl(url, { headers: { Accept: 'text/markdown,text/plain;q=0.9' } });
  if (!response.ok) throw new Error(`BigCommerce docs request failed with HTTP ${response.status}.`);
  const text = await response.text();
  if (/^# Page Not Found\b/m.test(text)) throw new Error(`BigCommerce documentation page was not found: ${url}`);
  return { url, text: text.slice(0, maxChars), truncated: text.length > maxChars, totalChars: text.length };
}

export async function searchDocs(query, { fetchImpl = globalThis.fetch, maxResults = 8 } = {}) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) throw new Error('A documentation search query is required.');
  const index = await fetchDocs('/developer/llms.txt', { fetchImpl, maxChars: 500000 });
  const rows = index.text.split('\n').map((line) => line.trim()).filter(Boolean);
  const scored = rows.map((line) => ({
    line,
    score: terms.reduce((score, term) => score + (line.toLowerCase().includes(term) ? 1 : 0), 0),
  })).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.line.localeCompare(b.line))
    .slice(0, maxResults);
  return { query, results: scored };
}

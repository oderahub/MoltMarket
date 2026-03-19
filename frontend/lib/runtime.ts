function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

export function getApiBaseUrl() {
  const raw = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  return trimTrailingSlashes(raw);
}

export function buildApiUrl(path: string) {
  const base = getApiBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

export function getWebSocketUrl() {
  const explicitWsUrl = process.env.NEXT_PUBLIC_WS_URL;

  if (explicitWsUrl) {
    const normalized = trimTrailingSlashes(explicitWsUrl);
    return normalized.endsWith('/ws') ? normalized : `${normalized}/ws`;
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_API_URL ||
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  const normalizedBase = trimTrailingSlashes(baseUrl);
  const wsOrigin = /^wss?:\/\//.test(normalizedBase)
    ? normalizedBase
    : `${normalizedBase.startsWith('https') ? 'wss' : 'ws'}://${normalizedBase.replace(/^https?:\/\//, '')}`;

  return wsOrigin.endsWith('/ws') ? wsOrigin : `${wsOrigin}/ws`;
}

export function normalizeBaseUrl(value) {
  const raw = value || "http://127.0.0.1:3000";

  try {
    const url = new URL(raw);
    if (url.hostname === "localhost") {
      url.hostname = "127.0.0.1";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/\/$/, "");
  }
}

export function resolveServerUrl() {
  if (process.env.SERVER_URL) {
    return normalizeBaseUrl(process.env.SERVER_URL);
  }

  if (process.env.RENDER_EXTERNAL_URL) {
    return normalizeBaseUrl(process.env.RENDER_EXTERNAL_URL);
  }

  const port = process.env.PORT || "3000";
  return normalizeBaseUrl(`http://127.0.0.1:${port}`);
}

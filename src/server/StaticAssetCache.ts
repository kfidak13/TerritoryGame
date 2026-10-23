const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

function stripQueryString(urlPath: string): string {
  return urlPath.split("?", 1)[0];
}

export function getStaticAssetCacheControl(
  urlPath: string | undefined,
): string | undefined {
  if (!urlPath) {
    return undefined;
  }

  const normalizedPath = stripQueryString(urlPath);
  if (
    normalizedPath.startsWith("/assets/") ||
    normalizedPath.startsWith("/_assets/")
  ) {
    return IMMUTABLE_CACHE_CONTROL;
  }

  // Pages served under fixed names (the privacy policy, the terms) change in
  // place, so browsers must check back instead of keeping express.static's
  // year-long default.
  if (normalizedPath.endsWith(".html")) {
    return "no-cache";
  }

  return undefined;
}

export function applyStaticAssetCacheControl(
  setHeader: (name: string, value: string) => void,
  urlPath: string | undefined,
): void {
  const cacheControl = getStaticAssetCacheControl(urlPath);
  if (cacheControl) {
    setHeader("Cache-Control", cacheControl);
  }
}

/**
 * Returns the fully-qualified Browserless base URL for a given region name or URL.
 * Accepts short region names ("production-sfo", "production-lon", "production-ams"),
 * full URLs (passed through unchanged), or arbitrary region names (auto-prefixed).
 */
export function getRegionUrl(region?: string): string {
  if (!region || region === "production-sfo") return "https://production-sfo.browserless.io";
  if (region === "production-lon") return "https://production-lon.browserless.io";
  if (region === "production-ams") return "https://production-ams.browserless.io";
  if (region.startsWith("http")) return region;
  return `https://${region}.browserless.io`;
}

/**
 * Returns the query-string auth fragment for a Browserless API key.
 */
export function getAuthUrl(apiKey?: string): string {
  if (!apiKey) return "";
  return `?token=${encodeURIComponent(apiKey)}`;
}

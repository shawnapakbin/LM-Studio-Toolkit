/**
 * Validates API key format and presence.
 *
 * @param apiKey - The API key to validate
 * @returns true if the API key appears valid
 */
export function isValidApiKey(apiKey: string | undefined): boolean {
  if (!apiKey || typeof apiKey !== "string") {
    return false;
  }

  const trimmed = apiKey.trim();
  // Browserless API keys should be at least 10 characters
  return trimmed.length >= 10;
}

/**
 * Patterns indicating potentially unsafe hostnames for SSRF protection.
 */
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^fc[0-9a-f]{2}:/i,
  /^fe80:/i,
];

/**
 * Checks if a hostname is blocked for SSRF protection.
 *
 * @param hostname - The hostname to check
 * @returns true if the hostname is blocked
 */
export function isBlockedHostname(hostname: string): boolean {
  return BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(hostname));
}

/**
 * Validates a target URL for safety.
 *
 * @param url - The URL to validate
 * @returns An object with validation result and optional error message
 */
export function validateTargetUrl(url: string): { valid: boolean; error?: string } {
  if (!url || typeof url !== "string") {
    return { valid: false, error: "URL is required and must be a string" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    return { valid: false, error: "Only HTTP and HTTPS protocols are allowed" };
  }

  if (isBlockedHostname(parsed.hostname)) {
    return { valid: false, error: "Access to internal/private network addresses is not allowed" };
  }

  return { valid: true };
}

/**
 * Maximum length for custom code to prevent DoS.
 */
export const MAX_CODE_LENGTH = 10000;

/**
 * Checks if custom code is too long.
 *
 * @param code - The code to check
 * @returns true if the code exceeds maximum length
 */
export function isCodeTooLong(code: string): boolean {
  return code.length > MAX_CODE_LENGTH;
}

/**
 * Patterns that might indicate unsafe code execution.
 */
const POTENTIALLY_UNSAFE_CODE_PATTERNS = [
  /require\s*\(\s*['"]fs['"]/i,
  /require\s*\(\s*['"]child_process['"]/i,
  /require\s*\(\s*['"]net['"]/i,
  /process\.exit/i,
  /process\.kill/i,
];

/**
 * Checks if code contains potentially unsafe patterns.
 * Note: This is a basic check and not a complete security solution.
 * The Browserless service should provide its own sandboxing.
 *
 * @param code - The code to check
 * @returns true if the code contains unsafe patterns
 */
export function hasUnsafeCodePatterns(code: string): boolean {
  return POTENTIALLY_UNSAFE_CODE_PATTERNS.some((pattern) => pattern.test(code));
}

/**
 * Validates concurrency limit.
 *
 * @param limit - The concurrency limit to validate
 * @returns A valid concurrency limit within acceptable range
 */
export function validateConcurrencyLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit < 1) {
    return DEFAULT_CONCURRENCY_LIMIT;
  }

  return Math.min(Math.max(Math.floor(limit), 1), MAX_CONCURRENCY_LIMIT);
}

export const DEFAULT_CONCURRENCY_LIMIT = 5;
export const MAX_CONCURRENCY_LIMIT = 20;

/**
 * Default timeout in milliseconds.
 */
export const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Maximum timeout in milliseconds.
 */
export const MAX_TIMEOUT_MS = 120000;

/**
 * Minimum timeout in milliseconds.
 */
export const MIN_TIMEOUT_MS = 5000;

/**
 * Validates a region string.
 *
 * @param region - The region to validate
 * @returns true if the region is valid
 */
export function isValidRegion(region: string | undefined): boolean {
  if (!region || typeof region !== "string") {
    return false;
  }
  return ["production-sfo", "production-lon", "production-ams"].includes(region);
}

/**
 * Validates a timeout value.
 *
 * @param timeout - The timeout to validate
 * @returns A valid timeout within acceptable range
 */
export function validateTimeout(timeout: number | undefined): number {
  if (timeout === undefined || !Number.isFinite(timeout)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.max(Math.floor(timeout), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

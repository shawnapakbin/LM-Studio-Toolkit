/**
 * Clock Policy Module
 *
 * Validates timezone and locale inputs for clock operations.
 */

/**
 * Validates whether a timezone string is a valid IANA timezone.
 *
 * @param timeZone - The timezone string to validate
 * @returns true if the timezone is valid
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes and validates a locale string.
 * Falls back to "en-US" if the locale is invalid or unsupported.
 *
 * @param locale - The locale string to normalize
 * @returns A valid locale string
 */
export function normalizeLocale(locale?: string): string {
  if (!locale || !locale.trim()) {
    return "en-US";
  }

  const trimmed = locale.trim();
  try {
    const supported = Intl.DateTimeFormat.supportedLocalesOf([trimmed]);
    return supported.length > 0 ? trimmed : "en-US";
  } catch {
    return "en-US";
  }
}

/**
 * Common IANA timezone identifiers for validation reference.
 */
export const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Australia/Sydney",
] as const;

/**
 * Checks if a timezone string looks like an IANA timezone format.
 * This is a heuristic check, not a complete validation.
 *
 * @param timeZone - The timezone string to check
 * @returns true if it looks like an IANA timezone
 */
export function looksLikeIANATimezone(timeZone: string): boolean {
  // IANA timezones are typically "Region/City" or "UTC"
  return /^[A-Z][A-Za-z_]+\/[A-Z][A-Za-z_]+$/.test(timeZone) || timeZone === "UTC";
}

/**
 * Maximum length for timezone string to prevent DoS.
 */
export const MAX_TIMEZONE_LENGTH = 100;

/**
 * Maximum length for locale string to prevent DoS.
 */
export const MAX_LOCALE_LENGTH = 20;

/**
 * Checks if a timezone string is within acceptable length limits.
 *
 * @param timeZone - The timezone string to check
 * @returns true if the timezone is too long
 */
export function isTimeZoneTooLong(timeZone: string): boolean {
  return timeZone.length > MAX_TIMEZONE_LENGTH;
}

/**
 * Checks if a locale string is within acceptable length limits.
 *
 * @param locale - The locale string to check
 * @returns true if the locale is too long
 */
export function isLocaleTooLong(locale: string): boolean {
  return locale.length > MAX_LOCALE_LENGTH;
}

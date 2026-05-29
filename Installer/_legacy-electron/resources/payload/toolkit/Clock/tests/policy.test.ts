/**
 * Clock Policy Tests
 *
 * Unit tests for timezone and locale validation.
 */

import {
  COMMON_TIMEZONES,
  MAX_LOCALE_LENGTH,
  MAX_TIMEZONE_LENGTH,
  isLocaleTooLong,
  isTimeZoneTooLong,
  isValidTimeZone,
  looksLikeIANATimezone,
  normalizeLocale,
} from "../src/policy";

describe("Clock Policy", () => {
  describe("isValidTimeZone", () => {
    it("should accept valid IANA timezones", () => {
      expect(isValidTimeZone("UTC")).toBe(true);
      expect(isValidTimeZone("America/New_York")).toBe(true);
      expect(isValidTimeZone("Europe/London")).toBe(true);
      expect(isValidTimeZone("Asia/Tokyo")).toBe(true);
      expect(isValidTimeZone("Australia/Sydney")).toBe(true);
    });

    it("should reject invalid timezones", () => {
      expect(isValidTimeZone("Invalid/Timezone")).toBe(false);
      expect(isValidTimeZone("Not_A_Real_Zone")).toBe(false);
      expect(isValidTimeZone("")).toBe(false);
      expect(isValidTimeZone("123")).toBe(false);
    });

    it("should accept all common timezones", () => {
      for (const tz of COMMON_TIMEZONES) {
        expect(isValidTimeZone(tz)).toBe(true);
      }
    });
  });

  describe("normalizeLocale", () => {
    it("should accept valid locales", () => {
      expect(normalizeLocale("en-US")).toBe("en-US");
      expect(normalizeLocale("fr-FR")).toBe("fr-FR");
      expect(normalizeLocale("ja-JP")).toBe("ja-JP");
      expect(normalizeLocale("de-DE")).toBe("de-DE");
    });

    it("should default to en-US for invalid locales", () => {
      expect(normalizeLocale("invalid-locale")).toBe("en-US");
      expect(normalizeLocale("xx-YY")).toBe("en-US");
      expect(normalizeLocale("")).toBe("en-US");
      expect(normalizeLocale(undefined)).toBe("en-US");
    });

    it("should trim whitespace", () => {
      expect(normalizeLocale("  en-US  ")).toBe("en-US");
      expect(normalizeLocale("  fr-FR  ")).toBe("fr-FR");
    });

    it("should handle empty strings", () => {
      expect(normalizeLocale("   ")).toBe("en-US");
    });
  });

  describe("looksLikeIANATimezone", () => {
    it("should recognize IANA timezone format", () => {
      expect(looksLikeIANATimezone("America/New_York")).toBe(true);
      expect(looksLikeIANATimezone("Europe/London")).toBe(true);
      expect(looksLikeIANATimezone("Asia/Tokyo")).toBe(true);
      expect(looksLikeIANATimezone("UTC")).toBe(true);
    });

    it("should reject non-IANA formats", () => {
      expect(looksLikeIANATimezone("EST")).toBe(false);
      expect(looksLikeIANATimezone("PST")).toBe(false);
      expect(looksLikeIANATimezone("GMT+5")).toBe(false);
      expect(looksLikeIANATimezone("invalid")).toBe(false);
      expect(looksLikeIANATimezone("")).toBe(false);
    });
  });

  describe("isTimeZoneTooLong", () => {
    it("should accept normal length timezones", () => {
      expect(isTimeZoneTooLong("America/New_York")).toBe(false);
      expect(isTimeZoneTooLong("UTC")).toBe(false);
      expect(isTimeZoneTooLong("a".repeat(MAX_TIMEZONE_LENGTH))).toBe(false);
    });

    it("should reject excessively long timezones", () => {
      expect(isTimeZoneTooLong("a".repeat(MAX_TIMEZONE_LENGTH + 1))).toBe(true);
      expect(isTimeZoneTooLong("a".repeat(200))).toBe(true);
    });
  });

  describe("isLocaleTooLong", () => {
    it("should accept normal length locales", () => {
      expect(isLocaleTooLong("en-US")).toBe(false);
      expect(isLocaleTooLong("fr-FR")).toBe(false);
      expect(isLocaleTooLong("a".repeat(MAX_LOCALE_LENGTH))).toBe(false);
    });

    it("should reject excessively long locales", () => {
      expect(isLocaleTooLong("a".repeat(MAX_LOCALE_LENGTH + 1))).toBe(true);
      expect(isLocaleTooLong("a".repeat(50))).toBe(true);
    });
  });
});

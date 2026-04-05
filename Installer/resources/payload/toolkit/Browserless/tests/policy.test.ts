/**
 * Browserless Policy Tests
 *
 * Unit tests for API validation and security constraints.
 */

import {
  DEFAULT_CONCURRENCY_LIMIT,
  DEFAULT_TIMEOUT_MS,
  MAX_CODE_LENGTH,
  MAX_CONCURRENCY_LIMIT,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  hasUnsafeCodePatterns,
  isBlockedHostname,
  isCodeTooLong,
  isValidApiKey,
  isValidRegion,
  validateConcurrencyLimit,
  validateTargetUrl,
  validateTimeout,
} from "../src/policy";

describe("Browserless Policy", () => {
  describe("isValidRegion", () => {
    it("should accept valid regions", () => {
      expect(isValidRegion("production-sfo")).toBe(true);
      expect(isValidRegion("production-lon")).toBe(true);
      expect(isValidRegion("production-ams")).toBe(true);
    });

    it("should reject invalid regions", () => {
      expect(isValidRegion("invalid-region")).toBe(false);
      expect(isValidRegion("production")).toBe(false);
      expect(isValidRegion("")).toBe(false);
    });
  });

  describe("validateTimeout", () => {
    it("should accept valid timeouts", () => {
      expect(validateTimeout(30000)).toBe(30000);
      expect(validateTimeout(60000)).toBe(60000);
      expect(validateTimeout(5000)).toBe(5000);
    });

    it("should clamp to minimum timeout", () => {
      expect(validateTimeout(500)).toBe(MIN_TIMEOUT_MS);
      expect(validateTimeout(0)).toBe(MIN_TIMEOUT_MS);
      expect(validateTimeout(-1000)).toBe(MIN_TIMEOUT_MS);
    });

    it("should clamp to maximum timeout", () => {
      expect(validateTimeout(200000)).toBe(MAX_TIMEOUT_MS);
      expect(validateTimeout(500000)).toBe(MAX_TIMEOUT_MS);
    });

    it("should use default for invalid values", () => {
      expect(validateTimeout(undefined)).toBe(DEFAULT_TIMEOUT_MS);
      expect(validateTimeout(Number.NaN)).toBe(DEFAULT_TIMEOUT_MS);
      expect(validateTimeout(Number.POSITIVE_INFINITY)).toBe(DEFAULT_TIMEOUT_MS);
    });
  });

  describe("isValidApiKey", () => {
    it("should accept valid API keys", () => {
      expect(isValidApiKey("1234567890")).toBe(true);
      expect(isValidApiKey("abcdefghij")).toBe(true);
      expect(isValidApiKey("valid-api-key-123")).toBe(true);
    });

    it("should reject invalid API keys", () => {
      expect(isValidApiKey("short")).toBe(false);
      expect(isValidApiKey("")).toBe(false);
      expect(isValidApiKey("   ")).toBe(false);
      expect(isValidApiKey(undefined)).toBe(false);
    });

    it("should reject non-string inputs", () => {
      expect(isValidApiKey(null as unknown as string)).toBe(false);
      expect(isValidApiKey(123 as unknown as string)).toBe(false);
    });
  });

  describe("isBlockedHostname", () => {
    it("should block localhost", () => {
      expect(isBlockedHostname("localhost")).toBe(true);
      expect(isBlockedHostname("LOCALHOST")).toBe(true);
    });

    it("should block loopback addresses", () => {
      expect(isBlockedHostname("127.0.0.1")).toBe(true);
      expect(isBlockedHostname("127.1.2.3")).toBe(true);
      expect(isBlockedHostname("::1")).toBe(true);
    });

    it("should block private IP ranges", () => {
      expect(isBlockedHostname("10.0.0.1")).toBe(true);
      expect(isBlockedHostname("192.168.1.1")).toBe(true);
      expect(isBlockedHostname("172.16.0.1")).toBe(true);
      expect(isBlockedHostname("169.254.1.1")).toBe(true);
    });

    it("should allow public addresses", () => {
      expect(isBlockedHostname("example.com")).toBe(false);
      expect(isBlockedHostname("google.com")).toBe(false);
      expect(isBlockedHostname("8.8.8.8")).toBe(false);
      expect(isBlockedHostname("1.1.1.1")).toBe(false);
    });
  });

  describe("validateTargetUrl", () => {
    it("should accept valid HTTP URLs", () => {
      expect(validateTargetUrl("http://example.com").valid).toBe(true);
      expect(validateTargetUrl("https://example.com").valid).toBe(true);
      expect(validateTargetUrl("https://example.com/path").valid).toBe(true);
    });

    it("should reject non-HTTP protocols", () => {
      expect(validateTargetUrl("ftp://example.com").valid).toBe(false);
      expect(validateTargetUrl("file:///etc/passwd").valid).toBe(false);
      expect(validateTargetUrl("javascript:alert(1)").valid).toBe(false);
    });

    it("should reject invalid URLs", () => {
      expect(validateTargetUrl("not-a-url").valid).toBe(false);
      expect(validateTargetUrl("").valid).toBe(false);
      expect(validateTargetUrl(null as unknown as string).valid).toBe(false);
    });

    it("should reject localhost URLs", () => {
      expect(validateTargetUrl("http://localhost").valid).toBe(false);
      expect(validateTargetUrl("http://127.0.0.1").valid).toBe(false);
    });

    it("should reject private IP URLs", () => {
      expect(validateTargetUrl("http://10.0.0.1").valid).toBe(false);
      expect(validateTargetUrl("http://192.168.1.1").valid).toBe(false);
      expect(validateTargetUrl("http://172.16.0.1").valid).toBe(false);
    });

    it("should provide error messages", () => {
      const result1 = validateTargetUrl("ftp://example.com");
      expect(result1.valid).toBe(false);
      expect(result1.error).toContain("HTTP");

      const result2 = validateTargetUrl("http://localhost");
      expect(result2.valid).toBe(false);
      expect(result2.error).toContain("internal");
    });
  });

  describe("isCodeTooLong", () => {
    it("should accept code under limit", () => {
      expect(isCodeTooLong("console.log('test')")).toBe(false);
      expect(isCodeTooLong("a".repeat(MAX_CODE_LENGTH))).toBe(false);
    });

    it("should reject code over limit", () => {
      expect(isCodeTooLong("a".repeat(MAX_CODE_LENGTH + 1))).toBe(true);
      expect(isCodeTooLong("a".repeat(20000))).toBe(true);
    });
  });

  describe("hasUnsafeCodePatterns", () => {
    it("should accept safe code", () => {
      expect(hasUnsafeCodePatterns("console.log('test')")).toBe(false);
      expect(hasUnsafeCodePatterns("const page = await browser.newPage()")).toBe(false);
      expect(hasUnsafeCodePatterns("await page.goto('http://example.com')")).toBe(false);
    });

    it("should reject code with fs module", () => {
      expect(hasUnsafeCodePatterns("const fs = require('fs')")).toBe(true);
      expect(hasUnsafeCodePatterns("require('fs').readFileSync('/etc/passwd')")).toBe(true);
    });

    it("should reject code with child_process module", () => {
      expect(hasUnsafeCodePatterns("const { exec } = require('child_process')")).toBe(true);
      expect(hasUnsafeCodePatterns("require('child_process').exec('ls')")).toBe(true);
    });

    it("should reject code with net module", () => {
      expect(hasUnsafeCodePatterns("const net = require('net')")).toBe(true);
    });

    it("should reject code with process.exit", () => {
      expect(hasUnsafeCodePatterns("process.exit(1)")).toBe(true);
      expect(hasUnsafeCodePatterns("process.exit()")).toBe(true);
    });

    it("should reject code with process.kill", () => {
      expect(hasUnsafeCodePatterns("process.kill(pid)")).toBe(true);
    });
  });

  describe("validateConcurrencyLimit", () => {
    it("should accept valid concurrency limits", () => {
      expect(validateConcurrencyLimit(5)).toBe(5);
      expect(validateConcurrencyLimit(10)).toBe(10);
      expect(validateConcurrencyLimit(1)).toBe(1);
    });

    it("should clamp to minimum (1)", () => {
      expect(validateConcurrencyLimit(0)).toBe(DEFAULT_CONCURRENCY_LIMIT);
      expect(validateConcurrencyLimit(-5)).toBe(DEFAULT_CONCURRENCY_LIMIT);
    });

    it("should clamp to maximum", () => {
      expect(validateConcurrencyLimit(50)).toBe(MAX_CONCURRENCY_LIMIT);
      expect(validateConcurrencyLimit(100)).toBe(MAX_CONCURRENCY_LIMIT);
    });

    it("should use default for invalid values", () => {
      expect(validateConcurrencyLimit(undefined)).toBe(DEFAULT_CONCURRENCY_LIMIT);
      expect(validateConcurrencyLimit(Number.NaN)).toBe(DEFAULT_CONCURRENCY_LIMIT);
      expect(validateConcurrencyLimit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_CONCURRENCY_LIMIT);
    });

    it("should floor decimal values", () => {
      expect(validateConcurrencyLimit(5.7)).toBe(5);
      expect(validateConcurrencyLimit(10.2)).toBe(10);
    });
  });
});

/**
 * Unit tests for env-manager.ts — resolveBrowserlessToken, maskTokenForDisplay,
 * and deprecated key handling.
 */

import { maskTokenForDisplay, resolveBrowserlessToken } from "../src/main/env-manager";

describe("resolveBrowserlessToken", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("returns BROWSERLESS_API_KEY when it is non-empty", () => {
    const result = resolveBrowserlessToken({
      BROWSERLESS_API_KEY: "my-key",
      BROWSERLESS_TOKEN: "legacy-token",
    });
    expect(result).toBe("my-key");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("trims BROWSERLESS_API_KEY before checking", () => {
    const result = resolveBrowserlessToken({
      BROWSERLESS_API_KEY: "  key-with-spaces  ",
      BROWSERLESS_TOKEN: "legacy",
    });
    expect(result).toBe("key-with-spaces");
  });

  test("falls back to BROWSERLESS_TOKEN when API_KEY is empty", () => {
    const result = resolveBrowserlessToken({
      BROWSERLESS_API_KEY: "",
      BROWSERLESS_TOKEN: "fallback-token",
    });
    expect(result).toBe("fallback-token");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("falls back to BROWSERLESS_TOKEN when API_KEY is whitespace-only", () => {
    const result = resolveBrowserlessToken({
      BROWSERLESS_API_KEY: "   ",
      BROWSERLESS_TOKEN: "fallback-token",
    });
    expect(result).toBe("fallback-token");
  });

  test("falls back to BROWSERLESS_TOKEN when API_KEY is missing", () => {
    const result = resolveBrowserlessToken({
      BROWSERLESS_TOKEN: "token-only",
    });
    expect(result).toBe("token-only");
  });

  test("trims BROWSERLESS_TOKEN fallback value", () => {
    const result = resolveBrowserlessToken({
      BROWSERLESS_API_KEY: "",
      BROWSERLESS_TOKEN: "  trimmed-token  ",
    });
    expect(result).toBe("trimmed-token");
  });

  test("returns empty string and warns when both are empty", () => {
    const result = resolveBrowserlessToken({
      BROWSERLESS_API_KEY: "",
      BROWSERLESS_TOKEN: "",
    });
    expect(result).toBe("");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("BROWSERLESS_API_KEY is not configured"),
    );
  });

  test("returns empty string and warns when both are missing", () => {
    const result = resolveBrowserlessToken({});
    expect(result).toBe("");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test("returns empty string and warns when both are whitespace-only", () => {
    const result = resolveBrowserlessToken({
      BROWSERLESS_API_KEY: "   ",
      BROWSERLESS_TOKEN: "  ",
    });
    expect(result).toBe("");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test("ignores deprecated keys without error", () => {
    // Deprecated keys in the env object should not affect resolution
    const result = resolveBrowserlessToken({
      BROWSERLESS_API_KEY: "valid-key",
      BROWSERLESS_DEFAULT_TIMEOUT_MS: "30000",
      BROWSERLESS_MAX_TIMEOUT_MS: "60000",
      BROWSERLESS_CONCURRENCY_LIMIT: "5",
    });
    expect(result).toBe("valid-key");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("maskTokenForDisplay", () => {
  test('returns "(not set)" for empty string', () => {
    expect(maskTokenForDisplay("")).toBe("(not set)");
  });

  test('returns "(not set)" for whitespace-only string', () => {
    expect(maskTokenForDisplay("   ")).toBe("(not set)");
  });

  test("masks short tokens (8 chars or less) with first 2 chars + ***", () => {
    expect(maskTokenForDisplay("abcdefgh")).toBe("ab***");
    expect(maskTokenForDisplay("abc")).toBe("ab***");
    expect(maskTokenForDisplay("ab")).toBe("ab***");
  });

  test("masks longer tokens with first 4 + *** + last 4", () => {
    expect(maskTokenForDisplay("abcdefghij")).toBe("abcd***ghij");
    expect(maskTokenForDisplay("my-super-secret-token-1234")).toBe("my-s***1234");
  });

  test("trims the value before masking", () => {
    expect(maskTokenForDisplay("  abcdefghij  ")).toBe("abcd***ghij");
    expect(maskTokenForDisplay("  short  ")).toBe("sh***");
  });

  test("handles exactly 9-character tokens with first4 + *** + last4", () => {
    // 9 chars: "123456789" -> first 4 "1234" + *** + last 4 "6789"
    expect(maskTokenForDisplay("123456789")).toBe("1234***6789");
  });

  test("handles single character token", () => {
    expect(maskTokenForDisplay("x")).toBe("x***");
  });
});

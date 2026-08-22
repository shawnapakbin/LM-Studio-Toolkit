/**
 * Unit tests for readEnvFallback - .env file backward compatibility.
 *
 * Tests cover:
 * - Reading a .env file and mapping keys to structured config paths
 * - Returning null when no .env file exists
 * - Handling comments and empty lines
 * - Handling quoted values (single and double)
 * - Skipping unrecognized keys
 * - Skipping malformed lines (no '=' separator)
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { readEnvFallback } from "../../src/env-fallback";

describe("readEnvFallback", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "env-fallback-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── Basic functionality ─────────────────────────────────────────────────────

  it("should return null when no .env file exists", () => {
    const result = readEnvFallback(tmpDir);
    expect(result).toBeNull();
  });

  it("should return a structured object for known .env keys", () => {
    const envContent = [
      "TERMINAL_DEFAULT_TIMEOUT_MS=90000",
      "TERMINAL_MAX_TIMEOUT_MS=180000",
      "TERMINAL_MAX_OUTPUT_CHARS=50000",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, ".env"), envContent);

    const result = readEnvFallback(tmpDir);

    expect(result).not.toBeNull();
    expect(result).toEqual({
      terminal: {
        defaultTimeoutMs: "90000",
        maxTimeoutMs: "180000",
        maxOutputChars: "50000",
      },
    });
  });

  it("should map keys from multiple tool namespaces", () => {
    const envContent = [
      "TERMINAL_DEFAULT_TIMEOUT_MS=90000",
      "BROWSER_HEADLESS=false",
      "CALCULATOR_DEFAULT_PRECISION=20",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, ".env"), envContent);

    const result = readEnvFallback(tmpDir);

    expect(result).not.toBeNull();
    expect(result).toEqual({
      terminal: { defaultTimeoutMs: "90000" },
      webbrowser: { headless: "false" },
      calculator: { defaultPrecision: "20" },
    });
  });

  // ─── Comments and empty lines ────────────────────────────────────────────────

  it("should skip comment lines starting with #", () => {
    const envContent = [
      "# This is a comment",
      "TERMINAL_DEFAULT_TIMEOUT_MS=60000",
      "# Another comment",
      "CALCULATOR_DEFAULT_PRECISION=10",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, ".env"), envContent);

    const result = readEnvFallback(tmpDir);

    expect(result).toEqual({
      terminal: { defaultTimeoutMs: "60000" },
      calculator: { defaultPrecision: "10" },
    });
  });

  it("should skip empty lines", () => {
    const envContent = [
      "",
      "TERMINAL_DEFAULT_TIMEOUT_MS=60000",
      "",
      "",
      "CALCULATOR_DEFAULT_PRECISION=10",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, ".env"), envContent);

    const result = readEnvFallback(tmpDir);

    expect(result).toEqual({
      terminal: { defaultTimeoutMs: "60000" },
      calculator: { defaultPrecision: "10" },
    });
  });

  // ─── Quoted values ───────────────────────────────────────────────────────────

  it("should strip double quotes from values", () => {
    const envContent = 'BROWSERLESS_API_KEY="my-secret-key-123"';
    fs.writeFileSync(path.join(tmpDir, ".env"), envContent);

    const result = readEnvFallback(tmpDir);

    expect(result).toEqual({
      browserless: { apiKey: "my-secret-key-123" },
    });
  });

  it("should strip single quotes from values", () => {
    const envContent = "BROWSERLESS_API_URL='https://custom.browserless.io'";
    fs.writeFileSync(path.join(tmpDir, ".env"), envContent);

    const result = readEnvFallback(tmpDir);

    expect(result).toEqual({
      browserless: { apiUrl: "https://custom.browserless.io" },
    });
  });

  it("should not strip mismatched quotes", () => {
    const envContent = "TERMINAL_DEFAULT_TIMEOUT_MS=\"3000'";
    fs.writeFileSync(path.join(tmpDir, ".env"), envContent);

    const result = readEnvFallback(tmpDir);

    expect(result).toEqual({
      terminal: { defaultTimeoutMs: "\"3000'" },
    });
  });

  // ─── Unrecognized keys ───────────────────────────────────────────────────────

  it("should skip keys not found in schemaMeta legacyEnvKey", () => {
    const envContent = [
      "TERMINAL_DEFAULT_TIMEOUT_MS=60000",
      "TOTALLY_UNKNOWN_KEY=somevalue",
      "ANOTHER_RANDOM=xyz",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, ".env"), envContent);

    const result = readEnvFallback(tmpDir);

    expect(result).toEqual({
      terminal: { defaultTimeoutMs: "60000" },
    });
  });

  // ─── Malformed lines ─────────────────────────────────────────────────────────

  it("should skip lines without an '=' separator", () => {
    const envContent = [
      "TERMINAL_DEFAULT_TIMEOUT_MS=60000",
      "THIS_LINE_HAS_NO_EQUALS",
      "CALCULATOR_DEFAULT_PRECISION=15",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, ".env"), envContent);

    const result = readEnvFallback(tmpDir);

    expect(result).toEqual({
      terminal: { defaultTimeoutMs: "60000" },
      calculator: { defaultPrecision: "15" },
    });
  });

  // ─── Edge cases ──────────────────────────────────────────────────────────────

  it("should handle values containing '=' characters", () => {
    const envContent = "BROWSERLESS_API_URL=https://api.example.com?key=abc&token=xyz";
    fs.writeFileSync(path.join(tmpDir, ".env"), envContent);

    const result = readEnvFallback(tmpDir);

    expect(result).toEqual({
      browserless: { apiUrl: "https://api.example.com?key=abc&token=xyz" },
    });
  });

  it("should handle empty values", () => {
    const envContent = "BROWSERLESS_API_KEY=";
    fs.writeFileSync(path.join(tmpDir, ".env"), envContent);

    const result = readEnvFallback(tmpDir);

    expect(result).toEqual({
      browserless: { apiKey: "" },
    });
  });

  it("should handle Windows line endings (CRLF)", () => {
    const envContent = "TERMINAL_DEFAULT_TIMEOUT_MS=60000\r\nCALCULATOR_DEFAULT_PRECISION=10\r\n";
    fs.writeFileSync(path.join(tmpDir, ".env"), envContent);

    const result = readEnvFallback(tmpDir);

    expect(result).toEqual({
      terminal: { defaultTimeoutMs: "60000" },
      calculator: { defaultPrecision: "10" },
    });
  });

  it("should default to process.cwd() when no basePath is provided", () => {
    // This just verifies it doesn't throw - the actual result depends on CWD
    const result = readEnvFallback();
    // Result can be null or an object depending on whether .env exists at CWD
    expect(result === null || typeof result === "object").toBe(true);
  });

  it("should return an empty object when .env exists but only has comments", () => {
    const envContent = ["# Comment 1", "# Comment 2", ""].join("\n");
    fs.writeFileSync(path.join(tmpDir, ".env"), envContent);

    const result = readEnvFallback(tmpDir);

    expect(result).toEqual({});
  });

  it("should handle sensitive keys correctly", () => {
    const envContent = [
      "BROWSERLESS_API_KEY=secret-token-value",
      "BROWSERLESS_API_TOKEN=another-secret",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, ".env"), envContent);

    const result = readEnvFallback(tmpDir);

    // The function just maps values; sensitivity is handled elsewhere
    expect(result).toEqual({
      browserless: { apiKey: "secret-token-value" },
      agentrunner: { browserlessApiToken: "another-secret" },
    });
  });
});

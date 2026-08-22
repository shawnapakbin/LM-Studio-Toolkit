/**
 * Unit tests for redactConfig utility.
 *
 * Validates:
 * - Sensitive fields get "[REDACTED]"
 * - Non-sensitive fields remain unchanged
 * - Original config object is not mutated
 */

import { REDACTED_PLACEHOLDER, redactConfig } from "../../src/redact";

describe("redactConfig", () => {
  it("replaces sensitive fields with [REDACTED]", () => {
    const config = {
      browserless: {
        apiKey: "super-secret-key-123",
        apiUrl: "https://production-sfo.browserless.io",
      },
      agentrunner: {
        browserlessApiToken: "token-abc-456",
        basePort: 3000,
      },
      terminal: {
        defaultTimeoutMs: 60000,
      },
    };

    const redacted = redactConfig(config);

    expect(redacted.browserless).toEqual({
      apiKey: REDACTED_PLACEHOLDER,
      apiUrl: "https://production-sfo.browserless.io",
    });
    expect(redacted.agentrunner).toEqual({
      browserlessApiToken: REDACTED_PLACEHOLDER,
      basePort: 3000,
    });
  });

  it("leaves non-sensitive fields unchanged", () => {
    const config = {
      terminal: {
        defaultTimeoutMs: 60000,
        maxTimeoutMs: 120000,
        maxOutputChars: 100000,
        port: 3001,
      },
      global: {
        logLevel: "debug",
        workspaceRoot: "/home/user/workspace",
      },
    };

    const redacted = redactConfig(config);

    expect(redacted.terminal).toEqual(config.terminal);
    expect(redacted.global).toEqual(config.global);
  });

  it("does not mutate the original config object", () => {
    const original = {
      browserless: {
        apiKey: "my-secret-api-key",
        apiUrl: "https://example.com",
      },
      agentrunner: {
        browserlessApiToken: "my-token",
      },
    };

    // Snapshot original values
    const originalApiKey = original.browserless.apiKey;
    const originalToken = original.agentrunner.browserlessApiToken;

    redactConfig(original);

    // Original must remain untouched
    expect(original.browserless.apiKey).toBe(originalApiKey);
    expect(original.agentrunner.browserlessApiToken).toBe(originalToken);
  });

  it("handles config where sensitive namespace is missing", () => {
    const config = {
      terminal: {
        defaultTimeoutMs: 60000,
      },
    };

    // Should not throw when sensitive paths don't exist in the config
    const redacted = redactConfig(config);
    expect(redacted.terminal).toEqual({ defaultTimeoutMs: 60000 });
    expect(redacted.browserless).toBeUndefined();
  });

  it("handles config where sensitive key is missing within an existing namespace", () => {
    const config = {
      browserless: {
        apiUrl: "https://production-sfo.browserless.io",
        // apiKey is NOT present
      },
    };

    const redacted = redactConfig(config);

    // apiKey should not appear since it wasn't in the original
    expect(redacted.browserless).toEqual({
      apiUrl: "https://production-sfo.browserless.io",
    });
    expect((redacted.browserless as Record<string, unknown>).apiKey).toBeUndefined();
  });
});

/**
 * Property-based tests for Installer env-manager.
 * Uses fast-check to verify correctness properties across generated inputs.
 *
 * Feature: browserless-mcp-migration, Property 2: Endpoint Resolution
 */
import * as fc from "fast-check";
import { resolveBrowserlessEndpoint } from "../src/main/env-manager";

/**
 * **Validates: Requirements 4.2, 5.3**
 *
 * Property 2: Endpoint Resolution
 * For any environment configuration, the resolved Browserless fallback endpoint SHALL equal
 * the value of BROWSERLESS_MCP_ENDPOINT (trimmed) if it is set and non-empty. Otherwise,
 * the endpoint SHALL equal {BROWSERLESS_API_URL}/smartscraper when BROWSERLESS_API_URL is
 * set and non-empty, or https://production-sfo.browserless.io/smartscraper when
 * BROWSERLESS_API_URL is absent or empty.
 */
describe("Feature: browserless-mcp-migration, Property 2: Endpoint Resolution", () => {
  const DEFAULT_ENDPOINT = "https://production-sfo.browserless.io/smartscraper";

  test("when BROWSERLESS_MCP_ENDPOINT is set and non-empty, uses its trimmed value", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        fc.string(), // arbitrary BROWSERLESS_API_URL (should be ignored)
        (mcpEndpoint, apiUrl) => {
          const env: Record<string, string> = {
            BROWSERLESS_MCP_ENDPOINT: mcpEndpoint,
            BROWSERLESS_API_URL: apiUrl,
          };
          const result = resolveBrowserlessEndpoint(env);
          expect(result).toBe(mcpEndpoint.trim());
        },
      ),
      { numRuns: 100 },
    );
  });

  test("when BROWSERLESS_MCP_ENDPOINT is empty/whitespace and BROWSERLESS_API_URL is non-empty, uses API_URL + /smartscraper", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("", " ", "  ", "\t", "\n"), // empty or whitespace-only MCP endpoint
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        (mcpEndpoint, apiUrl) => {
          const env: Record<string, string> = {
            BROWSERLESS_MCP_ENDPOINT: mcpEndpoint,
            BROWSERLESS_API_URL: apiUrl,
          };
          const result = resolveBrowserlessEndpoint(env);
          expect(result).toBe(`${apiUrl.trim()}/smartscraper`);
        },
      ),
      { numRuns: 100 },
    );
  });

  test("when both BROWSERLESS_MCP_ENDPOINT and BROWSERLESS_API_URL are empty/absent, returns default endpoint", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("", " ", "  ", "\t", "\n", undefined as unknown as string),
        fc.constantFrom("", " ", "  ", "\t", "\n", undefined as unknown as string),
        (mcpEndpoint, apiUrl) => {
          const env: Record<string, string> = {};
          if (mcpEndpoint !== undefined) env.BROWSERLESS_MCP_ENDPOINT = mcpEndpoint;
          if (apiUrl !== undefined) env.BROWSERLESS_API_URL = apiUrl;
          const result = resolveBrowserlessEndpoint(env);
          expect(result).toBe(DEFAULT_ENDPOINT);
        },
      ),
      { numRuns: 100 },
    );
  });

  test("BROWSERLESS_MCP_ENDPOINT takes priority over BROWSERLESS_API_URL for any non-empty strings", () => {
    fc.assert(
      fc.property(
        fc.webUrl(), // generate valid URL-like strings for MCP endpoint
        fc.webUrl(), // generate valid URL-like strings for API URL
        (mcpEndpoint, apiUrl) => {
          const env: Record<string, string> = {
            BROWSERLESS_MCP_ENDPOINT: mcpEndpoint,
            BROWSERLESS_API_URL: apiUrl,
          };
          const result = resolveBrowserlessEndpoint(env);
          // MCP endpoint always wins when non-empty
          expect(result).toBe(mcpEndpoint.trim());
          expect(result).not.toBe(`${apiUrl.trim()}/smartscraper`);
        },
      ),
      { numRuns: 100 },
    );
  });

  test("endpoint resolution never returns empty string", () => {
    fc.assert(
      fc.property(
        fc.option(fc.string(), { nil: undefined }),
        fc.option(fc.string(), { nil: undefined }),
        (mcpEndpoint, apiUrl) => {
          const env: Record<string, string> = {};
          if (mcpEndpoint !== undefined) env.BROWSERLESS_MCP_ENDPOINT = mcpEndpoint;
          if (apiUrl !== undefined) env.BROWSERLESS_API_URL = apiUrl;
          const result = resolveBrowserlessEndpoint(env);
          expect(result.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

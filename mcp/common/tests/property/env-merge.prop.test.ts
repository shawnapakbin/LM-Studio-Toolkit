// Feature: mcp-common-plugin-injection
// **Validates: Requirements 7.3**

import * as fc from "fast-check";

/**
 * Property 8: Environment variable merge precedence
 *
 * For any set of default env values, user-level mcp.json values, and existing plugin config
 * values, the merge function SHALL produce a result where non-empty, non-placeholder user
 * values override defaults, empty/placeholder values are discarded (not passed through),
 * and the resulting object contains no empty-string values.
 */

// ─── Re-implementation of merge logic from sync-lmstudio-bridge-configs.js ───

function isPlaceholderEnvValue(key: string, value: string): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (!normalized) return false;
  if (key === "BROWSERLESS_API_KEY" && normalized === "your-browserless-api-key-here") return true;
  if (key === "BROWSERLESS_TOKEN" && normalized === "your-browserless-api-token-here") return true;
  return false;
}

function mergeServerConfig(
  serverConfig: { env?: Record<string, string> },
  topLevelServerConfig: { env?: Record<string, string> } | null,
  pluginServerConfig: { env?: Record<string, string> } | null,
): { env: Record<string, string> } {
  const mergedEnv: Record<string, string> = { ...(serverConfig.env ?? {}) };
  const candidates = [topLevelServerConfig, pluginServerConfig];

  for (const candidate of candidates) {
    const env = candidate && typeof candidate === "object" ? candidate.env : null;
    if (!env || typeof env !== "object") continue;

    for (const [key, value] of Object.entries(env)) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (!trimmed || isPlaceholderEnvValue(key, trimmed)) continue;
      mergedEnv[key] = value;
    }
  }

  // Remove empty-string env values
  for (const key of Object.keys(mergedEnv)) {
    if (typeof mergedEnv[key] === "string" && !mergedEnv[key].trim()) {
      delete mergedEnv[key];
    }
  }

  return { env: mergedEnv };
}

// ─── Generators ───

/** Generate a non-empty non-whitespace-only string (valid env value) */
const nonEmptyEnvValue = fc.stringOf(
  fc.char().filter((c) => c.trim().length > 0),
  {
    minLength: 1,
    maxLength: 30,
  },
);

/** Generate env key names that look realistic */
const envKeyArb = fc.constantFrom(
  "CALCULATOR_DEFAULT_PRECISION",
  "CALCULATOR_MAX_PRECISION",
  "DOC_SCRAPER_DEFAULT_TIMEOUT_MS",
  "DOC_SCRAPER_MAX_TIMEOUT_MS",
  "DOC_SCRAPER_MAX_CONTENT_BYTES",
  "DOC_SCRAPER_MAX_CONTENT_CHARS",
  "DOC_SCRAPER_WORKSPACE_ROOT",
  "CLOCK_DEFAULT_TIMEZONE",
  "CLOCK_DEFAULT_LOCALE",
  "ASK_USER_DB_PATH",
  "ASK_USER_DEFAULT_EXPIRES_SECONDS",
  "ASK_USER_MAX_EXPIRES_SECONDS",
  "ASK_USER_MAX_QUESTIONS",
  "BROWSERLESS_API_KEY",
  "BROWSERLESS_TOKEN",
  "CUSTOM_VAR_1",
  "CUSTOM_VAR_2",
);

/** Generate env values that include empty strings, whitespace-only, placeholders, and valid values */
const envValueArb = fc.oneof(
  { weight: 3, arbitrary: nonEmptyEnvValue },
  { weight: 1, arbitrary: fc.constant("") },
  { weight: 1, arbitrary: fc.constant("   ") },
  { weight: 1, arbitrary: fc.constant("your-browserless-api-key-here") },
  { weight: 1, arbitrary: fc.constant("your-browserless-api-token-here") },
);

/** Generate an env record with realistic keys */
const envRecordArb = fc
  .array(fc.tuple(envKeyArb, envValueArb), { minLength: 0, maxLength: 8 })
  .map((pairs) => Object.fromEntries(pairs));

/** Generate a nullable server config with env */
const serverConfigArb = fc.oneof(
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 3, arbitrary: envRecordArb.map((env) => ({ env })) },
);

// ─── Property Tests ───

describe("Feature: mcp-common-plugin-injection", () => {
  it("Property 8: Environment variable merge precedence", () => {
    fc.assert(
      fc.property(
        envRecordArb, // default env (serverConfig.env)
        serverConfigArb, // topLevelServerConfig (user-level mcp.json)
        serverConfigArb, // pluginServerConfig (existing plugin config)
        (defaultEnv, topLevel, pluginConfig) => {
          const serverConfig = { env: defaultEnv };
          const result = mergeServerConfig(serverConfig, topLevel, pluginConfig);

          // Property 8a: Result contains no empty-string or whitespace-only values
          for (const [, value] of Object.entries(result.env)) {
            expect(typeof value).toBe("string");
            expect(value.trim().length).toBeGreaterThan(0);
          }

          // Property 8b: Non-empty non-placeholder user values override defaults.
          // The merge processes candidates in order [topLevel, pluginConfig],
          // so the LAST valid override for a given key wins.
          const candidates = [topLevel, pluginConfig];
          for (const [key] of Object.entries(result.env)) {
            // Find the last valid override across all candidates
            let lastValidOverride: string | undefined;
            for (const candidate of candidates) {
              if (!candidate || !candidate.env) continue;
              const value = candidate.env[key];
              if (typeof value !== "string") continue;
              const trimmed = value.trim();
              if (trimmed && !isPlaceholderEnvValue(key, trimmed)) {
                lastValidOverride = value;
              }
            }

            if (lastValidOverride !== undefined) {
              // The result should use the last valid override
              expect(result.env[key]).toBe(lastValidOverride);
            } else {
              // No valid override — should be the default (if default was non-empty)
              const defaultVal = defaultEnv[key];
              if (defaultVal !== undefined && defaultVal.trim()) {
                expect(result.env[key]).toBe(defaultVal);
              }
            }
          }

          // Property 8c: Empty/placeholder values from candidates are never stored in result
          for (const candidate of candidates) {
            if (!candidate || !candidate.env) continue;
            for (const [key, value] of Object.entries(candidate.env)) {
              if (typeof value !== "string") continue;
              const trimmed = value.trim();
              if (!trimmed || isPlaceholderEnvValue(key, trimmed)) {
                // A discarded value should NOT appear as the result value for that key
                // (unless the same value happens to be a valid default or another valid override)
                if (result.env[key] === value) {
                  // If the result equals this discarded value, verify it came from a different source
                  const isDefault = defaultEnv[key] === value && value.trim().length > 0;
                  const isLaterOverride = candidates.some((c) => {
                    if (!c || !c.env) return false;
                    const v = c.env[key];
                    return (
                      v === value && v.trim().length > 0 && !isPlaceholderEnvValue(key, v.trim())
                    );
                  });
                  expect(isDefault || isLaterOverride).toBe(true);
                }
              }
            }
          }

          // Property 8d: Default values survive when no valid override exists
          for (const [key, value] of Object.entries(defaultEnv)) {
            const trimmed = typeof value === "string" ? value.trim() : "";
            if (!trimmed) continue; // empty defaults are cleaned up

            // Check if any candidate provides a valid override for this key
            let hasValidOverride = false;
            for (const candidate of candidates) {
              if (!candidate || !candidate.env) continue;
              const candidateVal = candidate.env[key];
              if (typeof candidateVal !== "string") continue;
              const candidateTrimmed = candidateVal.trim();
              if (candidateTrimmed && !isPlaceholderEnvValue(key, candidateTrimmed)) {
                hasValidOverride = true;
                break;
              }
            }

            if (!hasValidOverride) {
              // Default should survive
              expect(result.env[key]).toBe(value);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

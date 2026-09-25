import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import fc from "fast-check";

/**
 * Bugfix: installer-plugin-path-and-browserless-secret
 * Property 2 (Bug Condition — No Secret Embedded In Payload) — Concern 2.
 *
 * These tests encode the EXPECTED (fixed) behavior and are expected to FAIL on
 * the UNFIXED code, confirming Defect 2: a non-empty, non-placeholder
 * BROWSERLESS_TOKEN can sit in the staged `payload/` with nothing failing the
 * build.
 *
 * The staging secret guard is NEW code (a Rust predicate in `config_gen.rs`
 * plus TS wiring in `stage-payload.ts`). On the unfixed code no guard exists,
 * so we DO NOT import a not-yet-existing symbol (which would break compilation
 * of the whole suite). Instead we express the assertion over the OBSERVABLE
 * outcome: after "staging" a payload seeded with a live-looking secret, the
 * build must have ABORTED and the secret must NOT remain in the staged tree.
 *
 * We detect the guard's presence dynamically: if `scanPayloadForSecrets` (or an
 * equivalent) is exported from `stage-payload`, we exercise it; otherwise we
 * record that no guard ran, which is exactly the bug condition and makes the
 * Expected-Behavior assertion fail meaningfully.
 *
 * Validates: Requirements 2.4, 2.5, 2.6
 */

// A non-empty, non-placeholder token value (shaped like the observed live one).
const SEEDED_SECRET = "2TNn0yOdSpEFIT49a897dc67e03352d172e69c1b07bf3d930";

// Known placeholders that MUST NOT be treated as secrets (preservation).
const PLACEHOLDERS = ["your-browserless-api-token-here", "your-browserless-api-key-here", ""];

interface SeededPayload {
  root: string;
  /** The staged browserless dir that holds the offending file. */
  browserlessDir: string;
  /** The file seeded with the live secret. */
  offendingFile: string;
  cleanup(): void;
}

/**
 * Build a staged `payload/` tree seeded with a non-empty, non-placeholder
 * BROWSERLESS_TOKEN in a browserless bridge config, mimicking what a build run
 * on a developer machine with a real token would embed.
 */
function seedPayloadWithSecret(secret: string): SeededPayload {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "payload-secret-"));
  const browserlessDir = path.join(root, "browserless");
  fs.mkdirSync(browserlessDir, { recursive: true });
  // A benign entry file, plus a config carrying the seeded secret.
  fs.writeFileSync(path.join(browserlessDir, "schema-proxy.js"), "// entry\n");
  const offendingFile = path.join(browserlessDir, "mcp-bridge-config.json");
  fs.writeFileSync(
    offendingFile,
    JSON.stringify(
      { command: "node", args: ["schema-proxy.js"], env: { BROWSERLESS_TOKEN: secret } },
      null,
      2,
    ),
  );
  return {
    root,
    browserlessDir,
    offendingFile,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Recursively read every file's text under `dir`. */
function readAllText(dir: string): string {
  let combined = "";
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) combined += readAllText(p);
    else combined += fs.readFileSync(p, "utf8");
  }
  return combined;
}

/**
 * Run the staging secret guard against a staged payload root if one is
 * exported, returning whether it flagged/aborted on a secret.
 *
 * Resolves dynamically so the suite compiles on the unfixed code where no guard
 * exists. Returns `{ available: false }` when no guard export is found — which
 * is itself the bug condition (no enforcement).
 */
function runStagingGuard(
  stagingRoot: string,
): { available: true; aborted: boolean } | { available: false } {
  // Load the staging module defensively. On the UNFIXED code the module both
  // lacks a guard export AND is authored as ESM (`import.meta`), so requiring it
  // under jest's CJS transform throws. We treat ANY load/resolve failure as
  // "no guard available" — which is precisely the bug condition (no
  // enforcement) — rather than letting a load error masquerade as the result.
  let mod: Record<string, unknown>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require("../../scripts/stage-payload") as Record<string, unknown>;
  } catch {
    return { available: false };
  }

  const candidate =
    (mod.scanPayloadForSecrets as ((root: string) => unknown) | undefined) ??
    (mod.assertNoStagedSecrets as ((root: string) => unknown) | undefined) ??
    (mod.scanStagedPayloadForSecrets as ((root: string) => unknown) | undefined);

  if (typeof candidate !== "function") {
    return { available: false };
  }

  // A guard "aborts" either by throwing or by returning a non-empty findings
  // list. Treat either as detection.
  try {
    const result = candidate(stagingRoot);
    const findings = Array.isArray(result)
      ? result
      : (result as { findings?: unknown[] })?.findings;
    const aborted = Array.isArray(findings) ? findings.length > 0 : Boolean(result);
    return { available: true, aborted };
  } catch {
    // Threw / process-exit-style abort -> the secret was detected.
    return { available: true, aborted: true };
  }
}

describe("Property 2: Bug Condition — staging guard aborts on a non-empty secret in the payload", () => {
  /**
   * Test case: a seeded live-looking BROWSERLESS_TOKEN in the staged payload
   * MUST be detected and the build MUST abort, so the secret never ships.
   * FAILS on unfixed code because no guard exists (nothing aborts and the
   * secret remains in the staged tree).
   */
  it("detects and aborts on a non-empty, non-placeholder BROWSERLESS_TOKEN in the staged payload", () => {
    const payload = seedPayloadWithSecret(SEEDED_SECRET);
    try {
      // Sanity: the secret really is sitting in the staged tree.
      expect(readAllText(payload.root)).toContain(SEEDED_SECRET);

      const guard = runStagingGuard(payload.root);

      // Expected Behavior: a guard exists AND it aborts on the seeded secret.
      // On the unfixed pipeline no guard is wired, so `available` is false and
      // this fails — surfacing the counterexample (secret present, no abort).
      expect(guard.available).toBe(true);
      expect(guard.available && guard.aborted).toBe(true);
    } finally {
      payload.cleanup();
    }
  });

  /**
   * Preservation-oriented companion (encodes the intended guard behavior): the
   * guard must NOT flag empty/placeholder values. This also fails on unfixed
   * code (no guard) but documents the intended non-flagging contract.
   */
  it("does not abort on empty/placeholder BROWSERLESS_TOKEN values", () => {
    fc.assert(
      fc.property(fc.constantFrom(...PLACEHOLDERS), (placeholder) => {
        const payload = seedPayloadWithSecret(placeholder);
        try {
          const guard = runStagingGuard(payload.root);
          // Expected: a guard exists and does NOT abort on a placeholder/empty.
          expect(guard.available).toBe(true);
          expect(guard.available && guard.aborted).toBe(false);
        } finally {
          payload.cleanup();
        }
      }),
      { numRuns: PLACEHOLDERS.length },
    );
  });
});

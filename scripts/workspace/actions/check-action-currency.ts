/**
 * GitHub Action major-currency check — a Phase G gate for
 * dependency-refresh-node24.
 *
 * Feature: dependency-refresh-node24 (Requirements 7.1, 7.2)
 *
 * Thin I/O wrapper around the pure `action-currency-core` currency decision. It
 * scans both workflow files for every `uses: <action>@<ref>` reference, pairs
 * each with the EXPECTED current major for that action, runs the pure
 * `checkActionCurrency` decision, prints the result, and exits 0 when every
 * reference pins its expected current major via an immutable major tag or
 * non-zero listing each flagged `{ filePath, action, pinned }` otherwise
 * (Req 7.1 / 7.2, Property 9).
 *
 * Sources scanned:
 *   - every `uses: <action>@<ref>` step across `.github/workflows/ci.yml` and
 *     `.github/workflows/installer-release.yml`.
 *
 * The scan deliberately avoids a YAML dependency (matching the dependency-free
 * style of the sibling `scripts/workspace` checks — `check-node-24.ts`,
 * `check-crate-currency.ts`, `check-shared-consistency.ts`): a `uses:` step is a
 * single line of the shape `<indent>[- ]uses: <action>@<ref>`, extracted with a
 * narrow, well-commented parser.
 *
 * The EXPECTED-major table below is the single source of truth for "the current
 * major" of each action the refresh bumped (tasks 7.1 / 7.2). Actions not in the
 * table are reported but not gated (no expectation is asserted for them), so an
 * unrelated future action addition does not spuriously fail the gate; the table
 * is the deliberate allow-list of what Phase G is responsible for.
 *
 * Run with: `tsx scripts/workspace/actions/check-action-currency.ts`.
 * Flags:
 *   --json   emit the full `ActionCurrencyReport` as JSON instead of text.
 *
 * Exit code: 0 when every gated reference is current; 1 when one or more are
 * flagged (each listed); 2 when the scan itself cannot run.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type ActionCurrencyReport,
  type ActionRef,
  checkActionCurrency,
  extractUses,
  pairWithExpected,
} from "./action-currency-core.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// scripts/workspace/actions -> repo root is three levels up.
const repoRoot = resolve(scriptDir, "..", "..", "..");

/** Repo-relative, forward-slash path for stable reporting. */
function repoRelative(absPath: string): string {
  return relative(repoRoot, absPath).replaceAll("\\", "/");
}

/**
 * Scan both workflow files and build the `ActionRef[]` the pure core consumes,
 * pairing each `uses:` reference with its expected current major.
 *
 * All parsing / pairing logic is the pure `extractUses` + `pairWithExpected`
 * from the core; this wrapper only supplies file contents. References for
 * actions not in the expected-major allow-list are dropped (Phase G asserts no
 * expectation for them). `workflowPaths` defaults to the two real workflows but
 * is overridable to keep this wrapper test-friendly.
 */
export function scanActionRefs(
  workflowPaths: string[] = [
    join(repoRoot, ".github", "workflows", "ci.yml"),
    join(repoRoot, ".github", "workflows", "installer-release.yml"),
  ],
): ActionRef[] {
  const usesRefs = [];
  for (const absPath of workflowPaths) {
    if (!existsSync(absPath)) continue;
    const filePath = repoRelative(absPath);
    const content = readFileSync(absPath, "utf8");
    usesRefs.push(...extractUses(filePath, content));
  }
  return pairWithExpected(usesRefs);
}

/** Run the full scan and produce the currency report via the pure core. */
export function runScan(): ActionCurrencyReport {
  return checkActionCurrency(scanActionRefs());
}

function main(): void {
  const asJson = process.argv.slice(2).includes("--json");
  let report: ActionCurrencyReport;
  try {
    report = runScan();
  } catch (err) {
    console.error(`[action-currency] scan failed: ${String(err)}`);
    process.exit(2);
    return;
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[action-currency] evaluated ${report.refs.length} gated action reference(s):`);
    for (const ref of report.refs) {
      const bad = report.flagged.some(
        (f) => f.filePath === ref.filePath && f.action === ref.action && f.pinned === ref.pinned,
      );
      const mark = bad ? "FAIL" : "ok  ";
      console.log(
        `  [${mark}] ${ref.filePath} -> ${ref.action}@${ref.pinned} (expected @${ref.expected})`,
      );
    }
  }

  if (report.ok) {
    console.log(
      `[action-currency] OK: all ${report.refs.length} gated action reference(s) pin the current major via an immutable major tag.`,
    );
    process.exit(0);
  }

  console.error(
    `[action-currency] FAILED: ${report.flagged.length} action reference(s) not current:`,
  );
  for (const f of report.flagged) {
    console.error(`  - ${f.filePath}: ${f.action}@${f.pinned} — ${f.reason}`);
  }
  process.exit(1);
}

// Only run when invoked directly (not when imported by tests).
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main();
}

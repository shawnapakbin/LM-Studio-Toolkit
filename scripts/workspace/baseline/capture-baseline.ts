/**
 * Pre-refresh baseline capture — the regression oracle for dependency-refresh-node24.
 *
 * Feature: dependency-refresh-node24 (Requirements 10.1, 10.4, 10.5)
 *
 * Thin I/O wrapper around the pure `baseline-core` normalization. Phase A of the
 * refresh (task 1.2) runs this on the UNCHANGED repo (Node 20, current deps) so
 * the snapshot reflects pre-refresh state — including any known-failing or
 * environment-skipped cases (e.g. the `3DTool` ESM-skip), which are not
 * regressions if they still fail after the refresh.
 *
 * What it does (design.md "Baseline: the regression oracle"):
 *   1. Runs the jest corpus with `--json`:
 *        - the root jest project (the `jest --ci` part of `npm run test:ci`), plus
 *        - the workspace suites NOT covered by the root project:
 *            -w CLI, -w SlashCommands, -w mcp/common, -w AgentRunner,
 *            -w Memory, -w Skills, -w shared/config, -w Installer
 *   2. Runs `cargo test` in `Installer/src-tauri` with libtest JSON output.
 *   3. Reads the LIVE current Repo_Version from root `package.json`
 *      (never hardcoded — the design reads the live version at capture time).
 *   4. Normalizes everything into a `Baseline` record via the pure core and
 *      persists it as a machine-comparable JSON artifact under the spec dir.
 *
 * Run with: `tsx scripts/workspace/baseline/capture-baseline.ts`.
 * Flags:
 *   --out <path>   override the artifact output path.
 *   --dry-run      resolve config + version but skip running suites (prints plan).
 *
 * Exit code: 0 when the artifact is written (regardless of individual test
 * pass/fail — the capture records failures, it does not gate on them). Non-zero
 * only when the capture itself cannot run (e.g. root package.json unreadable).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type Baseline,
  normalizeCargoOutput,
  normalizeJestReport,
  type SuiteCapture,
  type TestResult,
} from "./baseline-core.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// scripts/workspace/baseline -> repo root is three levels up.
const repoRoot = resolve(scriptDir, "..", "..", "..");

/** Default artifact location: alongside the spec, in a machine-readable JSON. */
const DEFAULT_OUT = resolve(
  repoRoot,
  ".kiro",
  "specs",
  "dependency-refresh-node24",
  "baseline",
  "baseline.json",
);

/**
 * The jest suites that make up the baseline corpus.
 *
 * The first entry is the root jest project (the `jest --ci` half of the root
 * `test:ci` script). The rest are the workspace suites the root project does
 * not cover, expressed exactly as the task specifies (`-w <workspace>`).
 */
interface JestSuiteSpec {
  /** Human label used only in logs. */
  label: string;
  /** argv passed to the `npx jest` invocation (workspace flag or root project). */
  args: string[];
}

const JEST_SUITES: JestSuiteSpec[] = [
  { label: "root", args: ["--ci"] },
  { label: "CLI", args: ["-w", "CLI"] },
  { label: "SlashCommands", args: ["-w", "SlashCommands"] },
  { label: "mcp/common", args: ["-w", "mcp/common"] },
  { label: "AgentRunner", args: ["-w", "AgentRunner"] },
  { label: "Memory", args: ["-w", "Memory"] },
  { label: "Skills", args: ["-w", "Skills"] },
  { label: "shared/config", args: ["-w", "shared/config"] },
  { label: "Installer", args: ["-w", "Installer"] },
];

/** Read the live Repo_Version from root `package.json` (never hardcoded). */
export function readLiveRepoVersion(): string {
  const pkgPath = resolve(repoRoot, "package.json");
  const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
  if (typeof parsed.version !== "string") {
    throw new TypeError(`root package.json has no string \`version\` field (${pkgPath})`);
  }
  return parsed.version;
}

/**
 * Run one jest suite with `--json` and normalize its report.
 *
 * jest exits non-zero when tests fail; that is expected here (the baseline
 * records failures), so we read the report regardless of exit code.
 *
 * We direct the machine report to a temp file via `--outputFile` rather than
 * scraping stdout: with coverage enabled and a large corpus (the root project),
 * jest interleaves human-readable reporter noise with the JSON on stdout, so
 * "the first `{`" is not a reliable start of the report. `--outputFile` gives a
 * clean, standalone JSON document every time.
 */
function captureJestSuite(spec: JestSuiteSpec): { results: TestResult[]; capture: SuiteCapture } {
  // For a `-w <workspace>` run we invoke that workspace's own `jest` binary;
  // for the root project we invoke jest at the repo root. In both cases we
  // request `--json` written to a per-suite temp `--outputFile` and add `--ci`.
  const isWorkspace = spec.args[0] === "-w";
  const safeLabel = spec.label.replaceAll(/[^\w.-]/g, "_");
  const outputFile = join(tmpdir(), `baseline-jest-${safeLabel}-${process.pid}.json`);
  const reportArgs = ["--json", "--ci", `--outputFile=${outputFile}`];
  // The `--` separator MUST precede the jest report flags in BOTH cases so npm
  // forwards them to jest instead of consuming `--outputFile`/`--json` itself.
  // For a workspace run the npm-level `-w <name>` flag stays before the `--`;
  // for the root run there is no npm-level flag, so everything follows `--`.
  const npmLevelArgs = isWorkspace ? spec.args : [];
  const jestArgs = [...npmLevelArgs, "--", ...reportArgs];

  const proc = spawnSync("npm", ["exec", "jest", ...jestArgs], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });

  let raw: string;
  try {
    raw = readFileSync(outputFile, "utf8");
  } catch {
    console.error(`[baseline] jest suite "${spec.label}" produced no JSON report`);
    if (proc.stderr) console.error(proc.stderr.slice(0, 2000));
    return {
      results: [],
      capture: {
        suite: spec.label,
        runner: "jest",
        ran: false,
        testCount: 0,
        skipReason: "jest produced no JSON report (see capture logs)",
      },
    };
  }
  try {
    const report = JSON.parse(raw);
    const results = normalizeJestReport(report);
    const fails = results.filter((t) => t.status === "fail").length;
    const skips = results.filter((t) => t.status === "skip").length;
    console.log(
      `[baseline] jest "${spec.label}": ${results.length} tests ` +
        `(${fails} failing, ${skips} skipped)`,
    );
    return {
      results,
      capture: { suite: spec.label, runner: "jest", ran: true, testCount: results.length },
    };
  } catch (err) {
    console.error(`[baseline] failed to parse jest JSON for "${spec.label}": ${String(err)}`);
    return {
      results: [],
      capture: {
        suite: spec.label,
        runner: "jest",
        ran: false,
        testCount: 0,
        skipReason: `failed to parse jest JSON report: ${String(err)}`,
      },
    };
  } finally {
    try {
      rmSync(outputFile, { force: true });
    } catch {
      // best-effort cleanup of the temp report file.
    }
  }
}

/**
 * Run `cargo test` in `Installer/src-tauri` with libtest JSON output and
 * normalize the message stream.
 */
function captureCargo(): { results: TestResult[]; capture: SuiteCapture } {
  const suite = "cargo:Installer/src-tauri";
  const cargoDir = resolve(repoRoot, "Installer", "src-tauri");
  // `--format json -Z unstable-options` yields one JSON event object per line
  // on the libtest reporter; `--report-time` is harmless if present.
  const proc = spawnSync("cargo", ["test", "--", "-Z", "unstable-options", "--format", "json"], {
    cwd: cargoDir,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });

  const stdout = proc.stdout ?? "";
  const stderr = proc.stderr ?? "";
  const results = normalizeCargoOutput(stdout, "Installer/src-tauri");
  console.log(`[baseline] cargo: ${results.length} tests`);

  if (results.length === 0) {
    if (stderr) {
      console.error("[baseline] cargo produced no parseable JSON events; stderr head:");
      console.error(stderr.slice(0, 2000));
    }
    // Distinguish a genuine environment limitation (the installer test binary
    // embeds a `requireAdministrator` manifest, so a non-elevated shell cannot
    // launch it: Windows "os error 740 — requires elevation") from other empty
    // results, and record it honestly rather than emitting a silent empty set.
    const needsElevation = /error 740|requires elevation/i.test(stderr);
    const skipReason = needsElevation
      ? "cargo test binary requires OS elevation (Windows os error 740; installer embeds a requireAdministrator manifest) — not runnable in this non-elevated capture environment"
      : "cargo test produced no parseable JSON test events (see capture logs)";
    return {
      results: [],
      capture: { suite, runner: "cargo", ran: false, testCount: 0, skipReason },
    };
  }

  return {
    results,
    capture: { suite, runner: "cargo", ran: true, testCount: results.length },
  };
}

function parseArgs(argv: string[]): { out: string; dryRun: boolean } {
  let out = DEFAULT_OUT;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) {
      out = resolve(argv[++i]);
    } else if (argv[i] === "--dry-run") {
      dryRun = true;
    }
  }
  return { out, dryRun };
}

function main(): void {
  const { out, dryRun } = parseArgs(process.argv.slice(2));
  const repoVersion = readLiveRepoVersion();
  const nodeVersion = process.version;

  console.log(`[baseline] repoVersion=${repoVersion} nodeVersion=${nodeVersion}`);
  console.log(`[baseline] output artifact: ${out}`);

  if (dryRun) {
    console.log("[baseline] --dry-run: suites that WOULD run:");
    for (const s of JEST_SUITES) console.log(`  jest ${s.args.join(" ")}`);
    console.log("  cargo test (Installer/src-tauri)");
    return;
  }

  const jest: TestResult[] = [];
  const suites: SuiteCapture[] = [];
  for (const spec of JEST_SUITES) {
    const { results, capture } = captureJestSuite(spec);
    jest.push(...results);
    suites.push(capture);
  }
  const { results: cargo, capture: cargoCapture } = captureCargo();
  suites.push(cargoCapture);

  const baseline: Baseline = {
    capturedOn: new Date().toISOString(),
    nodeVersion,
    repoVersion,
    jest,
    cargo,
    suites,
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");

  const jestFails = jest.filter((t) => t.status === "fail").length;
  const jestSkips = jest.filter((t) => t.status === "skip").length;
  const cargoFails = cargo.filter((t) => t.status === "fail").length;
  const skippedSuites = suites.filter((s) => !s.ran);
  console.log(
    `[baseline] wrote ${jest.length} jest + ${cargo.length} cargo results ` +
      `(${jestFails} jest failing, ${jestSkips} jest skipped, ${cargoFails} cargo failing) to ${out}`,
  );
  if (skippedSuites.length > 0) {
    console.log(`[baseline] ${skippedSuites.length} suite(s) NOT captured:`);
    for (const s of skippedSuites) {
      console.log(`  - ${s.runner} "${s.suite}": ${s.skipReason ?? "unknown reason"}`);
    }
  }
}

// Only run when invoked directly (not when imported by tests).
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main();
}

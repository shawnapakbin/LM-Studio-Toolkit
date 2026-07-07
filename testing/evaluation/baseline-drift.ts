/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import fs from "fs";
import path from "path";

type Baseline = {
  passRateThreshold: number;
  maxAverageRetries: number;
  maxFailureRateByCategory: Record<string, number>;
};

type EvalSummary = {
  runAt: string;
  totalTasks: number;
  passedTasks: number;
  failedTasks: number;
  passRate: number;
  averageRetries: number;
  failureCategories: Record<string, number>;
  categoryStats: Record<
    string,
    { total: number; passed: number; failed: number; failureRate: number }
  >;
};

type EvalOutput = {
  summary: EvalSummary;
  gate: {
    passed: boolean;
    reasons: string[];
  };
};

const ROOT = path.resolve(__dirname, "..", "..");
const BASELINE_PATH = path.join(
  ROOT,
  "testing",
  "evaluation",
  "baselines",
  "default-baseline.json",
);
const RESULT_PATH = path.join(ROOT, "testing", "evaluation", "results", "latest.json");

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatDelta(current: number, baseline: number): string {
  const delta = current - baseline;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${formatPercent(delta)}`;
}

function generateDriftReport(baseline: Baseline, result: EvalOutput): void {
  const summary = result.summary;

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║          🔍 Evaluation Baseline Drift Report                  ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  console.log("📊 Overall Metrics:");
  console.log(
    `  Pass Rate:       ${formatPercent(summary.passRate)} (baseline: ${formatPercent(baseline.passRateThreshold)})`,
  );
  const passRateDelta = summary.passRate - baseline.passRateThreshold;
  if (passRateDelta !== 0) {
    console.log(
      `                   Drift: ${formatDelta(summary.passRate, baseline.passRateThreshold)} ${passRateDelta < 0 ? "⚠️  DEGRADED" : "✅ IMPROVED"}`,
    );
  }
  console.log();

  console.log(
    `  Average Retries: ${summary.averageRetries.toFixed(2)} (baseline: ${baseline.maxAverageRetries.toFixed(2)})`,
  );
  const retriesDelta = summary.averageRetries - baseline.maxAverageRetries;
  if (retriesDelta !== 0) {
    const sign = retriesDelta >= 0 ? "+" : "";
    console.log(
      `                   Drift: ${sign}${retriesDelta.toFixed(2)} ${retriesDelta > 0 ? "⚠️  DEGRADED" : "✅ IMPROVED"}`,
    );
  }
  console.log();

  console.log("📈 Category-Level Drift:");
  let hasSignificantDrift = false;

  for (const [category, baselineFailureRate] of Object.entries(baseline.maxFailureRateByCategory)) {
    const currentStat = summary.categoryStats[category];
    if (!currentStat) {
      console.log(
        `  ⚠️  ${category}: No data in current run (baseline: ${formatPercent(baselineFailureRate)})`,
      );
      hasSignificantDrift = true;
      continue;
    }

    const currentFailureRate = currentStat.failureRate;
    const delta = currentFailureRate - baselineFailureRate;

    console.log(`  ${category}:`);
    console.log(`    Current:  ${formatPercent(currentFailureRate)} failure rate`);
    console.log(`    Baseline: ${formatPercent(baselineFailureRate)} failure rate`);

    if (Math.abs(delta) > 0.01) {
      // Significant drift if >1% difference
      console.log(
        `    Drift:    ${formatDelta(currentFailureRate, baselineFailureRate)} ${delta > 0 ? "⚠️  DEGRADED" : "✅ IMPROVED"}`,
      );
      if (delta > 0) hasSignificantDrift = true;
    } else {
      console.log(
        `    Drift:    ${formatDelta(currentFailureRate, baselineFailureRate)} (minimal)`,
      );
    }
    console.log();
  }

  console.log("🚦 Gate Status:");
  if (result.gate.passed) {
    console.log("  ✅ PASSED - All metrics within baseline thresholds");
  } else {
    console.log("  ❌ FAILED - Baseline violations detected:");
    for (const reason of result.gate.reasons) {
      console.log(`     • ${reason}`);
    }
  }
  console.log();

  if (hasSignificantDrift && result.gate.passed) {
    console.log("⚠️  Note: Significant drift detected but still within thresholds.");
    console.log("   Consider investigating performance degradation.");
    console.log();
  }

  console.log("💡 Actions:");
  if (!result.gate.passed) {
    console.log("  1. Review failing tasks in testing/evaluation/results/latest.json");
    console.log("  2. Check golden traces in testing/evaluation/results/golden-traces/");
    console.log("  3. Fix issues and re-run: npm run eval:run");
    console.log("  4. If new baseline is expected, run: npm run eval:update-baseline");
  } else if (hasSignificantDrift) {
    console.log("  1. Review tasks with increased failure rates");
    console.log("  2. Consider updating baseline if changes are intentional");
    console.log("  3. To update baseline: npm run eval:update-baseline");
  } else {
    console.log("  ✨ No action needed. Results align with baseline.");
  }
  console.log();

  console.log(`📅 Evaluation run: ${summary.runAt}`);
  console.log(
    `📦 Total tasks: ${summary.totalTasks} (Passed: ${summary.passedTasks}, Failed: ${summary.failedTasks})`,
  );
  console.log();
}

function main(): void {
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error("❌ Baseline file not found:", BASELINE_PATH);
    console.error("   Run evaluation first: npm run eval:run");
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(RESULT_PATH)) {
    console.error("❌ Latest evaluation result not found:", RESULT_PATH);
    console.error("   Run evaluation first: npm run eval:run");
    process.exitCode = 1;
    return;
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8")) as Baseline;
  const result = JSON.parse(fs.readFileSync(RESULT_PATH, "utf-8")) as EvalOutput;

  generateDriftReport(baseline, result);

  // Exit with error code if gate failed
  if (!result.gate.passed) {
    process.exitCode = 1;
  }
}

main();

/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import { runEvaluation } from "./harness";

async function main(): Promise<void> {
  const updateBaseline =
    process.argv.includes("--update-baseline") || process.env.EVAL_UPDATE_BASELINE === "true";

  // Parse seed from command line args or environment
  let seed: number | undefined;
  const seedArg = process.argv.find((arg) => arg.startsWith("--seed="));
  if (seedArg) {
    seed = Number.parseInt(seedArg.split("=")[1], 10);
    if (Number.isNaN(seed)) {
      console.error("Invalid seed value. Must be a number.");
      process.exitCode = 1;
      return;
    }
  } else if (process.env.EVAL_SEED) {
    seed = Number.parseInt(process.env.EVAL_SEED, 10);
    if (Number.isNaN(seed)) {
      console.error("Invalid EVAL_SEED environment variable. Must be a number.");
      process.exitCode = 1;
      return;
    }
  }

  const result = await runEvaluation(updateBaseline, seed);

  console.log("Evaluation summary");
  console.log(`- Total tasks: ${result.summary.totalTasks}`);
  console.log(`- Passed: ${result.summary.passedTasks}`);
  console.log(`- Failed: ${result.summary.failedTasks}`);
  console.log(`- Pass rate: ${result.summary.passRate.toFixed(2)}`);
  console.log(`- Average retries: ${result.summary.averageRetries.toFixed(2)}`);

  if (!result.gate.passed) {
    console.error("Evaluation gate failed:");
    for (const reason of result.gate.reasons) {
      console.error(`- ${reason}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Evaluation gate passed");
}

main().catch((error) => {
  console.error("Evaluation run failed", error);
  process.exitCode = 1;
});

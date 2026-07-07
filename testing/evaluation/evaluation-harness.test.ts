/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import fs from "fs";
import path from "path";
import { runEvaluation } from "./harness";

describe("Evaluation Harness", () => {
  const resultsPath = path.join(process.cwd(), "testing", "evaluation", "results", "latest.json");
  const baselinePath = path.join(
    process.cwd(),
    "testing",
    "evaluation",
    "baselines",
    "default-baseline.json",
  );
  let originalBaseline = "";

  beforeAll(() => {
    originalBaseline = fs.readFileSync(baselinePath, "utf-8");
  });

  afterAll(() => {
    fs.writeFileSync(baselinePath, originalBaseline, "utf-8");
  });

  test("runs evaluation and produces summary", async () => {
    const output = await runEvaluation(false);

    expect(output.summary.totalTasks).toBeGreaterThan(0);
    expect(output.summary.passRate).toBeGreaterThanOrEqual(0);
    expect(output.summary.passRate).toBeLessThanOrEqual(1);
    expect(output.gate.passed).toBe(true);
    expect(fs.existsSync(resultsPath)).toBe(true);
  });

  test("supports baseline update mode", async () => {
    const output = await runEvaluation(true);
    expect(output.summary.totalTasks).toBeGreaterThan(0);
  });
});

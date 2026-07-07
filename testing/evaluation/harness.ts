/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import fs from "fs";
import path from "path";

type ExecutionMode = "sequential" | "parallel";

type WorkflowStep = {
  id: string;
  toolId: string;
  endpoint: string;
  input: Record<string, unknown>;
  retryPolicy?: {
    maxRetries: number;
    retryDelayMs: number;
  };
};

type Workflow = {
  id: string;
  name: string;
  mode: ExecutionMode;
  steps: WorkflowStep[];
};

type EvalTask = {
  id: string;
  name: string;
  category: "file-edit" | "shell-build" | "web-retrieval" | "math-engineering";
  expectedSuccess?: boolean;
  workflow: Workflow;
};

type Baseline = {
  passRateThreshold: number;
  maxAverageRetries: number;
  maxFailureRateByCategory: Record<string, number>;
};

type StepResult = {
  id: string;
  toolId: string;
  success: boolean;
  retries: number;
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
};

type WorkflowResult = {
  success: boolean;
  durationMs: number;
  traceId: string;
  steps: StepResult[];
  error?: string;
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
  tasks: Array<{
    id: string;
    name: string;
    category: string;
    expectedSuccess: boolean;
    success: boolean;
    matchedExpectation: boolean;
    durationMs: number;
    retries: number;
    traceId: string;
    error?: string;
  }>;
  traces: Record<string, unknown>;
  gate: {
    passed: boolean;
    reasons: string[];
  };
};

const ROOT = path.resolve(__dirname, "..", "..");
const TASKS_PATH = path.join(ROOT, "testing", "evaluation", "tasks.json");
const BASELINE_PATH = path.join(
  ROOT,
  "testing",
  "evaluation",
  "baselines",
  "default-baseline.json",
);
const RESULTS_DIR = path.join(ROOT, "testing", "evaluation", "results");
const RESULT_PATH = path.join(RESULTS_DIR, "latest.json");
const TRACES_DIR = path.join(RESULTS_DIR, "golden-traces");

const flakyBuildAttempts = new Map<string, number>();

// Seeded PRNG for deterministic evaluation
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  // Simple linear congruential generator (LCG)
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 2 ** 32;
    return this.seed / 2 ** 32;
  }

  // Generate random integer in range [min, max)
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }
}

let randomGen: SeededRandom | null = null;

function generateTraceId(): string {
  const now = Date.now();
  const rand = randomGen
    ? randomGen.nextInt(10000000, 99999999).toString(36)
    : Math.random().toString(36).slice(2, 10);
  return `${now}-${rand}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeMockStep(
  step: WorkflowStep,
): Promise<{ success: boolean; errorCode?: string; errorMessage?: string }> {
  if (step.toolId === "terminal") {
    const command = String(step.input.command || "").trim();
    if (!command) {
      return { success: false, errorCode: "INVALID_INPUT", errorMessage: "command required" };
    }

    if (command.includes("npm run build")) {
      const attempt = (flakyBuildAttempts.get(step.id) || 0) + 1;
      flakyBuildAttempts.set(step.id, attempt);
      if (attempt === 1) {
        return {
          success: false,
          errorCode: "EXECUTION_FAILED",
          errorMessage: "transient build failure",
        };
      }
    }

    return { success: true };
  }

  if (step.toolId === "webbrowser") {
    const urlValue = String(step.input.url || "");
    if (!/^https?:\/\//i.test(urlValue)) {
      return { success: false, errorCode: "INVALID_INPUT", errorMessage: "invalid url" };
    }
    return { success: true };
  }

  if (step.toolId === "calculator") {
    const expression = String(step.input.expression || "");
    if (!expression) {
      return { success: false, errorCode: "INVALID_INPUT", errorMessage: "expression required" };
    }
    return { success: true };
  }

  return { success: false, errorCode: "NOT_FOUND", errorMessage: "unsupported tool" };
}

async function executeStep(step: WorkflowStep): Promise<StepResult> {
  const started = Date.now();
  const maxRetries = step.retryPolicy?.maxRetries ?? 0;
  const retryDelayMs = step.retryPolicy?.retryDelayMs ?? 0;

  let retries = 0;
  let lastErrorCode: string | undefined;
  let lastErrorMessage: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await executeMockStep(step);
    if (result.success) {
      return {
        id: step.id,
        toolId: step.toolId,
        success: true,
        retries,
        durationMs: Date.now() - started,
      };
    }

    lastErrorCode = result.errorCode;
    lastErrorMessage = result.errorMessage;

    if (attempt < maxRetries) {
      retries += 1;
      if (retryDelayMs > 0) {
        await sleep(retryDelayMs);
      }
    }
  }

  return {
    id: step.id,
    toolId: step.toolId,
    success: false,
    retries,
    durationMs: Date.now() - started,
    errorCode: lastErrorCode,
    errorMessage: lastErrorMessage,
  };
}

async function executeWorkflow(workflow: Workflow): Promise<WorkflowResult> {
  const traceId = generateTraceId();
  const start = Date.now();

  let steps: StepResult[] = [];

  if (workflow.mode === "parallel") {
    steps = await Promise.all(workflow.steps.map((step) => executeStep(step)));
  } else {
    for (const step of workflow.steps) {
      const result = await executeStep(step);
      steps.push(result);
      if (!result.success) {
        break;
      }
    }
  }

  const success = steps.every((step) => step.success);

  return {
    success,
    durationMs: Date.now() - start,
    traceId,
    steps,
    error: success
      ? undefined
      : `Workflow failed: ${steps.filter((step) => !step.success).length} step(s)`,
  };
}

function buildSummary(
  results: Array<{ task: EvalTask; workflowResult: WorkflowResult }>,
): EvalSummary {
  const totalTasks = results.length;
  const passedTasks = results.filter((entry) => {
    const expectedSuccess = entry.task.expectedSuccess ?? true;
    return entry.workflowResult.success === expectedSuccess;
  }).length;
  const failedTasks = totalTasks - passedTasks;
  const passRate = totalTasks > 0 ? passedTasks / totalTasks : 0;

  const totalRetries = results.reduce((sum, entry) => {
    return sum + entry.workflowResult.steps.reduce((stepSum, step) => stepSum + step.retries, 0);
  }, 0);
  const averageRetries = totalTasks > 0 ? totalRetries / totalTasks : 0;

  const failureCategories: Record<string, number> = {};
  const categoryStats: Record<
    string,
    { total: number; passed: number; failed: number; failureRate: number }
  > = {};

  for (const entry of results) {
    const category = entry.task.category;
    categoryStats[category] ||= { total: 0, passed: 0, failed: 0, failureRate: 0 };
    categoryStats[category].total += 1;

    const expectedSuccess = entry.task.expectedSuccess ?? true;
    const matchedExpectation = entry.workflowResult.success === expectedSuccess;

    if (matchedExpectation) {
      categoryStats[category].passed += 1;
    } else {
      categoryStats[category].failed += 1;
      const failedCode =
        entry.workflowResult.steps.find((step) => !step.success)?.errorCode || "EXECUTION_FAILED";
      failureCategories[String(failedCode)] = (failureCategories[String(failedCode)] || 0) + 1;
    }
  }

  for (const category of Object.keys(categoryStats)) {
    const stat = categoryStats[category];
    stat.failureRate = stat.total > 0 ? stat.failed / stat.total : 0;
  }

  return {
    runAt: new Date().toISOString(),
    totalTasks,
    passedTasks,
    failedTasks,
    passRate,
    averageRetries,
    failureCategories,
    categoryStats,
  };
}

function evaluateGate(
  summary: EvalSummary,
  baseline: Baseline,
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (summary.passRate < baseline.passRateThreshold) {
    reasons.push(
      `Pass rate ${summary.passRate.toFixed(2)} is below threshold ${baseline.passRateThreshold.toFixed(2)}`,
    );
  }

  if (summary.averageRetries > baseline.maxAverageRetries) {
    reasons.push(
      `Average retries ${summary.averageRetries.toFixed(2)} exceeds ${baseline.maxAverageRetries.toFixed(2)}`,
    );
  }

  for (const [category, maxRate] of Object.entries(baseline.maxFailureRateByCategory)) {
    const actual = summary.categoryStats[category]?.failureRate ?? 0;
    if (actual > maxRate) {
      reasons.push(
        `Failure rate for ${category} is ${actual.toFixed(2)} (max ${maxRate.toFixed(2)})`,
      );
    }
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

export async function runEvaluation(updateBaseline = false, seed?: number): Promise<EvalOutput> {
  if (seed !== undefined) {
    randomGen = new SeededRandom(seed);
    console.log(`🌱 Using deterministic seed: ${seed}`);
  } else {
    randomGen = null;
  }

  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  if (!fs.existsSync(TRACES_DIR)) fs.mkdirSync(TRACES_DIR, { recursive: true });

  const tasks = JSON.parse(fs.readFileSync(TASKS_PATH, "utf-8")) as EvalTask[];
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8")) as Baseline;

  const taskResults: Array<{ task: EvalTask; workflowResult: WorkflowResult }> = [];

  for (const task of tasks) {
    const workflowResult = await executeWorkflow(task.workflow);
    taskResults.push({ task, workflowResult });

    const timeline = {
      traceId: workflowResult.traceId,
      workflowId: task.workflow.id,
      workflowName: task.workflow.name,
      status: workflowResult.success ? "success" : "error",
      durationMs: workflowResult.durationMs,
      steps: workflowResult.steps,
      generatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(TRACES_DIR, `${task.id}.json`),
      JSON.stringify(timeline, null, 2),
      "utf-8",
    );
  }

  const summary = buildSummary(taskResults);

  if (updateBaseline) {
    const updated: Baseline = {
      passRateThreshold: summary.passRate,
      maxAverageRetries: summary.averageRetries,
      maxFailureRateByCategory: Object.fromEntries(
        Object.entries(summary.categoryStats).map(([category, stat]) => [
          category,
          stat.failureRate,
        ]),
      ),
    };
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(updated, null, 2), "utf-8");
  }

  const gate = evaluateGate(summary, baseline);

  const output: EvalOutput = {
    summary,
    tasks: taskResults.map(({ task, workflowResult }) => ({
      expectedSuccess: task.expectedSuccess ?? true,
      matchedExpectation: workflowResult.success === (task.expectedSuccess ?? true),
      id: task.id,
      name: task.name,
      category: task.category,
      success: workflowResult.success,
      durationMs: workflowResult.durationMs,
      retries: workflowResult.steps.reduce((sum, step) => sum + step.retries, 0),
      traceId: workflowResult.traceId,
      error: workflowResult.error,
    })),
    traces: Object.fromEntries(
      taskResults.map(({ task, workflowResult }) => [task.id, { traceId: workflowResult.traceId }]),
    ),
    gate,
  };

  fs.writeFileSync(RESULT_PATH, JSON.stringify(output, null, 2), "utf-8");
  return output;
}

/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import { v4 as uuid } from "uuid";

export function createMockResponse<T>(success: boolean, data?: T, errorCode?: string) {
  return {
    success,
    data,
    error: errorCode ? { code: errorCode, message: "", details: {} } : undefined,
    timing: { durationMs: 0, startTime: new Date().toISOString() },
    traceId: generateTraceId(),
  };
}

export function generateTraceId(): string {
  return uuid();
}

export async function waitFor(fn: () => boolean | Promise<boolean>, timeout = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MockToolOptions {
  delayMs?: number;
  shouldFail?: boolean;
  errorCode?: string;
}

export async function executeMockTool<T>(
  fn: () => Promise<T>,
  options?: MockToolOptions,
): Promise<T> {
  if (options?.delayMs) {
    await sleep(options.delayMs);
  }
  if (options?.shouldFail) {
    throw new Error(`Mock tool failed: ${options.errorCode || "EXECUTION_FAILED"}`);
  }
  return fn();
}

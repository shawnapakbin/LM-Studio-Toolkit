/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Memory Store - Persistent storage for workflow execution history
 *
 * Uses SQLite to store:
 * - Workflow run history
 * - Step execution results
 * - Session context
 * - Successful patterns for retrieval
 */

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import type { StepResult, Workflow, WorkflowResult, WorkflowStep } from "./runner";

/**
 * Run record stored in database
 */
export interface RunRecord {
  id: number;
  workflowId: string;
  workflowName: string;
  traceId: string;
  success: boolean;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  error?: string;
  metadata?: string; // JSON stringified metadata
}

/**
 * Step record stored in database
 */
export interface StepRecord {
  id: number;
  runId: number;
  stepId: string;
  toolId: string;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  durationMs: number;
  retries: number;
  traceId: string;
  startedAt: string;
  completedAt: string;
  inputData?: string; // JSON stringified input
  outputData?: string; // JSON stringified output
}

/**
 * Session context for short-lived memory
 */
export interface SessionContext {
  sessionId: string;
  startedAt: Date;
  lastActivityAt: Date;
  context: Record<string, unknown>;
}

/**
 * Memory Store
 */
export class MemoryStore {
  private db: Database.Database;
  private sessions: Map<string, SessionContext> = new Map();

  constructor(dbPath?: string) {
    const defaultPath = path.join(process.cwd(), "data", "agent-memory.db");
    const finalPath = dbPath || defaultPath;

    // Ensure data directory exists
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(finalPath);
    this.initializeSchema();
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    // Workflow runs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_id TEXT NOT NULL,
        workflow_name TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        success INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        error TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_runs_workflow_id ON runs(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_runs_trace_id ON runs(trace_id);
      CREATE INDEX IF NOT EXISTS idx_runs_success ON runs(success);
      CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);
    `);

    // Step executions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL,
        step_id TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        success INTEGER NOT NULL,
        error_code TEXT,
        error_message TEXT,
        duration_ms INTEGER NOT NULL,
        retries INTEGER NOT NULL,
        trace_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        input_data TEXT,
        output_data TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_steps_run_id ON steps(run_id);
      CREATE INDEX IF NOT EXISTS idx_steps_tool_id ON steps(tool_id);
      CREATE INDEX IF NOT EXISTS idx_steps_success ON steps(success);
    `);

    // Successful patterns table (for retrieval)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_name TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        tool_sequence TEXT NOT NULL,
        success_count INTEGER DEFAULT 1,
        last_used_at TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_patterns_workflow_id ON patterns(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_patterns_tool_sequence ON patterns(tool_sequence);
    `);
  }

  /**
   * Store a workflow run result
   */
  storeRun(workflow: Workflow, result: WorkflowResult, metadata?: Record<string, unknown>): number {
    const stmt = this.db.prepare(`
      INSERT INTO runs (
        workflow_id, workflow_name, trace_id, success, duration_ms,
        started_at, completed_at, error, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      workflow.id,
      workflow.name,
      result.traceId,
      result.success ? 1 : 0,
      result.durationMs,
      result.startedAt.toISOString(),
      result.completedAt.toISOString(),
      result.error || null,
      metadata ? JSON.stringify(metadata) : null,
    );

    const runId = info.lastInsertRowid as number;

    // Store step results
    for (const step of result.steps) {
      this.storeStep(
        runId,
        step,
        workflow.steps.find((s) => s.id === step.stepId),
      );
    }

    // Update pattern if successful
    if (result.success) {
      this.updatePattern(
        workflow.id,
        result.steps.map((s) => s.toolId),
      );
    }

    return runId;
  }

  /**
   * Store a step execution result
   */
  private storeStep(runId: number, step: StepResult, stepDef?: WorkflowStep): void {
    const stmt = this.db.prepare(`
      INSERT INTO steps (
        run_id, step_id, tool_id, success, error_code, error_message,
        duration_ms, retries, trace_id, started_at, completed_at,
        input_data, output_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      runId,
      step.stepId,
      step.toolId,
      step.success ? 1 : 0,
      step.errorCode || null,
      step.errorMessage || null,
      step.durationMs,
      step.retries,
      step.traceId,
      step.startedAt.toISOString(),
      step.completedAt.toISOString(),
      stepDef?.input ? JSON.stringify(stepDef.input) : null,
      step.data ? JSON.stringify(step.data) : null,
    );
  }

  /**
   * Update or create a successful pattern
   */
  private updatePattern(workflowId: string, toolSequence: string[]): void {
    const sequence = toolSequence.join(",");
    const patternName = `pattern_${workflowId}_${sequence.replace(/,/g, "_")}`;

    const existing = this.db
      .prepare(`
      SELECT id, success_count FROM patterns WHERE workflow_id = ? AND tool_sequence = ?
    `)
      .get(workflowId, sequence) as { id: number; success_count: number } | undefined;

    if (existing) {
      this.db
        .prepare(`
        UPDATE patterns SET success_count = ?, last_used_at = ? WHERE id = ?
      `)
        .run(existing.success_count + 1, new Date().toISOString(), existing.id);
    } else {
      this.db
        .prepare(`
        INSERT INTO patterns (pattern_name, workflow_id, tool_sequence, last_used_at)
        VALUES (?, ?, ?, ?)
      `)
        .run(patternName, workflowId, sequence, new Date().toISOString());
    }
  }

  /**
   * Get run history for a workflow
   */
  getRunHistory(workflowId: string, limit = 50): RunRecord[] {
    return this.db
      .prepare(`
      SELECT * FROM runs WHERE workflow_id = ?
      ORDER BY started_at DESC LIMIT ?
    `)
      .all(workflowId, limit) as RunRecord[];
  }

  /**
   * Get successful runs for a workflow
   */
  getSuccessfulRuns(workflowId: string, limit = 20): RunRecord[] {
    return this.db
      .prepare(`
      SELECT * FROM runs WHERE workflow_id = ? AND success = 1
      ORDER BY started_at DESC LIMIT ?
    `)
      .all(workflowId, limit) as RunRecord[];
  }

  /**
   * Get steps for a run
   */
  getRunSteps(runId: number): StepRecord[] {
    return this.db
      .prepare(`
      SELECT * FROM steps WHERE run_id = ? ORDER BY started_at ASC
    `)
      .all(runId) as StepRecord[];
  }

  /**
   * Get most successful patterns for a workflow
   */
  getSuccessfulPatterns(
    workflowId: string,
    limit = 10,
  ): Array<{
    pattern_name: string;
    tool_sequence: string;
    success_count: number;
    last_used_at: string;
  }> {
    return this.db
      .prepare(`
      SELECT pattern_name, tool_sequence, success_count, last_used_at
      FROM patterns WHERE workflow_id = ?
      ORDER BY success_count DESC, last_used_at DESC
      LIMIT ?
    `)
      .all(workflowId, limit) as Array<{
      pattern_name: string;
      tool_sequence: string;
      success_count: number;
      last_used_at: string;
    }>;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    totalSteps: number;
    avgDurationMs: number;
  } {
    const stats = this.db
      .prepare(`
      SELECT
        COUNT(*) as total_runs,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_runs,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_runs,
        AVG(duration_ms) as avg_duration_ms
      FROM runs
    `)
      .get() as {
      total_runs: number;
      successful_runs: number;
      failed_runs: number;
      avg_duration_ms: number;
    };

    const stepCount = this.db.prepare(`SELECT COUNT(*) as count FROM steps`).get() as {
      count: number;
    };

    return {
      totalRuns: stats.total_runs || 0,
      successfulRuns: stats.successful_runs || 0,
      failedRuns: stats.failed_runs || 0,
      totalSteps: stepCount.count || 0,
      avgDurationMs: Math.round(stats.avg_duration_ms || 0),
    };
  }

  /**
   * Create a session context
   */
  createSession(sessionId: string, initialContext?: Record<string, unknown>): SessionContext {
    const session: SessionContext = {
      sessionId,
      startedAt: new Date(),
      lastActivityAt: new Date(),
      context: initialContext || {},
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Get session context
   */
  getSession(sessionId: string): SessionContext | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = new Date();
    }
    return session;
  }

  /**
   * Update session context
   */
  updateSession(sessionId: string, updates: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.context = { ...session.context, ...updates };
      session.lastActivityAt = new Date();
    }
  }

  /**
   * Delete session
   */
  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Clean up old sessions (older than timeoutMs)
   */
  cleanupSessions(timeoutMs = 3600000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivityAt.getTime() > timeoutMs) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}

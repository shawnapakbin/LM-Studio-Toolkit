import crypto from "crypto";
import Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { initSchema } from "./schema";
import type { Rule, SolutionPattern } from "./types";

export class MemoryStore {
  private db: Database.Database;

  constructor(dbPath = "./memory.db") {
    this.db = new Database(dbPath);
    initSchema(this.db);
  }

  async createTaskRun(prompt: string, traceId: string): Promise<string> {
    const id = uuid();
    const stmt = this.db.prepare(
      "INSERT INTO task_runs (id, user_prompt, status, trace_id) VALUES (?, ?, ?, ?)",
    );
    stmt.run(id, prompt, "planning", traceId);
    return id;
  }

  async updateTaskRun(taskRunId: string, status: string, outcome?: string): Promise<void> {
    const stmt = this.db.prepare("UPDATE task_runs SET status = ?, outcome = ? WHERE id = ?");
    stmt.run(status, outcome || null, taskRunId);
  }

  async recordToolCall(
    taskRunId: string,
    toolName: string,
    input: unknown,
    output: unknown,
    success: boolean,
    errorCode?: string,
    durationMs?: number,
  ): Promise<void> {
    const id = uuid();
    const stmt = this.db.prepare(
      `INSERT INTO tool_calls 
       (id, task_run_id, tool_name, input_params, output_result, success, error_code, duration_ms) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    stmt.run(
      id,
      taskRunId,
      toolName,
      JSON.stringify(input),
      JSON.stringify(output),
      success ? 1 : 0,
      errorCode || null,
      durationMs || null,
    );
  }

  async recordPattern(taskPrompt: string, toolSequence: string[], trace: string): Promise<void> {
    const id = uuid();
    const hash = crypto.createHash("sha256").update(taskPrompt).digest("hex");
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO solution_patterns 
       (id, task_description, task_hash, tool_sequence, full_trace) 
       VALUES (?, ?, ?, ?, ?)`,
    );
    stmt.run(id, taskPrompt, hash, JSON.stringify(toolSequence), trace);
  }

  async findSimilarPatterns(prompt: string, limit = 3): Promise<SolutionPattern[]> {
    const hash = crypto.createHash("sha256").update(prompt).digest("hex");
    const stmt = this.db.prepare(
      `SELECT * FROM solution_patterns 
       WHERE task_hash = ? OR task_description LIKE ? 
       ORDER BY success_rate DESC, uses DESC LIMIT ?`,
    );
    return stmt.all(hash, `%${prompt.substring(0, 50)}%`, limit) as SolutionPattern[];
  }

  async addRule(type: string, pattern: string, reason?: string): Promise<void> {
    const id = uuid();
    const stmt = this.db.prepare(
      "INSERT INTO learned_rules (id, rule_type, pattern, reason) VALUES (?, ?, ?, ?)",
    );
    stmt.run(id, type, pattern, reason || null);
  }

  async getRules(type: string): Promise<Rule[]> {
    const stmt = this.db.prepare("SELECT * FROM learned_rules WHERE rule_type = ?");
    return stmt.all(type) as Rule[];
  }

  async recordDecision(
    taskRunId: string,
    stepNum: number,
    decision: string,
    alternatives?: string[],
    confidence?: number,
  ): Promise<void> {
    const id = uuid();
    const stmt = this.db.prepare(
      `INSERT INTO agent_decisions 
       (id, task_run_id, step_num, decision_text, alternatives, confidence) 
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    stmt.run(
      id,
      taskRunId,
      stepNum,
      decision,
      JSON.stringify(alternatives || []),
      confidence || 0.5,
    );
  }

  async recordFailure(
    taskRunId: string,
    stepNum: number,
    tool: string,
    error: string,
  ): Promise<string> {
    const id = uuid();
    const stmt = this.db.prepare(
      `INSERT INTO failed_attempts 
       (id, task_run_id, step_num, failed_tool, error_reason) 
       VALUES (?, ?, ?, ?, ?)`,
    );
    stmt.run(id, taskRunId, stepNum, tool, error);
    return id;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

export * from "./types";

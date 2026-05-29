import type Database from "better-sqlite3";

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_runs (
      id TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      user_prompt TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('planning', 'executing', 'completed', 'failed')),
      outcome TEXT,
      tool_calls_count INT,
      duration_ms INT,
      trace_id TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      task_run_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      input_params TEXT,
      output_result TEXT,
      success BOOLEAN NOT NULL,
      error_code TEXT,
      duration_ms INT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_run_id) REFERENCES task_runs(id)
    );

    CREATE TABLE IF NOT EXISTS solution_patterns (
      id TEXT PRIMARY KEY,
      task_description TEXT NOT NULL,
      task_hash TEXT UNIQUE NOT NULL,
      tool_sequence TEXT NOT NULL,
      success_rate REAL DEFAULT 1.0,
      uses INT DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
      full_trace TEXT
    );

    CREATE TABLE IF NOT EXISTS learned_rules (
      id TEXT PRIMARY KEY,
      rule_type TEXT NOT NULL,
      pattern TEXT NOT NULL,
      reason TEXT,
      count INT DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS session_context (
      id TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_accessed DATETIME,
      user_context TEXT,
      recent_files TEXT,
      cwd TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_decisions (
      id TEXT PRIMARY KEY,
      task_run_id TEXT NOT NULL,
      step_num INT NOT NULL,
      decision_text TEXT NOT NULL,
      alternatives TEXT,
      confidence REAL,
      FOREIGN KEY (task_run_id) REFERENCES task_runs(id)
    );

    CREATE TABLE IF NOT EXISTS failed_attempts (
      id TEXT PRIMARY KEY,
      task_run_id TEXT NOT NULL,
      step_num INT NOT NULL,
      failed_tool TEXT NOT NULL,
      error_reason TEXT,
      recovery_attempted TEXT,
      recovery_success BOOLEAN,
      FOREIGN KEY (task_run_id) REFERENCES task_runs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_task_runs_trace_id ON task_runs(trace_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_task_id ON tool_calls(task_run_id);
    CREATE INDEX IF NOT EXISTS idx_solution_patterns_hash ON solution_patterns(task_hash);
  `);
}

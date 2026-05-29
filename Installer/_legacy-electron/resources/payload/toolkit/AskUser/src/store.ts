import Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import type { InterviewQuestion, InterviewResponse, InterviewStatus } from "./types";

export type InterviewRecord = {
  id: string;
  title: string | null;
  task_run_id: string | null;
  status: InterviewStatus;
  questions_json: string;
  responses_json: string | null;
  idempotency_key: string | null;
  submit_timestamp: string | null;
  created_at: string;
  expires_at: string;
  answered_at: string | null;
};

function initSchema(db: Database.Database): void {
  // Step 1: Create table for new installations
  db.exec(`
    CREATE TABLE IF NOT EXISTS ask_user_interviews (
      id TEXT PRIMARY KEY,
      title TEXT,
      task_run_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'answered', 'expired', 'rejected')),
      questions_json TEXT NOT NULL,
      responses_json TEXT,
      idempotency_key TEXT,
      submit_timestamp DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      answered_at DATETIME,
      UNIQUE(id, idempotency_key)
    );
  `);

  // Step 2: Migrate existing databases that pre-date column additions
  const existing = (db.pragma("table_info(ask_user_interviews)") as Array<{ name: string }>).map(
    (c) => c.name,
  );
  if (!existing.includes("idempotency_key")) {
    db.exec("ALTER TABLE ask_user_interviews ADD COLUMN idempotency_key TEXT");
  }
  if (!existing.includes("submit_timestamp")) {
    db.exec("ALTER TABLE ask_user_interviews ADD COLUMN submit_timestamp DATETIME");
  }

  // Step 3: Create indexes (IF NOT EXISTS guards make these safe to re-run)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ask_user_status ON ask_user_interviews(status);
    CREATE INDEX IF NOT EXISTS idx_ask_user_task_run ON ask_user_interviews(task_run_id);
    CREATE INDEX IF NOT EXISTS idx_ask_user_idempotency ON ask_user_interviews(id, idempotency_key);
  `);
}

export class AskUserStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    initSchema(this.db);
  }

  createInterview(params: {
    title?: string;
    taskRunId?: string;
    questions: InterviewQuestion[];
    expiresAtIso: string;
  }): string {
    const interviewId = uuid();
    const stmt = this.db.prepare(
      `INSERT INTO ask_user_interviews
       (id, title, task_run_id, status, questions_json, expires_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
    );

    stmt.run(
      interviewId,
      params.title ?? null,
      params.taskRunId ?? null,
      JSON.stringify(params.questions),
      params.expiresAtIso,
    );

    return interviewId;
  }

  getInterview(interviewId: string): InterviewRecord | undefined {
    const stmt = this.db.prepare("SELECT * FROM ask_user_interviews WHERE id = ?");
    return stmt.get(interviewId) as InterviewRecord | undefined;
  }

  markExpired(interviewId: string): void {
    const stmt = this.db.prepare(
      "UPDATE ask_user_interviews SET status = 'expired' WHERE id = ? AND status = 'pending'",
    );
    stmt.run(interviewId);
  }

  saveResponses(interviewId: string, responses: InterviewResponse[]): void {
    const stmt = this.db.prepare(
      `UPDATE ask_user_interviews
       SET status = 'answered', responses_json = ?, answered_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`,
    );

    stmt.run(JSON.stringify(responses), interviewId);
  }

  saveResponsesIdempotent(
    interviewId: string,
    responses: InterviewResponse[],
    idempotencyKey?: string,
  ): { ok: boolean; responses: InterviewResponse[] | null; isDuplicate: boolean } {
    // If no idempotency key, use standard save
    if (!idempotencyKey?.trim()) {
      this.saveResponses(interviewId, responses);
      return { ok: true, responses, isDuplicate: false };
    }

    const interview = this.getInterview(interviewId);
    if (!interview) {
      return { ok: false, responses: null, isDuplicate: false };
    }

    // Check if this idempotency key already has responses
    if (interview.idempotency_key === idempotencyKey && interview.status === "answered") {
      const existingResponses = interview.responses_json
        ? (JSON.parse(interview.responses_json) as InterviewResponse[])
        : [];
      return { ok: true, responses: existingResponses, isDuplicate: true };
    }

    // Save new responses with idempotency key
    const stmt = this.db.prepare(
      `UPDATE ask_user_interviews
       SET status = 'answered', responses_json = ?, idempotency_key = ?, submit_timestamp = CURRENT_TIMESTAMP, answered_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`,
    );

    const result = stmt.run(JSON.stringify(responses), idempotencyKey, interviewId);

    // Check if update was successful (at least one row affected)
    return {
      ok: typeof result.changes === "number" && result.changes > 0,
      responses: typeof result.changes === "number" && result.changes > 0 ? responses : null,
      isDuplicate: false,
    };
  }

  close(): void {
    this.db.close();
  }
}

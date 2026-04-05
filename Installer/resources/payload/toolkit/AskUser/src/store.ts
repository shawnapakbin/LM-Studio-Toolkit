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
  created_at: string;
  expires_at: string;
  answered_at: string | null;
};

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ask_user_interviews (
      id TEXT PRIMARY KEY,
      title TEXT,
      task_run_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'answered', 'expired', 'cancelled')),
      questions_json TEXT NOT NULL,
      responses_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      answered_at DATETIME
    );

    CREATE INDEX IF NOT EXISTS idx_ask_user_status ON ask_user_interviews(status);
    CREATE INDEX IF NOT EXISTS idx_ask_user_task_run ON ask_user_interviews(task_run_id);
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

  close(): void {
    this.db.close();
  }
}

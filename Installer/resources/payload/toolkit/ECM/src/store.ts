import path from "path";
import Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import type { SegmentInsertInput, SegmentRecord } from "./types";

const _rawDbPath = process.env.ECM_DB_PATH ?? "../ecm.db";
export const DB_PATH =
  _rawDbPath === ":memory:" || path.isAbsolute(_rawDbPath)
    ? _rawDbPath
    : path.resolve(__dirname, _rawDbPath);

function initSchema(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS ecm_segments (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      type            TEXT NOT NULL,
      content         TEXT NOT NULL,
      embedding_json  TEXT NOT NULL,
      token_count     INTEGER NOT NULL,
      metadata_json   TEXT,
      importance      REAL NOT NULL DEFAULT 0.5,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ecm_session_id ON ecm_segments(session_id);
    CREATE INDEX IF NOT EXISTS idx_ecm_session_type ON ecm_segments(session_id, type);
    CREATE INDEX IF NOT EXISTS idx_ecm_created_at ON ecm_segments(created_at);
  `);
}

export class ECMStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    initSchema(this.db);
  }

  insertSegment(input: SegmentInsertInput): SegmentRecord {
    const id = uuid();
    const stmt = this.db.prepare(`
      INSERT INTO ecm_segments (id, session_id, type, content, embedding_json, token_count, metadata_json, importance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      input.sessionId,
      input.type,
      input.content,
      input.embeddingJson,
      input.tokenCount,
      input.metadataJson,
      input.importance,
    );
    return this.getSegmentById(id) as SegmentRecord;
  }

  getSegmentById(id: string): SegmentRecord | undefined {
    return this.db.prepare("SELECT * FROM ecm_segments WHERE id = ?").get(id) as
      | SegmentRecord
      | undefined;
  }

  getSegmentsBySession(sessionId: string): SegmentRecord[] {
    return this.db
      .prepare("SELECT * FROM ecm_segments WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId) as SegmentRecord[];
  }

  getOldestNonSummarySegments(sessionId: string, keepNewest: number): SegmentRecord[] {
    // Get all non-summary segments ordered oldest first, excluding the keepNewest newest
    const all = this.db
      .prepare(
        "SELECT * FROM ecm_segments WHERE session_id = ? AND type != 'summary' ORDER BY created_at ASC",
      )
      .all(sessionId) as SegmentRecord[];
    if (all.length <= keepNewest) return [];
    return all.slice(0, all.length - keepNewest);
  }

  listSegments(sessionId: string, limit: number, offset: number): SegmentRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM ecm_segments WHERE session_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      )
      .all(sessionId, limit, offset) as SegmentRecord[];
  }

  countSegments(sessionId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM ecm_segments WHERE session_id = ?")
      .get(sessionId) as { cnt: number };
    return row.cnt;
  }

  deleteSegment(id: string): { deleted: boolean } {
    const result = this.db.prepare("DELETE FROM ecm_segments WHERE id = ?").run(id);
    return { deleted: result.changes > 0 };
  }

  deleteSegmentsByIds(ids: string[]): { deletedCount: number } {
    if (ids.length === 0) return { deletedCount: 0 };
    const placeholders = ids.map(() => "?").join(", ");
    const result = this.db
      .prepare(`DELETE FROM ecm_segments WHERE id IN (${placeholders})`)
      .run(...ids);
    return { deletedCount: result.changes };
  }

  clearSession(sessionId: string): { deletedCount: number } {
    const result = this.db.prepare("DELETE FROM ecm_segments WHERE session_id = ?").run(sessionId);
    return { deletedCount: result.changes };
  }

  close(): void {
    this.db.close();
  }
}

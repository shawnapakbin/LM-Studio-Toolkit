import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import type { SegmentInsertInput, SegmentRecord } from "./types";

const _rawDbPath = process.env.ECM_DB_PATH ?? "../ecm.db";
export const DB_PATH =
  _rawDbPath === ":memory:" || path.isAbsolute(_rawDbPath)
    ? _rawDbPath
    : path.resolve(__dirname, _rawDbPath);

/**
 * Detect a legacy ECM schema (pre-v3): presence of `embedding_json` column on
 * `ecm_segments` or the `ecm_session_policy` table. If found, rename the DB to
 * `<path>.bak-<ISO timestamp>` so a fresh schema can be created cleanly.
 */
function migrateLegacyIfNeeded(dbPath: string): void {
  if (dbPath === ":memory:") return;
  if (!fs.existsSync(dbPath)) return;

  let isLegacy = false;
  let probe: Database.Database | undefined;
  try {
    probe = new Database(dbPath, { readonly: true });
    const segCols = probe.prepare("PRAGMA table_info(ecm_segments)").all() as Array<{
      name: string;
    }>;
    if (segCols.some((c) => c.name === "embedding_json")) isLegacy = true;
    const policyTable = probe
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ecm_session_policy'")
      .get();
    if (policyTable) isLegacy = true;
  } catch {
    // If we can't even open it read-only, treat as non-legacy and let init handle it.
    return;
  } finally {
    probe?.close();
  }

  if (!isLegacy) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${dbPath}.bak-${stamp}`;
  try {
    fs.renameSync(dbPath, backupPath);
    // Move sidecar WAL/SHM files too if present.
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${dbPath}${suffix}`;
      if (fs.existsSync(sidecar)) {
        try {
          fs.renameSync(sidecar, `${backupPath}${suffix}`);
        } catch {
          // Best-effort cleanup only.
        }
      }
    }
    process.stderr.write(
      `[ECM] Detected legacy schema; backed up DB to ${backupPath} and starting fresh.\n`,
    );
  } catch (err) {
    process.stderr.write(
      `[ECM] Legacy schema detected but backup failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

function initSchema(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS ecm_segments (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      type            TEXT NOT NULL,
      content         TEXT NOT NULL,
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
    migrateLegacyIfNeeded(dbPath);
    this.db = new Database(dbPath);
    initSchema(this.db);
  }

  insertSegment(input: SegmentInsertInput): SegmentRecord {
    const id = uuid();
    this.db
      .prepare(
        `INSERT INTO ecm_segments (id, session_id, type, content, token_count, metadata_json, importance)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.type,
        input.content,
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

  getOldestNonSummarySegments(sessionId: string, keepNewest: number): SegmentRecord[] {
    const all = this.db
      .prepare(
        "SELECT * FROM ecm_segments WHERE session_id = ? AND type != 'summary' ORDER BY created_at ASC",
      )
      .all(sessionId) as SegmentRecord[];
    if (all.length <= keepNewest) return [];
    return all.slice(0, all.length - keepNewest);
  }

  countSegments(sessionId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM ecm_segments WHERE session_id = ?")
      .get(sessionId) as { cnt: number };
    return row.cnt;
  }

  countNonSummarySegments(sessionId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) as cnt FROM ecm_segments WHERE session_id = ? AND type != 'summary'",
      )
      .get(sessionId) as { cnt: number };
    return row.cnt;
  }

  getSessionTokenCount(sessionId: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(token_count), 0) as total FROM ecm_segments WHERE session_id = ?",
      )
      .get(sessionId) as { total: number };
    return row.total;
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

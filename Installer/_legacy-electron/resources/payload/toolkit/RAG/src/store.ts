import crypto from "crypto";
import Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import type { ChunkInput, ChunkRecord, SourceRecord, SourceType } from "./types";

export type SourceCreateInput = {
  sourceKey: string;
  sourceType: SourceType;
  title?: string;
  metadata?: Record<string, unknown>;
  fullText: string;
};

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rag_sources (
      id TEXT PRIMARY KEY,
      source_key TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL,
      title TEXT,
      content_hash TEXT NOT NULL,
      source_text TEXT NOT NULL,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      chunk_count INTEGER DEFAULT 0,
      token_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS rag_chunks (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      embedding_json TEXT NOT NULL,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_id) REFERENCES rag_sources(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_rag_source_key ON rag_sources(source_key);
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_source_id ON rag_chunks(source_id);
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_source_index ON rag_chunks(source_id, chunk_index);
  `);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
}

function jsonOrNull(value?: Record<string, unknown>): string | null {
  if (!value) {
    return null;
  }
  return JSON.stringify(value);
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export class RAGStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    initSchema(this.db);
  }

  upsertSource(input: SourceCreateInput): SourceRecord {
    const now = new Date().toISOString();
    const contentHash = hashContent(input.fullText);

    const existing = this.getSourceByKey(input.sourceKey);
    if (!existing) {
      const id = uuid();
      const insert = this.db.prepare(
        `INSERT INTO rag_sources
        (id, source_key, source_type, title, content_hash, source_text, metadata_json, created_at, updated_at, last_indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      insert.run(
        id,
        input.sourceKey,
        input.sourceType,
        input.title ?? null,
        contentHash,
        input.fullText,
        jsonOrNull(input.metadata),
        now,
        now,
        now,
      );

      const created = this.getSourceById(id);
      if (!created) {
        throw new Error("Failed to create source record.");
      }
      return created;
    }

    const update = this.db.prepare(
      `UPDATE rag_sources
       SET source_type = ?, title = ?, content_hash = ?, source_text = ?, metadata_json = ?, updated_at = ?, last_indexed_at = ?
       WHERE id = ?`,
    );

    update.run(
      input.sourceType,
      input.title ?? existing.title,
      contentHash,
      input.fullText,
      jsonOrNull(input.metadata),
      now,
      now,
      existing.id,
    );

    const updated = this.getSourceById(existing.id);
    if (!updated) {
      throw new Error("Failed to update source record.");
    }
    return updated;
  }

  replaceChunks(sourceId: string, chunks: ChunkInput[]): void {
    const remove = this.db.prepare("DELETE FROM rag_chunks WHERE source_id = ?");
    const insert = this.db.prepare(
      `INSERT INTO rag_chunks
       (id, source_id, chunk_index, content, token_count, embedding_json, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    const updateSource = this.db.prepare(
      `UPDATE rag_sources
       SET chunk_count = ?, token_count = ?, updated_at = CURRENT_TIMESTAMP, last_indexed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    );

    const tx = this.db.transaction(() => {
      remove.run(sourceId);
      let totalTokens = 0;
      chunks.forEach((chunk, index) => {
        totalTokens += chunk.tokenCount;
        insert.run(
          uuid(),
          sourceId,
          index,
          chunk.content,
          chunk.tokenCount,
          JSON.stringify(chunk.embedding),
          jsonOrNull(chunk.metadata),
        );
      });

      updateSource.run(chunks.length, totalTokens, sourceId);
    });

    tx();
  }

  getSourceById(sourceId: string): SourceRecord | undefined {
    const stmt = this.db.prepare("SELECT * FROM rag_sources WHERE id = ?");
    return stmt.get(sourceId) as SourceRecord | undefined;
  }

  getSourceByKey(sourceKey: string): SourceRecord | undefined {
    const stmt = this.db.prepare("SELECT * FROM rag_sources WHERE source_key = ?");
    return stmt.get(sourceKey) as SourceRecord | undefined;
  }

  listSources(limit: number, offset: number): SourceRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM rag_sources ORDER BY updated_at DESC LIMIT ? OFFSET ?",
    );

    return stmt.all(limit, offset) as SourceRecord[];
  }

  deleteSource(sourceId: string): { sourceDeleted: boolean; chunksDeleted: number } {
    const countStmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM rag_chunks WHERE source_id = ?",
    );
    const countRow = countStmt.get(sourceId) as { count: number };

    const deleteStmt = this.db.prepare("DELETE FROM rag_sources WHERE id = ?");
    const deleteResult = deleteStmt.run(sourceId);

    return {
      sourceDeleted: deleteResult.changes > 0,
      chunksDeleted: countRow?.count ?? 0,
    };
  }

  getAllChunks(filters?: { sourceIds?: string[]; sourceKeys?: string[] }): ChunkRecord[] {
    if (filters?.sourceKeys && filters.sourceKeys.length > 0) {
      const placeholders = filters.sourceKeys.map(() => "?").join(", ");
      const stmt = this.db.prepare(
        `SELECT c.*
         FROM rag_chunks c
         JOIN rag_sources s ON c.source_id = s.id
         WHERE s.source_key IN (${placeholders})`,
      );
      return stmt.all(...filters.sourceKeys) as ChunkRecord[];
    }

    if (filters?.sourceIds && filters.sourceIds.length > 0) {
      const placeholders = filters.sourceIds.map(() => "?").join(", ");
      const stmt = this.db.prepare(`SELECT * FROM rag_chunks WHERE source_id IN (${placeholders})`);
      return stmt.all(...filters.sourceIds) as ChunkRecord[];
    }

    const stmt = this.db.prepare("SELECT * FROM rag_chunks");
    return stmt.all() as ChunkRecord[];
  }

  getSourceMap(): Map<string, SourceRecord> {
    const stmt = this.db.prepare("SELECT * FROM rag_sources");
    const rows = stmt.all() as SourceRecord[];
    return new Map(rows.map((row) => [row.id, row]));
  }

  close(): void {
    this.db.close();
  }
}

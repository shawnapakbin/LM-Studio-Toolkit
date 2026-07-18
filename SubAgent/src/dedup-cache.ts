/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

import crypto from "crypto";
import Database from "better-sqlite3";
import { getLogger } from "llm-toolkit-observability";

import type { CacheEntry, TaskDefinition, TaskManifest, TelemetryRecord } from "./types";

const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * SQLite-backed dedup/result cache with LRU eviction.
 *
 * Stores completed sub-session results keyed by their Input_Hash (SHA-256).
 * Provides memoization across server restarts via SQLite persistence and
 * enforces a configurable entry limit using least-recently-used eviction.
 *
 * Graceful degradation: all SQLite operations are wrapped in try/catch.
 * On failure, a WARN is logged and the operation returns a safe fallback
 * (null for get, no-op for set, 0 for clear) so the system continues
 * without cache rather than crashing.
 */
export class DedupCache {
  private db: Database.Database | null = null;
  private readonly maxEntries: number;
  private readonly dbPath: string;

  constructor(dbPath: string, maxEntries: number = DEFAULT_MAX_ENTRIES) {
    this.dbPath = dbPath;
    this.maxEntries = maxEntries;
    this.initializeDatabase();
  }

  /**
   * Initialize the SQLite database and create the schema if needed.
   */
  private initializeDatabase(): void {
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS cache_entries (
          input_hash TEXT PRIMARY KEY,
          result_text TEXT NOT NULL,
          prompt_tokens INTEGER NOT NULL,
          completion_tokens INTEGER NOT NULL,
          total_tokens INTEGER NOT NULL,
          completed_at TEXT NOT NULL,
          model_id TEXT NOT NULL,
          telemetry_json TEXT,
          last_accessed_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_cache_last_accessed ON cache_entries(last_accessed_at);
        CREATE INDEX IF NOT EXISTS idx_cache_completed_at ON cache_entries(completed_at);
      `);
    } catch (error) {
      const logger = getLogger();
      logger.warn("DedupCache: Failed to initialize SQLite database, cache disabled", {
        dbPath: this.dbPath,
        error: error instanceof Error ? error.message : String(error),
      });
      this.db = null;
    }
  }

  /**
   * Retrieve a cached entry by hash, returning null if not found,
   * expired (older than maxAge seconds), or on database error.
   * Updates `last_accessed_at` on successful retrieval (LRU tracking).
   */
  get(hash: string, maxAge: number): CacheEntry | null {
    if (!this.db) return null;

    try {
      const row = this.db
        .prepare(
          `SELECT input_hash, result_text, prompt_tokens, completion_tokens,
                  total_tokens, completed_at, model_id, telemetry_json
           FROM cache_entries WHERE input_hash = ?`,
        )
        .get(hash) as CacheRow | undefined;

      if (!row) return null;

      // Check age expiry
      const completedAt = new Date(row.completed_at).getTime();
      const ageSeconds = (Date.now() - completedAt) / 1000;
      if (ageSeconds > maxAge) return null;

      // Update last_accessed_at for LRU tracking
      const now = new Date().toISOString();
      this.db
        .prepare(`UPDATE cache_entries SET last_accessed_at = ? WHERE input_hash = ?`)
        .run(now, hash);

      return {
        inputHash: row.input_hash,
        result: row.result_text,
        tokenUsage: {
          prompt: row.prompt_tokens,
          completion: row.completion_tokens,
          total: row.total_tokens,
        },
        completedAt: row.completed_at,
        modelId: row.model_id,
        telemetry: row.telemetry_json ? JSON.parse(row.telemetry_json) : undefined,
      };
    } catch (error) {
      const logger = getLogger();
      logger.warn("DedupCache: Failed to read from cache", {
        hash,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Store a cache entry. If the cache exceeds maxEntries, the least-recently-used
   * entry (oldest `last_accessed_at`) is evicted first.
   */
  set(hash: string, entry: CacheEntry): void {
    if (!this.db) return;

    try {
      const now = new Date().toISOString();

      // Upsert the entry
      this.db
        .prepare(
          `INSERT OR REPLACE INTO cache_entries (
            input_hash, result_text, prompt_tokens, completion_tokens,
            total_tokens, completed_at, model_id, telemetry_json,
            last_accessed_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          hash,
          entry.result,
          entry.tokenUsage.prompt,
          entry.tokenUsage.completion,
          entry.tokenUsage.total,
          entry.completedAt,
          entry.modelId,
          entry.telemetry ? JSON.stringify(entry.telemetry) : null,
          now,
          now,
        );

      // LRU eviction: if we exceed maxEntries, delete the oldest accessed entry
      this.evictIfNeeded();
    } catch (error) {
      const logger = getLogger();
      logger.warn("DedupCache: Failed to write to cache", {
        hash,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Evict least-recently-used entries until the cache is within the max limit.
   */
  private evictIfNeeded(): void {
    if (!this.db) return;

    const countRow = this.db.prepare(`SELECT COUNT(*) as cnt FROM cache_entries`).get() as {
      cnt: number;
    };

    if (countRow.cnt > this.maxEntries) {
      const excess = countRow.cnt - this.maxEntries;
      this.db
        .prepare(
          `DELETE FROM cache_entries WHERE input_hash IN (
            SELECT input_hash FROM cache_entries
            ORDER BY last_accessed_at ASC
            LIMIT ?
          )`,
        )
        .run(excess);
    }
  }

  /**
   * Clear cache entries with optional filters.
   * - `prefix`: remove entries whose input_hash starts with this prefix
   * - `olderThan`: remove entries whose completed_at is older than this many seconds ago
   * - No options: remove all entries
   *
   * Returns the number of entries removed.
   */
  clear(options?: { prefix?: string; olderThan?: number }): number {
    if (!this.db) return 0;

    try {
      if (!options || (!options.prefix && options.olderThan === undefined)) {
        // Remove all entries
        const info = this.db.prepare(`DELETE FROM cache_entries`).run();
        return info.changes;
      }

      const conditions: string[] = [];
      const params: (string | number)[] = [];

      if (options.prefix) {
        conditions.push(`input_hash LIKE ? || '%'`);
        params.push(options.prefix);
      }

      if (options.olderThan !== undefined) {
        const cutoff = new Date(Date.now() - options.olderThan * 1000).toISOString();
        conditions.push(`completed_at < ?`);
        params.push(cutoff);
      }

      const whereClause = conditions.join(" AND ");
      const info = this.db.prepare(`DELETE FROM cache_entries WHERE ${whereClause}`).run(...params);

      return info.changes;
    } catch (error) {
      const logger = getLogger();
      logger.warn("DedupCache: Failed to clear cache", {
        options,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Get estimated telemetry from cached entries matching the given model parameters.
   * Returns the arithmetic mean of wall-clock duration and inference speed from
   * all cached entries that have telemetry stored, or null if none exist.
   */
  getEstimatedTelemetry(_modelParams: object): TelemetryRecord | null {
    if (!this.db) return null;

    try {
      const rows = this.db
        .prepare(
          `SELECT telemetry_json FROM cache_entries
           WHERE telemetry_json IS NOT NULL`,
        )
        .all() as Array<{ telemetry_json: string }>;

      if (rows.length === 0) return null;

      const telemetryRecords: TelemetryRecord[] = rows
        .map((row) => {
          try {
            return JSON.parse(row.telemetry_json) as TelemetryRecord;
          } catch {
            return null;
          }
        })
        .filter((t): t is TelemetryRecord => t !== null);

      if (telemetryRecords.length === 0) return null;

      const totalPromptTokens = telemetryRecords.reduce((sum, t) => sum + t.promptTokens, 0);
      const totalCompletionTokens = telemetryRecords.reduce(
        (sum, t) => sum + t.completionTokens,
        0,
      );
      const totalTokens = telemetryRecords.reduce((sum, t) => sum + t.totalTokens, 0);
      const totalWallClockMs = telemetryRecords.reduce((sum, t) => sum + t.wallClockMs, 0);
      const totalTokensPerSecond = telemetryRecords.reduce((sum, t) => sum + t.tokensPerSecond, 0);

      const count = telemetryRecords.length;

      return {
        promptTokens: Math.round(totalPromptTokens / count),
        completionTokens: Math.round(totalCompletionTokens / count),
        totalTokens: Math.round(totalTokens / count),
        wallClockMs: Math.round(totalWallClockMs / count),
        tokensPerSecond: totalTokensPerSecond / count,
      };
    } catch (error) {
      const logger = getLogger();
      logger.warn("DedupCache: Failed to compute estimated telemetry", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Compute a deterministic SHA-256 Input_Hash from a task definition and manifest.
   *
   * Canonicalization steps:
   * 1. Sort allowedTools alphabetically (or use [] if absent)
   * 2. Sort model parameter keys alphabetically
   * 3. Treat null/omitted optional fields as empty strings
   * 4. Concatenate: systemPrompt + "|" + taskPrompt + "|" + JSON.stringify(sortedParams) + "|" + JSON.stringify(sortedTools)
   * 5. Hash the concatenated string with SHA-256, output as hex
   */
  static computeHash(task: TaskDefinition, manifest: TaskManifest): string {
    // Resolve system prompt: task-specific overrides shared, both default to empty string
    const systemPrompt = task.systemPrompt ?? manifest.systemPrompt ?? "";
    const taskPrompt = task.prompt ?? "";

    // Sort allowed tools alphabetically, default to empty array
    const sortedTools = [...(task.allowedTools ?? [])].sort();

    // Build sorted model parameters object (only include relevant params)
    const params: Record<string, string | number | boolean> = {};
    if (manifest.temperature !== undefined && manifest.temperature !== null) {
      params.temperature = manifest.temperature;
    } else {
      params.temperature = "";
    }
    if (manifest.maxTokens !== undefined && manifest.maxTokens !== null) {
      params.maxTokens = manifest.maxTokens;
    } else {
      params.maxTokens = "";
    }

    // Sort parameter keys alphabetically
    const sortedParams: Record<string, string | number | boolean> = {};
    for (const key of Object.keys(params).sort()) {
      sortedParams[key] = params[key];
    }

    // Concatenate with pipe separator
    const canonical = `${systemPrompt}|${taskPrompt}|${JSON.stringify(sortedParams)}|${JSON.stringify(sortedTools)}`;

    // Hash with SHA-256
    return crypto.createHash("sha256").update(canonical).digest("hex");
  }

  /**
   * Close the database connection (for cleanup/testing).
   */
  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Ignore close errors
      }
      this.db = null;
    }
  }
}

/**
 * Internal row type matching the SQLite schema.
 */
interface CacheRow {
  input_hash: string;
  result_text: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  completed_at: string;
  model_id: string;
  telemetry_json: string | null;
  last_accessed_at: string;
  created_at: string;
}

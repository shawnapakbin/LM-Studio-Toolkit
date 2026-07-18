/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

/**
 * Session-scoped in-memory registry tracking all Sub_Sessions dispatched
 * during the MCP server's lifetime. Enables cross-dispatch deduplication
 * and queryable session history via the list_sessions tool.
 *
 * The registry is purely in-memory — resets to empty on every server process
 * restart, making it session-scoped. This prevents redundant inference across
 * multiple dispatch calls within a single long-running session without the
 * overhead of disk I/O.
 *
 * Lookup order during dispatch_sub_tasks:
 * 1. Session_Registry — check for a successful result from a prior dispatch
 * 2. Dedup_Cache — check for a cached result from a prior server session (SQLite)
 * 3. Fresh inference — execute the task against the LM Studio API
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type RegistryStatus =
  | "pending"
  | "in-progress"
  | "success"
  | "failed"
  | "timed_out"
  | "aborted"
  | "cancelled"
  | "budget_exceeded";

export interface RegistryEntry {
  taskId: string;
  inputHash: string;
  status: RegistryStatus;
  result: string | null;
  dispatchId: string;
  timestamp: string; // ISO 8601
}

export interface RegistryFilter {
  status?: string;
  dispatchId?: string;
  hashPrefix?: string;
}

// ─── Session Registry ────────────────────────────────────────────────────────

export class SessionRegistry {
  private entries: Map<string, RegistryEntry[]>;

  constructor() {
    this.entries = new Map();
  }

  /**
   * Register a new entry in the registry, keyed by its inputHash.
   * Multiple entries may share the same inputHash (from different dispatches).
   */
  register(entry: RegistryEntry): void {
    const existing = this.entries.get(entry.inputHash);
    if (existing) {
      existing.push(entry);
    } else {
      this.entries.set(entry.inputHash, [entry]);
    }
  }

  /**
   * Lookup the first entry with status 'success' for the given inputHash.
   * Returns null if no successful entry exists for that hash.
   *
   * This enables cross-dispatch deduplication: if a prior dispatch already
   * completed the same task successfully, we can reuse that result without
   * making another API call.
   */
  lookup(inputHash: string): RegistryEntry | null {
    const entries = this.entries.get(inputHash);
    if (!entries) return null;
    const match = entries.find((e) => e.status === "success");
    return match ?? null;
  }

  /**
   * Update the status of an entry identified by both taskId and dispatchId.
   * Since the same taskId could exist across different dispatches, both fields
   * are needed to uniquely identify the target entry.
   *
   * Optionally updates the result field (e.g., when transitioning to 'success').
   */
  updateStatus(taskId: string, dispatchId: string, status: string, result?: string): void {
    for (const entryList of this.entries.values()) {
      for (const entry of entryList) {
        if (entry.taskId === taskId && entry.dispatchId === dispatchId) {
          entry.status = status as RegistryStatus;
          if (result !== undefined) {
            entry.result = result;
          }
          return;
        }
      }
    }
  }

  /**
   * List entries with optional filters applied as logical AND.
   * When no filters are provided, returns all entries ordered by timestamp ascending.
   *
   * Supported filters:
   * - status: match entries with this exact status
   * - dispatchId: match entries from this specific dispatch
   * - hashPrefix: match entries whose inputHash starts with this prefix
   */
  list(filter?: RegistryFilter): RegistryEntry[] {
    const allEntries: RegistryEntry[] = [];
    for (const entryList of this.entries.values()) {
      for (const entry of entryList) {
        allEntries.push(entry);
      }
    }

    let filtered = allEntries;

    if (filter) {
      if (filter.status !== undefined) {
        filtered = filtered.filter((e) => e.status === filter.status);
      }
      if (filter.dispatchId !== undefined) {
        filtered = filtered.filter((e) => e.dispatchId === filter.dispatchId);
      }
      if (filter.hashPrefix !== undefined) {
        filtered = filtered.filter((e) => e.inputHash.startsWith(filter.hashPrefix as string));
      }
    }

    // Sort by timestamp ascending (oldest first)
    filtered.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return filtered;
  }

  /**
   * Clear all entries from the registry.
   * In practice, this is implicit on server restart since the registry
   * is purely in-memory with no persistence layer.
   */
  clear(): void {
    this.entries = new Map();
  }
}

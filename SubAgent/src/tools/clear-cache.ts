/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

import { getLogger } from "llm-toolkit-observability";
import { DedupCache } from "../dedup-cache";
import type { ServerConfig } from "../mcp-server";

// ─── Module-level singleton ──────────────────────────────────────────────────

let dedupCache: DedupCache | null = null;

/**
 * Set the singleton DedupCache instance (called from mcp-server integration).
 */
export function setDedupCache(cache: DedupCache): void {
  dedupCache = cache;
}

/**
 * Get or lazily create the DedupCache singleton.
 */
function getDedupCache(config: ServerConfig): DedupCache {
  if (!dedupCache) {
    dedupCache = new DedupCache(config.cachePath);
  }
  return dedupCache;
}

/**
 * Handler for the clear_cache MCP tool.
 *
 * Accepts an optional prefix filter (string) and optional age threshold (seconds).
 * If both parameters are omitted, all entries are removed from the Dedup_Cache.
 * If a prefix matches zero entries, returns success with 0 entries removed.
 *
 * Requirements: 7.7, 7.8
 */
export async function handleClearCache(
  args: unknown,
  config: ServerConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const logger = getLogger().child("clear-cache");

  // ─── Parse Input ─────────────────────────────────────────────────────────
  const input = args as { prefix?: string; olderThan?: number };
  const prefix = input?.prefix;
  const olderThan = input?.olderThan;

  // Validate prefix if provided
  if (prefix !== undefined && (typeof prefix !== "string" || prefix.length === 0)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "Invalid input: prefix must be a non-empty string if provided",
          }),
        },
      ],
    };
  }

  // Validate olderThan if provided
  if (olderThan !== undefined && (typeof olderThan !== "number" || olderThan < 0)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "Invalid input: olderThan must be a non-negative number (seconds) if provided",
          }),
        },
      ],
    };
  }

  // ─── Build filter options ────────────────────────────────────────────────
  const options: { prefix?: string; olderThan?: number } = {};

  if (prefix !== undefined) {
    options.prefix = prefix;
  }

  if (olderThan !== undefined) {
    options.olderThan = olderThan;
  }

  // ─── Clear cache ─────────────────────────────────────────────────────────
  const cache = getDedupCache(config);
  const hasOptions = prefix !== undefined || olderThan !== undefined;
  const entriesRemoved = cache.clear(hasOptions ? options : undefined);

  logger.info("Cache cleared", {
    prefix: prefix ?? null,
    olderThan: olderThan ?? null,
    entriesRemoved,
  });

  // ─── Return confirmation ─────────────────────────────────────────────────
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          entriesRemoved,
          filter: {
            prefix: prefix ?? null,
            olderThan: olderThan ?? null,
          },
        }),
      },
    ],
  };
}

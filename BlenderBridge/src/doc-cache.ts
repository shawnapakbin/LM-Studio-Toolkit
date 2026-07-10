/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Documentation cache for Blender API lookups.
 * Provides disk-persistent, version-keyed caching with token-based search.
 *
 * Requirement 8: API Documentation Cache
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DocCacheEntry } from "./types";

/** Internal structure stored on disk. */
interface CacheFile {
  blenderVersion: string;
  entries: Record<string, DocCacheEntry>;
}

/**
 * Disk-persistent documentation cache keyed by identifier and Blender version.
 * Supports exact lookup, token-based search, and automatic size limiting.
 */
export class DocCache {
  private blenderVersion: string;
  private filePath: string;
  private maxSizeBytes: number;
  private entries: Map<string, DocCacheEntry>;
  private loaded: boolean;

  /**
   * @param blenderVersion - Current Blender version string (e.g. "5.1.0")
   * @param filePath - Path to the cache JSON file. Defaults to ~/.blender-bridge/doc-cache.json
   * @param maxSizeBytes - Maximum cache size in bytes. Defaults to 50 MB.
   */
  constructor(blenderVersion: string, filePath?: string, maxSizeBytes?: number) {
    this.blenderVersion = blenderVersion;
    this.filePath = filePath || path.join(os.homedir(), ".blender-bridge", "doc-cache.json");
    this.maxSizeBytes = maxSizeBytes ?? 50 * 1024 * 1024;
    this.entries = new Map();
    this.loaded = false;
  }

  /**
   * Retrieves a cached entry by exact identifier.
   * Returns null on cache miss or version mismatch.
   */
  get(identifier: string): DocCacheEntry | null {
    this.ensureLoaded();
    return this.entries.get(identifier) ?? null;
  }

  /**
   * Searches the cache using case-insensitive token matching.
   * Every query token must appear in the entry's identifier or content.
   * Results are ranked by total matching token count descending,
   * returning at most `limit` results (default 20).
   */
  search(query: string, limit: number = 20): DocCacheEntry[] {
    this.ensureLoaded();

    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);

    if (tokens.length === 0) {
      return [];
    }

    const scored: Array<{ entry: DocCacheEntry; matchCount: number }> = [];

    for (const entry of this.entries.values()) {
      const haystack = (entry.identifier + " " + entry.content).toLowerCase();
      const matchCount = tokens.filter((token) => haystack.includes(token)).length;

      // All tokens must be present
      if (matchCount === tokens.length) {
        scored.push({ entry, matchCount });
      }
    }

    // Rank by match count descending (secondary: alphabetical by identifier)
    scored.sort((a, b) => {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return a.entry.identifier.localeCompare(b.entry.identifier);
    });

    return scored.slice(0, limit).map((s) => s.entry);
  }

  /**
   * Stores an entry in the cache and persists to disk.
   * If adding the entry exceeds max size, evicts oldest entries.
   */
  put(entry: DocCacheEntry): void {
    this.ensureLoaded();
    this.entries.set(entry.identifier, entry);
    this.enforceMaxSize();
    this.persist();
  }

  /**
   * Invalidates all cached entries (e.g. on version change).
   */
  invalidateAll(): void {
    this.entries.clear();
    this.persist();
  }

  /**
   * Returns cache statistics.
   */
  getStats(): { entryCount: number; sizeBytes: number } {
    this.ensureLoaded();
    const serialized = JSON.stringify(this.toCacheFile());
    return {
      entryCount: this.entries.size,
      sizeBytes: Buffer.byteLength(serialized, "utf-8"),
    };
  }

  /**
   * Updates the Blender version. If it differs from the cached version,
   * invalidates all entries.
   */
  setBlenderVersion(version: string): void {
    if (version !== this.blenderVersion) {
      this.blenderVersion = version;
      this.invalidateAll();
    }
  }

  // --- Private helpers ---

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const data: CacheFile = JSON.parse(raw);

      // Version mismatch → invalidate
      if (data.blenderVersion !== this.blenderVersion) {
        this.entries.clear();
        return;
      }

      for (const [key, entry] of Object.entries(data.entries)) {
        this.entries.set(key, entry);
      }
    } catch {
      // If cache file is corrupted, start fresh
      this.entries.clear();
    }
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const content = JSON.stringify(this.toCacheFile(), null, 0);
      fs.writeFileSync(this.filePath, content, "utf-8");
    } catch {
      // Best-effort persistence — do not throw on write failure
    }
  }

  private toCacheFile(): CacheFile {
    const entries: Record<string, DocCacheEntry> = {};
    for (const [key, entry] of this.entries) {
      entries[key] = entry;
    }
    return { blenderVersion: this.blenderVersion, entries };
  }

  private enforceMaxSize(): void {
    let serialized = JSON.stringify(this.toCacheFile());
    let size = Buffer.byteLength(serialized, "utf-8");

    if (size <= this.maxSizeBytes) return;

    // Evict oldest entries by fetchedAt until under limit
    const sorted = [...this.entries.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);

    for (const [key] of sorted) {
      if (size <= this.maxSizeBytes) break;
      this.entries.delete(key);
      serialized = JSON.stringify(this.toCacheFile());
      size = Buffer.byteLength(serialized, "utf-8");
    }
  }
}

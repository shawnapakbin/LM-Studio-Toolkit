/**
 * TypeScript model of the Rust installation logger (`src-tauri/src/logger.rs`).
 *
 * This mirrors the Rust logging contract for property testing:
 * - Structured log entries with timestamp, level, phase, message, and optional details
 * - Log entries stored in chronological order
 * - Convenience methods for phase start/complete, download, error, info, and warn
 */

/** A structured log entry for installation events */
export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  phase: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Known installation phases matching the Rust installer */
export const KNOWN_PHASES = [
  "dependency-download",
  "repository-setup",
  "build",
  "configuration",
  "lm-studio-sync",
] as const;

export type InstallPhase = (typeof KNOWN_PHASES)[number];

/**
 * InstallLogger models the Rust logger state and public API.
 *
 * Each method records a structured log entry with:
 * - An ISO 8601 timestamp (generated at call time)
 * - A log level (info, warn, error)
 * - The phase name
 * - A human-readable message
 * - Optional structured details
 *
 * Entries are stored in insertion order (chronological).
 */
export class InstallLogger {
  private entries: LogEntry[] = [];

  /** Get the current ISO 8601 timestamp */
  private now(): string {
    return new Date().toISOString();
  }

  /** Internal record method — mirrors Rust's `record()` function */
  private record(
    level: LogEntry["level"],
    phase: string,
    message: string,
    details?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      timestamp: this.now(),
      level,
      phase,
      message,
      ...(details !== undefined ? { details } : {}),
    };
    this.entries.push(entry);
  }

  /** Log the start of an installation phase */
  logPhaseStart(phase: string): void {
    this.record("info", phase, `Phase started: ${phase}`);
  }

  /** Log the successful completion of an installation phase */
  logPhaseComplete(phase: string): void {
    this.record("info", phase, `Phase completed: ${phase}`);
  }

  /** Log a download event with the URL being fetched */
  logDownload(phase: string, url: string): void {
    this.record("info", phase, `Downloading: ${url}`, { url });
  }

  /** Log an error message */
  logError(phase: string, message: string): void {
    this.record("error", phase, message);
  }

  /** Log an error with additional structured detail context */
  logErrorWithDetails(phase: string, message: string, details: Record<string, unknown>): void {
    this.record("error", phase, message, details);
  }

  /** Log an info-level message */
  logInfo(phase: string, message: string): void {
    this.record("info", phase, message);
  }

  /** Log a warning-level message */
  logWarn(phase: string, message: string): void {
    this.record("warn", phase, message);
  }

  /** Get all log entries (chronological order) */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /** Get all log entries as formatted strings (mirrors Rust's `get_entries()`) */
  getFormattedEntries(): string[] {
    return this.entries.map(
      (e) => `[${e.timestamp}] [${e.level.toUpperCase()}] [${e.phase}] ${e.message}`,
    );
  }
}

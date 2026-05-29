/**
 * Structured Logger for LLM Toolkit
 *
 * Provides consistent logging with trace IDs, levels, and structured metadata.
 */

import { generateTraceId } from "@shared/types";

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

/**
 * Structured log entry
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  traceId?: string;
  toolName?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Log transport interface
 */
export interface LogTransport {
  write(entry: LogEntry): void;
}

/**
 * Console transport (for development)
 */
export class ConsoleTransport implements LogTransport {
  write(entry: LogEntry): void {
    const levelColors = {
      [LogLevel.DEBUG]: "\x1b[36m", // Cyan
      [LogLevel.INFO]: "\x1b[32m", // Green
      [LogLevel.WARN]: "\x1b[33m", // Yellow
      [LogLevel.ERROR]: "\x1b[31m", // Red
    };
    const reset = "\x1b[0m";
    const color = levelColors[entry.level] || reset;

    const parts = [
      `${color}[${entry.level.toUpperCase()}]${reset}`,
      entry.timestamp,
      entry.traceId ? `[${entry.traceId}]` : "",
      entry.toolName ? `[${entry.toolName}]` : "",
      entry.message,
      entry.durationMs !== undefined ? `(${entry.durationMs}ms)` : "",
    ];

    const message = parts.filter(Boolean).join(" ");
    console.log(message);

    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      console.log("  ", JSON.stringify(entry.metadata, null, 2));
    }
  }
}

/**
 * JSON transport (for production)
 */
export class JSONTransport implements LogTransport {
  write(entry: LogEntry): void {
    console.log(JSON.stringify(entry));
  }
}

/**
 * File transport (writes to file system)
 */
export class FileTransport implements LogTransport {
  private buffer: LogEntry[] = [];
  private flushInterval: NodeJS.Timeout;

  constructor(
    private filePath: string,
    private bufferSize = 100,
    flushIntervalMs = 5000,
  ) {
    this.flushInterval = setInterval(() => this.flush(), flushIntervalMs);
  }

  write(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length >= this.bufferSize) {
      this.flush();
    }
  }

  flush(): void {
    if (this.buffer.length === 0) return;

    const fs = require("fs");
    const lines = this.buffer.map((e) => JSON.stringify(e)).join("\n") + "\n";

    try {
      fs.appendFileSync(this.filePath, lines, "utf8");
      this.buffer = [];
    } catch (error) {
      console.error("Failed to write logs to file:", error);
    }
  }

  close(): void {
    clearInterval(this.flushInterval);
    this.flush();
  }
}

/**
 * Structured logger with multiple transports
 */
export class Logger {
  private transports: LogTransport[] = [];
  private minLevel: LogLevel = LogLevel.INFO;

  constructor(
    private defaultToolName?: string,
    private defaultTraceId?: string,
  ) {}

  /**
   * Add a transport
   */
  addTransport(transport: LogTransport): void {
    this.transports.push(transport);
  }

  /**
   * Set minimum log level
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Check if level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const minIndex = levels.indexOf(this.minLevel);
    const levelIndex = levels.indexOf(level);
    return levelIndex >= minIndex;
  }

  /**
   * Log an entry
   */
  private log(
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>,
    traceId?: string,
    toolName?: string,
    durationMs?: number,
  ): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      traceId: traceId || this.defaultTraceId,
      toolName: toolName || this.defaultToolName,
      durationMs,
      metadata,
    };

    for (const transport of this.transports) {
      try {
        transport.write(entry);
      } catch (error) {
        console.error("Transport write failed:", error);
      }
    }
  }

  /**
   * Log debug message
   */
  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, metadata);
  }

  /**
   * Log info message
   */
  info(message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, metadata);
  }

  /**
   * Log warning message
   */
  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, metadata);
  }

  /**
   * Log error message
   */
  error(message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, metadata);
  }

  /**
   * Create a child logger with specific context
   */
  child(toolName: string, traceId?: string): Logger {
    const childLogger = new Logger(toolName, traceId || this.defaultTraceId || generateTraceId());
    childLogger.transports = this.transports;
    childLogger.minLevel = this.minLevel;
    return childLogger;
  }

  /**
   * Log a tool execution
   */
  logToolExecution(
    toolName: string,
    success: boolean,
    durationMs: number,
    traceId: string,
    metadata?: Record<string, unknown>,
  ): void {
    const level = success ? LogLevel.INFO : LogLevel.ERROR;
    const status = success ? "completed" : "failed";
    this.log(level, `Tool ${toolName} ${status}`, metadata, traceId, toolName, durationMs);
  }
}

/**
 * Global logger instance
 */
let globalLogger: Logger | null = null;

/**
 * Get or create global logger
 */
export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger();
    globalLogger.addTransport(new ConsoleTransport());
  }
  return globalLogger;
}

/**
 * Set global logger
 */
export function setLogger(logger: Logger): void {
  globalLogger = logger;
}

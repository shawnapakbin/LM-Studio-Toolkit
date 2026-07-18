/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

// ─── Task Manifest (Input) ───────────────────────────────────────────────────

export interface TaskManifest {
  tasks: TaskDefinition[];
  systemPrompt?: string;
  synthesisPrompt?: string;
  mergePrompt?: string;
  temperature?: number;
  maxTokens?: number;
  modelContextSize?: number;
  concurrency?: number;
  maxRetries?: number;
  skipCache?: boolean;
  cacheMaxAge?: number;
  autoChunk?: boolean;
  keepCheckpoints?: boolean;
  taskTimeout?: number;
  dispatchTimeout?: number;
}

export interface TaskDefinition {
  taskId: string;
  prompt: string;
  systemPrompt?: string;
  allowedTools?: string[];
}

// ─── Aggregated Result (Output) ──────────────────────────────────────────────

export interface AggregatedResult {
  dispatchId: string;
  status: "completed" | "partial" | "cancelled";
  tasks: TaskResult[];
  synthesis?: SynthesisResult;
  telemetrySummary: TelemetrySummary;
}

export interface TaskResult {
  taskId: string;
  sessionId: string;
  status: "success" | "failed" | "timed_out" | "aborted" | "cancelled" | "budget_exceeded";
  response?: string;
  error?: TaskError;
  telemetry?: TelemetryRecord;
  cached?: boolean;
  deduplicated?: boolean;
  registryHit?: boolean;
  truncated?: boolean;
  checkpointFailed?: boolean;
  chunks?: ChunkResult[];
}

export interface TaskError {
  type: string;
  message: string;
  httpStatus?: number;
  retryAttempts: number;
}

// ─── Telemetry ───────────────────────────────────────────────────────────────

export interface TelemetryRecord {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  wallClockMs: number;
  tokensPerSecond: number;
}

export interface TelemetrySummary {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalWallClockMs: number;
  meanTokensPerSecond: number;
  slowestTask: { taskId: string; durationMs: number };
  fastestTask: { taskId: string; durationMs: number };
}

// ─── Synthesis ───────────────────────────────────────────────────────────────

export interface SynthesisResult {
  status: "success" | "failed";
  response?: string;
  error?: TaskError;
  telemetry?: TelemetryRecord;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

export interface CacheEntry {
  inputHash: string;
  result: string;
  tokenUsage: { prompt: number; completion: number; total: number };
  completedAt: string;
  modelId: string;
  telemetry?: TelemetryRecord;
}

// ─── Checkpoint ──────────────────────────────────────────────────────────────

export interface CheckpointFile {
  taskId: string;
  inputHash: string;
  result: string;
  tokenUsage: { prompt: number; completion: number; total: number };
  telemetry: TelemetryRecord;
  completedAt: string;
}

// ─── Session Registry ────────────────────────────────────────────────────────

export interface RegistryEntry {
  taskId: string;
  inputHash: string;
  status:
    | "pending"
    | "in-progress"
    | "success"
    | "failed"
    | "timed_out"
    | "aborted"
    | "cancelled"
    | "budget_exceeded";
  result: string | null;
  dispatchId: string;
  timestamp: string;
}

export interface RegistryFilter {
  status?: string;
  dispatchId?: string;
  hashPrefix?: string;
}

// ─── Chunk Strategy ──────────────────────────────────────────────────────────

export interface ChunkResult {
  chunkIndex: number;
  taskId: string;
  response: string;
  telemetry: TelemetryRecord;
}

// ─── Session Pool ────────────────────────────────────────────────────────────

export interface SessionPoolConfig {
  concurrency: number;
  apiUrl: string;
  defaultTimeout: number;
}

// ─── Progress Report ─────────────────────────────────────────────────────────

export interface ProgressReport {
  dispatchId: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  inProgressTasks: number;
  elapsedSeconds: number;
  estimatedRemainingSeconds: number | null;
  tokensConsumed: number;
  taskStatuses: TaskStatus[];
}

export interface TaskStatus {
  taskId: string;
  state: "pending" | "in-progress" | "completed" | "failed";
  elapsedMs?: number;
  potentiallyStalled?: boolean;
}

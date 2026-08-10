/**
 * Core type definitions for the LAN Sub Agent.
 * Defines endpoint models, dispatch state, and LAN-extended result types.
 *
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 1.0.0
 */

import {
  CheckpointFile,
  ProgressReport,
  TaskManifest,
  TaskResult,
  TelemetryRecord,
} from "../../SubAgent/src/types";

// Re-export SubAgent types used by other LanSubAgent modules
export type { TaskManifest, TaskResult, CheckpointFile, TelemetryRecord, ProgressReport };

// ─── Endpoint Models ─────────────────────────────────────────────────────────

export interface EndpointDefinition {
  id: string; // unique identifier (UUID or user-provided)
  host: string; // IP address or hostname
  port: number; // 1–65535
  models: string[]; // available model names (max 50)
  maxConcurrency: number; // 1–100
  enabled: boolean; // user toggle
  source: "manual" | "discovered"; // origin
}

export interface EndpointState {
  definition: EndpointDefinition;
  health: "healthy" | "unhealthy" | "unknown";
  activeTaskCount: number;
  consecutiveFailures: number;
  lastProbeSuccess: string | null; // ISO timestamp
  lastProbeFailure: string | null; // ISO timestamp
  metrics: EndpointMetrics;
}

export interface EndpointMetrics {
  totalRequests: number;
  totalFailures: number;
  totalTokensProcessed: number;
  averageResponseMs: number;
  // Running average computed incrementally
}

// ─── LAN-Extended Result Types ───────────────────────────────────────────────

export interface LanTaskResult extends TaskResult {
  endpointId: string; // which endpoint processed this task
  endpointHost: string; // for traceability
  endpointPort: number;
  durationMs: number; // time taken for this task
  success: boolean; // convenience flag derived from status
  retryEndpoints?: string[]; // endpoints attempted before success
}

export interface LanCheckpointFile extends CheckpointFile {
  endpointId: string; // endpoint that processed this task
}

// ─── Internal Dispatch State ─────────────────────────────────────────────────

export interface LanDispatchState {
  dispatchId: string;
  manifest: TaskManifest;
  tasks: InternalTask[];
  results: Map<string, LanTaskResult>;
  inFlight: Map<string, { endpointId: string; abort: AbortController }>;
  cancelled: boolean;
  startTime: number;
  dispatchAbort: AbortController;
}

export interface InternalTask {
  taskId: string;
  prompt: string;
  systemPrompt?: string;
  status: "pending" | "in-progress" | "completed" | "failed";
  assignedEndpoint?: string;
  retryCount: number;
  failedEndpoints: string[];
}

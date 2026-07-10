/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * BlenderBridge type definitions.
 */

// --- Configuration ---

export interface BlenderBridgeConfig {
  blenderMcpHost: string; // default "127.0.0.1"
  blenderMcpPort: number; // default 9876, range 1-65535
  blenderMcpCommand: string; // default "blender-mcp"
  blenderMcpArgs: string[]; // default [], max combined 1024 chars
  healthCheckTimeoutMs: number; // default 5000
  operationTimeoutMs: number; // default 30000; timeout triggers at elapsed >= 30.0s
  /** Timeout for render operations (ms). Defaults to 90000 if not set. */
  renderTimeoutMs?: number;
  /** Timeout for export operations (ms). Defaults to 90000 if not set. */
  exportTimeoutMs?: number;
  /** Path to the documentation cache file. Defaults to ~/.blender-bridge/doc-cache.json */
  docCachePath?: string;
  /** Maximum cache size in megabytes. Defaults to 50. */
  docCacheMaxSizeMB?: number;
  /** Timeout for upstream documentation fetches in milliseconds. Defaults to 10000. */
  docFetchTimeoutMs?: number;
}

// --- Health Check ---

export interface HealthCheckSuccess {
  status: "ok";
  blenderVersion?: string;
  sceneName?: string;
  addonListening: true;
  blankProjectWarning?: string;
}

export interface HealthCheckError {
  status: "error";
  error: {
    code: "BLENDER_ADDON_UNREACHABLE" | "BLENDER_MCP_NOT_INSTALLED";
    message: string;
    remediation: string;
  };
}

export type HealthCheckResult = HealthCheckSuccess | HealthCheckError;

// --- Blender Execution ---

export interface BlenderExecutionError {
  traceback?: string;
  message: string;
  suggestion?: string;
  operationType?: string;
  timeoutMs?: number;
  operatorName?: string;
  requiredContext?: string;
  availableEnums?: string[];
  suggestions?: string[];
  /** The invalid attribute name from an AttributeError. */
  invalidAttribute?: string;
  /** The object type the invalid attribute was called on. */
  objectType?: string;
  /** Up to 5 valid attributes ranked by Levenshtein similarity (ratio >= 0.6). */
  similarAttributes?: string[];
  /** Up to 10 available items from a collection on KeyError. */
  collectionItems?: string[];
  /** Total item count in the collection when truncated. */
  collectionTotalCount?: number;
  /** The deprecated API call that triggered the error. */
  deprecatedApi?: string;
  /** The replacement API call for the deprecated one. */
  replacementApi?: string;
  /** The Blender version where the deprecation was introduced. */
  deprecationVersion?: string;
  /** A usage example demonstrating the correct API call. */
  usageExample?: string;
}

export interface BlenderExecutionResult {
  success: boolean;
  output?: string;
  error?: BlenderExecutionError;
}

/** Structured timeout error information for enhanced error reporting. */
export interface TimeoutErrorInfo {
  operationType: string;
  timeoutMs: number;
  suggestion: string;
}

/** Structured operator error information for enhanced error reporting. */
export interface OperatorErrorInfo {
  operatorName?: string;
  requiredContext?: string;
  availableEnums?: string[];
  suggestions?: string[];
}

// --- Mesh Validation ---

export interface MeshValidationResult {
  invertedFaces: number;
  nonManifoldEdges: number;
  looseVertices: number;
  faceOrientationIssues: number;
  isValid: boolean;
}

// --- Code Generation Parameters ---

export interface CreateObjectParams {
  name: string; // 1-63 chars, alphanumeric + underscore
  geometryType:
    | "cube"
    | "sphere"
    | "cylinder"
    | "cone"
    | "torus"
    | "plane"
    | "circle"
    | "curve"
    | "empty";
  location?: [number, number, number];
  rotation?: [number, number, number]; // Euler radians
  scale?: [number, number, number]; // positive floats
}

export interface RenderPreviewParams {
  outputPath: string;
  width?: number; // default 480
  height?: number; // default 270
}

// --- Tool Response Types ---

export interface CreateObjectSuccessResponse {
  success: true;
  objectName: string;
  geometryType: string;
  transforms: {
    location: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
}

export interface OrchestrationErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    suggestion?: string;
    traceback?: string;
    remediation?: string;
  };
}

// --- Passthrough Delegate Types ---

/**
 * A single content item from a CallToolResult (matches MCP SDK structure).
 */
export type CallToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/**
 * Delegate function type for calling any tool on the Blender MCP server by name.
 * Generalizes ExecuteBlenderCodeFn to support arbitrary tool invocations.
 */
export type CallToolFn = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<CallToolContent[]>;

/**
 * Result of a passthrough tool call, wrapping content with an error indicator.
 */
export interface CallToolResult {
  isError: boolean;
  content: CallToolContent[];
}

// --- Mesh Quality Scoring ---

/** Letter grade classification for mesh quality. */
export type QualityGrade = "A" | "B" | "C" | "D" | "F";

/** Detailed breakdown of mesh quality metrics. */
export interface MeshQualityBreakdown {
  vertexCount: number;
  edgeCount: number;
  faceCount: number;
  nonManifoldEdgeCount: number;
  looseVertexCount: number;
  degenerateFaceCount: number;
  ngonCount: number;
  ngonPercentage: number;
}

// --- Datablock Cleanup ---

/** Information about a single Blender datablock. */
export interface DatablockInfo {
  name: string;
  type: string;
}

/** Input parameters for the datablock cleanup tool. */
export interface CleanupDatablocksInput {
  /** When true, reports orphaned datablocks without removing them. Defaults to false. */
  dryRun?: boolean;
}

/** Result of a datablock cleanup operation. */
export interface CleanupDatablocksResult {
  success: boolean;
  dryRun: boolean;
  totalRemoved: number;
  totalFound: number;
  removedByType: Record<string, number>;
  removed: Array<{ name: string; type: string }>;
  errors?: Array<{ name: string; type: string; reason: string }>;
}

// --- File Integrity ---

/** Types of external references that can be missing from a Blender file. */
export type MissingRefType = "image" | "font" | "library" | "sound";

/** A single missing external reference. */
export interface MissingReference {
  type: MissingRefType;
  name: string;
  expectedPath: string;
}

/** Result of a file integrity check. */
export interface FileIntegrityResult {
  success: boolean;
  filePath: string | null;
  fileSizeBytes: number | null;
  lastModified: string | null;
  hasUnsavedChanges: boolean;
  externalModificationDetected?: boolean;
  missingReferences: {
    total: number;
    byType: {
      images?: number;
      fonts?: number;
      libraries?: number;
      sounds?: number;
    };
    items: Array<{
      type: MissingRefType;
      name: string;
      expectedPath: string;
    }>;
  };
}

// --- Performance Metrics ---

/** Result of a performance metrics query. */
export interface PerformanceMetricsResult {
  success: boolean;
  memory: {
    usedMB: number;
    totalMB: number;
  };
  scene: {
    objectCount: number;
    polygonCount: number;
    vertexCount: number;
    materialCount: number;
  };
  gpuAvailable: boolean;
  gpu?: {
    deviceName: string;
    memoryUsageMB: number;
  };
}

// --- Render Statistics ---

/** Performance statistics from a completed render operation. */
export interface RenderStatistics {
  renderTimeSeconds: number;
  samples: number;
  peakMemoryMB: number;
  engineName: string;
  resolutionWidth: number;
  resolutionHeight: number;
  scenePolygonCount: number;
  gpuAvailable: boolean;
  gpuDeviceName?: string;
  gpuMemoryMB?: number;
}

// --- API Documentation Cache ---

/** A cached documentation entry. */
export interface DocCacheEntry {
  identifier: string;
  content: string;
  /** Unix timestamp in milliseconds when the entry was fetched. */
  fetchedAt: number;
  /** Blender version string (e.g. "5.1.0") associated with this entry. */
  blenderVersion: string;
}

/** Input parameters for the API lookup tool. */
export interface ApiLookupInput {
  /** Exact identifier for lookup (e.g. "bpy.types.Object"). */
  identifier?: string;
  /** Search query for token-based search. */
  query?: string;
}

/** Result of an API documentation lookup. */
export interface ApiLookupResult {
  success: boolean;
  source: "cache" | "upstream";
  results: Array<{
    identifier: string;
    content: string;
  }>;
}

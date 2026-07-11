/**
 * BlenderBridge type definitions.
 */

// --- Configuration ---

export interface BlenderBridgeConfig {
  blenderMcpHost: string; // default "127.0.0.1"
  blenderMcpPort: number; // default 9876, range 1-65535
  blenderMcpCommand: string; // default "blender-mcp"
  blenderMcpArgs: string[]; // default [], max combined 1024 chars
  threeDToolHost: string; // deprecated — retained for backward compatibility, unused
  healthCheckTimeoutMs: number; // default 5000
  operationTimeoutMs: number; // default 30000; timeout triggers at elapsed >= 30.0s
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

export interface BlenderExecutionResult {
  success: boolean;
  output?: string;
  error?: {
    traceback?: string;
    message: string;
    suggestion?: string;
  };
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

export interface ExportObjParams {
  outputPath: string;
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

export interface ExportToViewerSuccessResponse {
  success: true;
  filePath: string;
  viewerTriggered: boolean;
  message?: string;
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

import * as net from "net";
import { exec } from "child_process";
import { BlenderBridgeConfig, HealthCheckResult, HealthCheckSuccess } from "./types";

/**
 * Optional callback type for retrieving Blender info when both
 * addon connectivity and MCP server process checks pass.
 * Will be provided by the BlenderClient once it is implemented.
 */
export interface BlenderInfo {
  version: string;
  sceneName: string;
  isBlankProject: boolean;
}

export type GetBlenderInfoFn = () => Promise<BlenderInfo>;

/**
 * Attempts a raw TCP connection to the Blender add-on socket.
 * Returns true if the connection is accepted within the timeout,
 * false otherwise.
 */
export function checkAddonConnectivity(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(timeoutMs);

    socket.on("connect", () => {
      cleanup();
      resolve(true);
    });

    socket.on("timeout", () => {
      cleanup();
      resolve(false);
    });

    socket.on("error", () => {
      cleanup();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

/**
 * Detects whether the blender-mcp binary is available on PATH.
 * Uses `where` on Windows, `which` on other platforms.
 */
export function checkMcpServerProcess(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const checkCmd = isWindows ? `where ${command}` : `which ${command}`;

    exec(checkCmd, (error) => {
      resolve(!error);
    });
  });
}

/**
 * Orchestrates both health checks and returns a structured result.
 *
 * Priority logic:
 * - If addon TCP fails (regardless of MCP process), return BLENDER_ADDON_UNREACHABLE
 * - If addon TCP passes but MCP process not found, return BLENDER_MCP_NOT_INSTALLED
 * - If both pass, return success with Blender info (when available)
 */
export async function runHealthCheck(
  config: BlenderBridgeConfig,
  getBlenderInfo?: GetBlenderInfoFn,
): Promise<HealthCheckResult> {
  const addonReachable = await checkAddonConnectivity(
    config.blenderMcpHost,
    config.blenderMcpPort,
    config.healthCheckTimeoutMs,
  );

  const mcpAvailable = await checkMcpServerProcess(config.blenderMcpCommand);

  // Priority: if addon is unreachable, always report that first (Req 3.6)
  if (!addonReachable) {
    return {
      status: "error",
      error: {
        code: "BLENDER_ADDON_UNREACHABLE",
        message: `Cannot connect to Blender add-on on ${config.blenderMcpHost}:${config.blenderMcpPort}`,
        remediation:
          "Open Blender 5.1+, install the MCP add-on via drag-and-drop from the official release page, " +
          "and verify 'Listening on 127.0.0.1:9876' status in the N-panel MCP tab.",
      },
    };
  }

  // Addon reachable but MCP server binary not found
  if (!mcpAvailable) {
    return {
      status: "error",
      error: {
        code: "BLENDER_MCP_NOT_INSTALLED",
        message: `Blender MCP server binary '${config.blenderMcpCommand}' not found on PATH`,
        remediation:
          "Install the Blender MCP server via the .mcpb bundle or from source at " +
          "projects.blender.org/lab/blender_mcp.",
      },
    };
  }

  // Both checks passed — build success result
  const result: HealthCheckSuccess = {
    status: "ok",
    addonListening: true,
  };

  // If a BlenderInfo callback is provided, fetch version/scene details
  if (getBlenderInfo) {
    try {
      const info = await getBlenderInfo();
      result.blenderVersion = info.version;
      result.sceneName = info.sceneName;

      // Warn if the scene is not a blank project (Req 3.5)
      if (!info.isBlankProject) {
        result.blankProjectWarning =
          "Existing scene detected \u2014 LLM operations may produce unpredictable results";
      }
    } catch {
      // If we can't fetch info, still return success with addon confirmed
    }
  }

  return result;
}

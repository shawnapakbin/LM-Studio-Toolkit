import child_process from "child_process";
import fs from "fs";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { z } from "zod";
import { backupAndEditFile, getObjMetadata } from "./file-editor";
import { stateManager } from "./state";
import { startHttpServer } from "./index";

dotenv.config();

// __dirname = 3DTool/dist — repo root is two levels up.
// LM Studio spawns the process with its own CWD, so relative workspaceRoot
// values (e.g. ".") must be resolved against the repo root, not process.cwd().
const REPO_ROOT = path.resolve(__dirname, "../..");

// Scratch folder for all LLM-generated files. Created at startup if missing.
const TEMP_DIR = path.join(REPO_ROOT, "tmp");
fs.mkdirSync(TEMP_DIR, { recursive: true });

function resolveWorkspace(workspaceRoot: string): string {
  if (path.isAbsolute(workspaceRoot)) return workspaceRoot;
  return path.resolve(REPO_ROOT, workspaceRoot);
}

const server = new McpServer({
  name: "lm-studio-3d-tool",
  version: "1.0.0",
});

const launchViewerInputSchema: Record<string, z.ZodTypeAny> = {
  filePath: z
    .string()
    .describe(
      `Relative path to the OBJ file from workspaceRoot. ` +
      `LLM-generated files MUST be in the tmp/ subfolder, e.g. "tmp/model.obj".`,
    ),
  workspaceRoot: z
    .string()
    .describe(
      `Absolute path to the toolkit root. ALWAYS use this exact value: "${REPO_ROOT}". ` +
      `Never use ".", "./", or a relative path — they will not resolve correctly.`,
    ),
};

const registerTool = server.registerTool.bind(server) as unknown as (
  name: string,
  config: { description: string; inputSchema: unknown },
  handler: (input: unknown) => Promise<CallToolResult>,
) => void;

registerTool(
  "launch_viewer",
  {
    description:
      `Launch the 3D sandboxed viewer for a local OBJ model. ` +
      `IMPORTANT: LLM-generated models must first be written via edit_3d_file into the tmp/ folder (${TEMP_DIR}), ` +
      `then launched with filePath "tmp/<name>.obj" and workspaceRoot "${REPO_ROOT}". ` +
      `For complex or parametric geometry (fans, gears, curved surfaces), generate the OBJ file using the python_run_code tool ` +
      `(PythonShell) — write a Python script with math functions to compute vertex coordinates and faces, ` +
      `then write the file to "${TEMP_DIR}\\<name>.obj". Do NOT attempt to hand-author vertex coordinates directly ` +
      `in newContent; always use Python for anything beyond a simple box or plane.`,
    inputSchema: launchViewerInputSchema,
  },
  async (input): Promise<CallToolResult> => {
    const { filePath, workspaceRoot } = input as { filePath: string; workspaceRoot: string };

    stateManager.setFile(resolveWorkspace(workspaceRoot), filePath);

    // Open standard browser
    const url = "http://localhost:3344/viewer/index.html";
    const startCmd =
      process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
    child_process.exec(`${startCmd} ${url}`);

    return {
      isError: false,
      content: [{ type: "text", text: `Viewer launched for ${filePath} at ${url}` }],
    };
  },
);

registerTool(
  "poll_interactions",
  {
    description:
      "Poll the system event queue for any interactions the user made via the 3D viewer.",
    inputSchema: {},
  },
  async (): Promise<CallToolResult> => {
    const events = stateManager.pollInteractions();
    return {
      isError: false,
      content: [{ type: "text", text: JSON.stringify(events, null, 2) }],
    };
  },
);
const edit3dFileInputSchema: Record<string, z.ZodTypeAny> = {
  filePath: z
    .string()
    .describe(
      `Relative path from workspaceRoot for the file to create or overwrite. ` +
      `LLM-generated output files MUST go in the tmp/ subfolder: e.g. "tmp/fan.obj", "tmp/bracket.obj". ` +
      `Never write to the repo root directly.`,
    ),
  workspaceRoot: z
    .string()
    .describe(
      `Absolute path to the toolkit root. ALWAYS use this exact value: "${REPO_ROOT}". ` +
      `Never use ".", "./", or a relative path — they will not resolve correctly.`,
    ),
  newContent: z.string().describe("The complete text content of the OBJ file. Must be the full file — not a diff or partial update."),
};

registerTool(
  "edit_3d_file",
  {
    description:
      `Create or overwrite a 3D model file and trigger a live reload in the viewer. ` +
      `RULES: (1) All LLM-generated files MUST be saved to ${TEMP_DIR} — use filePath "tmp/<name>.obj". ` +
      `(2) workspaceRoot MUST be the absolute toolkit path: "${REPO_ROOT}". ` +
      `(3) newContent must be the complete OBJ file text. ` +
      `A timestamped backup is written to .history/ automatically. ` +
      `PYTHON WORKFLOW — preferred for any non-trivial geometry: ` +
      `Instead of hand-authoring newContent, use the python_run_code tool (PythonShell MCP) to run a Python script ` +
      `that computes vertices with math functions (import math) and writes the OBJ file directly to ` +
      `"${TEMP_DIR}\\<name>.obj". After the Python script succeeds, call launch_viewer with filePath "tmp/<name>.obj". ` +
      `Example pattern: (a) python_run_code writes the file, (b) launch_viewer loads it — skip edit_3d_file entirely ` +
      `when Python is doing the write. Only use newContent for very simple geometry (box, plane, < ~20 faces).`,
    inputSchema: edit3dFileInputSchema,
  },
  async (input): Promise<CallToolResult> => {
    const { filePath, workspaceRoot, newContent } = input as {
      filePath: string;
      workspaceRoot: string;
      newContent: string;
    };
    const result = backupAndEditFile(filePath, resolveWorkspace(workspaceRoot), newContent);

    if (!result.success) {
      return { isError: true, content: [{ type: "text", text: `Error: ${result.error}` }] };
    }
    return {
      isError: false,
      content: [
        {
          type: "text",
          text: `File updated successfully. Backup saved to ${result.backupPath || "none"}`,
        },
      ],
    };
  },
);

const getMetadataInputSchema: Record<string, z.ZodTypeAny> = {
  filePath: z
    .string()
    .describe(
      `Relative path to the OBJ file from workspaceRoot. ` +
      `LLM-generated files are in the tmp/ subfolder, e.g. "tmp/model.obj".`,
    ),
  workspaceRoot: z
    .string()
    .describe(
      `Absolute path to the toolkit root. ALWAYS use this exact value: "${REPO_ROOT}". ` +
      `Never use ".", "./", or a relative path.`,
    ),
};

registerTool(
  "get_model_metadata",
  {
    description:
      "Extract metadata from a 3D model (like OBJ format), including vertex count, face count, groups, and materials.",
    inputSchema: getMetadataInputSchema,
  },
  async (input): Promise<CallToolResult> => {
    const { filePath, workspaceRoot } = input as { filePath: string; workspaceRoot: string };
    const result = getObjMetadata(filePath, resolveWorkspace(workspaceRoot));

    if (!result.success) {
      return { isError: true, content: [{ type: "text", text: `Error: ${result.error}` }] };
    }
    return {
      isError: false,
      content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
    };
  },
);

async function main() {
  startHttpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("3DTool MCP Server running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

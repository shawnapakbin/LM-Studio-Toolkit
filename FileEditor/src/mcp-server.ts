// @ts-nocheck -- MCP SDK Zod type recursion causes OOM/TS2589 with many registerTool calls
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  deleteFile,
  listDirectory,
  moveFile,
  readFile,
  searchFiles,
  writeFile,
} from "./file-editor";
import {
  canDelete,
  getWorkspaceRoot,
  isAllowedExtensionForWrite,
  isBlockedPath,
  validateContentSafety,
  validatePath,
} from "./policy";

const server = new McpServer({
  name: "file-editor",
  version: "5.0.0",
});

const WORKSPACE_ROOT = getWorkspaceRoot();

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// read_file
server.registerTool(
  "read_file",
  {
    description:
      "Read file contents from the workspace, optionally limited to a start/end line range.",
    inputSchema: {
      path: z.string().min(1).describe("Workspace-relative file path to read"),
      startLine: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("1-indexed first line to read (inclusive)"),
      endLine: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("1-indexed last line to read (inclusive)"),
    },
  },
  async ({ path, startLine, endLine }): Promise<CallToolResult> => {
    try {
      const pathCheck = validatePath(path, WORKSPACE_ROOT);
      if (!pathCheck.valid) {
        throw new Error(pathCheck.error);
      }

      const blockedCheck = isBlockedPath(path);
      if (blockedCheck.blocked) {
        throw new Error(blockedCheck.reason);
      }

      const result = await readFile({ path, startLine, endLine }, WORKSPACE_ROOT);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `read_file failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// write_file
server.registerTool(
  "write_file",
  {
    description:
      "Write content to a workspace file. Supports overwrite/append modes and optional backups. Executable/binary extensions and unsafe content are blocked.",
    inputSchema: {
      path: z.string().min(1).describe("Workspace-relative file path to write"),
      content: z.string().describe("Content to write to the file"),
      createBackup: z
        .boolean()
        .optional()
        .describe("Create a timestamped backup of an existing file (default: false)"),
      mode: z
        .enum(["overwrite", "append"])
        .optional()
        .describe("Write mode: 'overwrite' (default) or 'append'"),
    },
  },
  async ({ path, content, createBackup, mode }): Promise<CallToolResult> => {
    try {
      const pathCheck = validatePath(path, WORKSPACE_ROOT);
      if (!pathCheck.valid) {
        throw new Error(pathCheck.error);
      }

      const blockedCheck = isBlockedPath(path);
      if (blockedCheck.blocked) {
        throw new Error(blockedCheck.reason);
      }

      const extCheck = isAllowedExtensionForWrite(path);
      if (!extCheck.allowed) {
        throw new Error(extCheck.reason);
      }

      const contentCheck = validateContentSafety(content);
      if (!contentCheck.safe) {
        throw new Error(contentCheck.reason);
      }

      const result = await writeFile({ path, content, createBackup, mode }, WORKSPACE_ROOT);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `write_file failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// search_files
server.registerTool(
  "search_files",
  {
    description:
      "Search for a text pattern across workspace files, with optional directory scope, extension filter, and result cap.",
    inputSchema: {
      pattern: z.string().min(1).describe("Text pattern to search for"),
      directory: z
        .string()
        .optional()
        .describe("Workspace-relative directory to search within (default: workspace root)"),
      fileExtensions: z
        .array(z.string())
        .optional()
        .describe("Limit search to these file extensions (e.g., ['.ts', '.js'])"),
      maxResults: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of results to return (default: 50)"),
      caseSensitive: z.boolean().optional().describe("Match case-sensitively (default: false)"),
    },
  },
  async ({
    pattern,
    directory,
    fileExtensions,
    maxResults,
    caseSensitive,
  }): Promise<CallToolResult> => {
    try {
      const result = await searchFiles(
        { pattern, directory, fileExtensions, maxResults, caseSensitive },
        WORKSPACE_ROOT,
      );
      const payload = { results: result, count: result.length };
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `search_files failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// list_directory
server.registerTool(
  "list_directory",
  {
    description:
      "List directory contents in the workspace, optionally recursively and including hidden entries.",
    inputSchema: {
      path: z.string().min(1).describe("Workspace-relative directory path to list"),
      recursive: z.boolean().optional().describe("Recurse into subdirectories (default: false)"),
      includeHidden: z
        .boolean()
        .optional()
        .describe("Include hidden files/directories (default: false)"),
    },
  },
  async ({ path, recursive, includeHidden }): Promise<CallToolResult> => {
    try {
      const pathCheck = validatePath(path, WORKSPACE_ROOT);
      if (!pathCheck.valid) {
        throw new Error(pathCheck.error);
      }

      const result = await listDirectory({ path, recursive, includeHidden }, WORKSPACE_ROOT);
      const payload = { files: result, count: result.length };
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `list_directory failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// delete_file
server.registerTool(
  "delete_file",
  {
    description:
      "Delete a workspace file with an optional backup. Protected project files (package.json, .env, etc.) cannot be deleted.",
    inputSchema: {
      path: z.string().min(1).describe("Workspace-relative file path to delete"),
      createBackup: z
        .boolean()
        .optional()
        .describe("Create a timestamped backup before deletion (default: true)"),
    },
  },
  async ({ path, createBackup }): Promise<CallToolResult> => {
    try {
      const pathCheck = validatePath(path, WORKSPACE_ROOT);
      if (!pathCheck.valid) {
        throw new Error(pathCheck.error);
      }

      const deleteCheck = canDelete(path);
      if (!deleteCheck.allowed) {
        throw new Error(deleteCheck.reason);
      }

      const result = await deleteFile({ path, createBackup }, WORKSPACE_ROOT);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `delete_file failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// move_file
server.registerTool(
  "move_file",
  {
    description:
      "Move or rename a workspace file. Fails if the destination exists unless overwrite is set.",
    inputSchema: {
      source: z.string().min(1).describe("Workspace-relative source file path"),
      destination: z.string().min(1).describe("Workspace-relative destination file path"),
      overwrite: z
        .boolean()
        .optional()
        .describe("Overwrite the destination if it exists (default: false)"),
    },
  },
  async ({ source, destination, overwrite }): Promise<CallToolResult> => {
    try {
      const sourceCheck = validatePath(source, WORKSPACE_ROOT);
      if (!sourceCheck.valid) {
        throw new Error(sourceCheck.error);
      }

      const destCheck = validatePath(destination, WORKSPACE_ROOT);
      if (!destCheck.valid) {
        throw new Error(destCheck.error);
      }

      const result = await moveFile({ source, destination, overwrite }, WORKSPACE_ROOT);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `move_file failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("FileEditor MCP server running on stdio");
}

main().catch((error) => {
  console.error("MCP server startup failed:", error);
  process.exit(1);
});

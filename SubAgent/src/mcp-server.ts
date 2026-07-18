/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { handleCancelDispatch } from "./tools/cancel-dispatch";
import { handleClearCache } from "./tools/clear-cache";
// Tool handler imports (implementations will be provided in later tasks)
import { handleDispatchSubTasks } from "./tools/dispatch-sub-tasks";
import { handleDryRunDispatch } from "./tools/dry-run-dispatch";
import { handleGetDispatchStatus } from "./tools/get-dispatch-status";
import { handleListSessions } from "./tools/list-sessions";
import { handleResumeDispatch } from "./tools/resume-dispatch";

// ─── Environment Variables ───────────────────────────────────────────────────

function parseEnvInt(name: string, defaultValue: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    console.error(
      `[SubAgent] WARNING: ${name}="${raw}" is invalid (must be integer ${min}–${max}). Using default: ${defaultValue}`,
    );
    return defaultValue;
  }
  return parsed;
}

function parseEnvDecimal(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed) || parsed < 0) return defaultValue;
  return parsed;
}

function parseEnvString(name: string, defaultValue: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return raw;
}

export interface ServerConfig {
  maxConcurrency: number;
  cachePath: string;
  checkpointDir: string;
  apiUrl: string;
  model: string;
  promptTokenCost: number;
  completionTokenCost: number;
}

export function loadConfig(): ServerConfig {
  return {
    maxConcurrency: parseEnvInt("SUBAGENT_MAX_CONCURRENCY", 1, 1, 10),
    cachePath: parseEnvString("SUBAGENT_CACHE_PATH", "./subagent-cache.db"),
    checkpointDir: parseEnvString("SUBAGENT_CHECKPOINT_DIR", "./.subagent-checkpoints/"),
    apiUrl: parseEnvString("SUBAGENT_API_URL", "http://localhost:1234/v1/chat/completions"),
    model: parseEnvString("SUBAGENT_MODEL", "default"),
    promptTokenCost: parseEnvDecimal("SUBAGENT_PROMPT_TOKEN_COST", 0),
    completionTokenCost: parseEnvDecimal("SUBAGENT_COMPLETION_TOKEN_COST", 0),
  };
}

// ─── Singleton Holders ───────────────────────────────────────────────────────
// These will be populated with real implementations as modules are built.
// For now they serve as typed placeholders.

export interface ServerContext {
  config: ServerConfig;
  // sessionPool: SessionPool;       — initialized once session-pool.ts is implemented
  // dedupCache: DedupCache;         — initialized once dedup-cache.ts is implemented
  // checkpointStore: CheckpointStore; — initialized once checkpoint-store.ts is implemented
  // sessionRegistry: SessionRegistry; — initialized once session-registry.ts is implemented
  // recursionGuard: RecursionGuard; — initialized once recursion-guard.ts is implemented
}

// ─── Zod Schemas for Tool Inputs ─────────────────────────────────────────────
// Exported for reuse in tool handlers and tests.

export const TaskDefinitionSchema = z.object({
  taskId: z.string().min(1).max(64).describe("Unique task identifier"),
  prompt: z.string().min(1).max(100_000).describe("Task prompt"),
  systemPrompt: z
    .string()
    .min(1)
    .max(100_000)
    .optional()
    .describe("Task-specific system prompt override"),
  allowedTools: z
    .array(z.string())
    .max(20)
    .optional()
    .describe("Tool names the sub-agent may invoke (max 20)"),
});

export const TaskManifestSchema = z.object({
  tasks: z.array(TaskDefinitionSchema).min(1).max(20).describe("Sub-tasks to dispatch (1–20)"),
  systemPrompt: z.string().min(1).max(100_000).optional().describe("Shared system prompt"),
  synthesisPrompt: z
    .string()
    .min(1)
    .max(100_000)
    .optional()
    .describe("Post-completion aggregation prompt"),
  mergePrompt: z.string().min(1).max(100_000).optional().describe("Chunk merge prompt"),
  temperature: z.number().min(0).max(2).optional().describe("Temperature (0.0–2.0, default 0.7)"),
  maxTokens: z
    .number()
    .int()
    .min(1)
    .max(32_768)
    .optional()
    .describe("Max tokens (1–32768, default 4096)"),
  modelContextSize: z
    .number()
    .int()
    .min(1024)
    .max(1_048_576)
    .optional()
    .describe("Model context window size (default 8192)"),
  concurrency: z.number().int().min(1).max(10).optional().describe("Concurrency override (1–10)"),
  maxRetries: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe("Max retries per task (0–10, default 3)"),
  skipCache: z.boolean().optional().describe("Bypass cache lookups (default false)"),
  cacheMaxAge: z
    .number()
    .int()
    .min(0)
    .max(31_536_000)
    .optional()
    .describe("Max cache age in seconds (default 86400)"),
  autoChunk: z.boolean().optional().describe("Auto-chunk oversized inputs (default false)"),
  keepCheckpoints: z
    .boolean()
    .optional()
    .describe("Preserve checkpoints after completion (default false)"),
  taskTimeout: z
    .number()
    .int()
    .min(60)
    .max(86_400)
    .optional()
    .describe("Per-task timeout in seconds (default 3600)"),
  dispatchTimeout: z
    .number()
    .int()
    .min(120)
    .max(172_800)
    .optional()
    .describe("Overall dispatch timeout in seconds (default 14400)"),
});

export const DispatchIdSchema = z.object({
  dispatchId: z.string().min(1).max(128).describe("Dispatch identifier"),
});

export const ClearCacheSchema = z.object({
  prefix: z.string().optional().describe("Input hash prefix to filter by"),
  olderThan: z.number().int().min(0).optional().describe("Age threshold in seconds"),
});

export const ListSessionsSchema = z.object({
  status: z.string().optional().describe("Filter by session status"),
  dispatchId: z.string().optional().describe("Filter by dispatch identifier"),
  hashPrefix: z.string().min(1).max(64).optional().describe("Filter by input hash prefix"),
});

// ─── MCP Server Creation ─────────────────────────────────────────────────────

export function createMcpServer(config: ServerConfig): McpServer {
  const server = new McpServer({
    name: "sub-agent",
    version: "2.3.1",
  });

  // Note: MCP SDK's ZodRawShapeCompat type is incompatible with refined Zod schemas
  // (.min/.max/.int on arrays/strings). We cast inputSchema to satisfy the type checker.
  // This is consistent with the 3DTool and BlenderBridge patterns in this workspace.

  // --- dispatch_sub_tasks ---
  server.registerTool(
    "dispatch_sub_tasks",
    {
      description:
        "Fan-out sub-tasks to parallel LLM sessions. Each task gets an isolated context window against LM Studio.",
      // biome-ignore lint/suspicious/noExplicitAny: MCP SDK inputSchema requires untyped shape
      inputSchema: TaskManifestSchema.shape as any,
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => handleDispatchSubTasks(args, config)) as any,
  );

  // --- cancel_dispatch ---
  server.registerTool(
    "cancel_dispatch",
    {
      description: "Abort an active dispatch operation and return partial results.",
      // biome-ignore lint/suspicious/noExplicitAny: MCP SDK inputSchema requires untyped shape
      inputSchema: DispatchIdSchema.shape as any,
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => handleCancelDispatch(args, config)) as any,
  );

  // --- resume_dispatch ---
  server.registerTool(
    "resume_dispatch",
    {
      description: "Resume a dispatch from checkpoint after crash or cancellation.",
      // biome-ignore lint/suspicious/noExplicitAny: MCP SDK inputSchema requires untyped shape
      inputSchema: DispatchIdSchema.shape as any,
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => handleResumeDispatch(args, config)) as any,
  );

  // --- get_dispatch_status ---
  server.registerTool(
    "get_dispatch_status",
    {
      description: "Poll progress of an active or recently completed dispatch.",
      // biome-ignore lint/suspicious/noExplicitAny: MCP SDK inputSchema requires untyped shape
      inputSchema: DispatchIdSchema.shape as any,
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => handleGetDispatchStatus(args, config)) as any,
  );

  // --- dry_run_dispatch ---
  server.registerTool(
    "dry_run_dispatch",
    {
      description:
        "Preview a dispatch without execution. Shows task count, token estimates, cache hits, and execution plan.",
      // biome-ignore lint/suspicious/noExplicitAny: MCP SDK inputSchema requires untyped shape
      inputSchema: TaskManifestSchema.shape as any,
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => handleDryRunDispatch(args, config)) as any,
  );

  // --- clear_cache ---
  server.registerTool(
    "clear_cache",
    {
      description:
        "Remove entries from the dedup/result cache. Optionally filter by hash prefix or age threshold.",
      // biome-ignore lint/suspicious/noExplicitAny: MCP SDK inputSchema requires untyped shape
      inputSchema: ClearCacheSchema.shape as any,
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => handleClearCache(args, config)) as any,
  );

  // --- list_sessions ---
  server.registerTool(
    "list_sessions",
    {
      description: "Query the session registry for dispatched sub-sessions with optional filters.",
      // biome-ignore lint/suspicious/noExplicitAny: MCP SDK inputSchema requires untyped shape
      inputSchema: ListSessionsSchema.shape as any,
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => handleListSessions(args, config)) as any,
  );

  return server;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadConfig();

  console.error("[SubAgent] Starting MCP server...");
  console.error(`[SubAgent] Config: concurrency=${config.maxConcurrency}, model=${config.model}`);
  console.error(`[SubAgent] API URL: ${config.apiUrl}`);
  console.error(`[SubAgent] Cache: ${config.cachePath}`);
  console.error(`[SubAgent] Checkpoints: ${config.checkpointDir}`);

  const server = createMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[SubAgent] MCP server running on stdio");
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((error) => {
    console.error("[SubAgent] MCP server startup failed:", error);
    process.exit(1);
  });
}

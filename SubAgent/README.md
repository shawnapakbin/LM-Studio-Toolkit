# SubAgent MCP Server

**Version**: 2.3.1  
**Status**: In Development  
**Branch**: `2.3.x`

A Model Context Protocol (MCP) server that enables fan-out/fan-in parallel inference by dispatching multiple independent sub-tasks to separate LLM chat sessions. The SubAgent tool addresses context window saturation by giving each sub-task a fresh, isolated context window against LM Studio's OpenAI-compatible API.

This pattern supports workloads like multi-module code review, parallel document analysis, and batch content generation — splitting work across isolated sessions so each sub-agent produces higher quality results than cramming everything into a single prompt.

## Quick Start

```bash
# Build
cd SubAgent
npm run build

# The server runs via MCP stdio transport (launched by your MCP client)
node dist/mcp-server.js
```

The server is registered in `.kiro/settings/mcp.json` under `"sub-agent"` and auto-available to LLM clients in this workspace.

## Architecture

### Source Structure

```
SubAgent/
├── src/
│   ├── mcp-server.ts          # Entry point, MCP registration, StdioServerTransport
│   ├── session-pool.ts        # Concurrency manager, FIFO queue, HTTP dispatch
│   ├── session-registry.ts    # Session-scoped in-memory registry, cross-dispatch dedup
│   ├── recursion-guard.ts     # Depth enforcement, tool filtering
│   ├── dedup-cache.ts         # SQLite-backed cache with LRU eviction
│   ├── checkpoint-store.ts    # JSON file persistence per task
│   ├── chunk-strategy.ts      # Input splitting along logical boundaries
│   ├── token-budget.ts        # Token estimation and budget validation
│   ├── telemetry.ts           # Per-session metrics, summary aggregation
│   ├── types.ts               # All shared interfaces and enums
│   └── tools/
│       ├── dispatch-sub-tasks.ts
│       ├── cancel-dispatch.ts
│       ├── resume-dispatch.ts
│       ├── get-dispatch-status.ts
│       ├── dry-run-dispatch.ts
│       ├── clear-cache.ts
│       └── list-sessions.ts
├── tests/
│   ├── unit/
│   ├── property/              # Property-based tests (fast-check)
│   └── integration/
├── package.json
├── tsconfig.json
├── jest.config.js
└── README.md
```

### Dispatch Lifecycle

When `dispatch_sub_tasks` is invoked, the server follows this lifecycle:

1. **Validation** — The incoming `TaskManifest` is validated (1–20 tasks, field bounds, unique task IDs, timeout ranges, concurrency range).
2. **Token Budget Check** — Each task's estimated input tokens are computed (`(systemPrompt + taskPrompt + toolDefs).length / 4`). Tasks exceeding 80% of `modelContextSize` are rejected (or auto-chunked if enabled).
3. **Deduplication Lookup** — For each task, the system computes a SHA-256 `Input_Hash` from canonical inputs, then checks in order:
   - **Session Registry** (in-memory, session-scoped) — returns result if a prior dispatch in this session already succeeded for this hash.
   - **Dedup Cache** (SQLite, persistent) — returns cached result if unexpired and `skipCache` is false.
   - **Intra-manifest dedup** — if multiple tasks in the same manifest share a hash, only the first is executed; others receive a copied result.
4. **Dispatch** — Uncached tasks enter a FIFO queue. The Session Pool dispatches up to `concurrency` tasks in parallel as HTTP POST requests to the LM Studio API. Each sub-session gets an isolated message history with its own system prompt and task prompt.
5. **Tool Call Loop** — If a sub-session requests tool calls, they are routed via `toolCallNormalizer` to target MCP servers, results fed back, and the LLM re-invoked (max 25 rounds). The `dispatch_sub_tasks` tool is always filtered out (recursion guard).
6. **Checkpointing** — As each task completes, its result is persisted to a JSON checkpoint file on disk, enabling crash recovery via `resume_dispatch`.
7. **Synthesis** — If a `synthesisPrompt` is provided, one final LLM call aggregates all successful sub-task results into a unified response.
8. **Result Assembly** — The `AggregatedResult` is returned with per-task status, telemetry, and metadata flags (`cached`, `deduplicated`, `registryHit`, `truncated`, etc.).

Retries use exponential backoff (2s, 4s, 8s) for transient errors (HTTP 429, 500–599, connection failures). Per-task and overall dispatch timeouts enforce bounded execution. Cancellation aborts in-flight requests and preserves completed results.

## MCP Tools (7)

| Tool | Description |
|------|-------------|
| `dispatch_sub_tasks` | Fan-out tasks to parallel LLM sessions with isolated contexts, optional synthesis, and full telemetry |
| `cancel_dispatch` | Abort an active dispatch — preserves completed results, marks pending tasks as cancelled |
| `resume_dispatch` | Resume from checkpoint after crash — validates hashes, re-dispatches only incomplete tasks |
| `get_dispatch_status` | Poll progress of an active dispatch — returns task counts, elapsed time, stall detection |
| `dry_run_dispatch` | Preview execution plan without inference — shows token estimates, cache hits, FIFO batching |
| `clear_cache` | Manage the dedup/result cache — clear all, by hash prefix, or by age threshold |
| `list_sessions` | Query the session registry — filter by status, dispatch ID, or hash prefix |

## Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SUBAGENT_MAX_CONCURRENCY` | int | `1` | Server-wide default concurrency limit (1–10) |
| `SUBAGENT_CACHE_PATH` | string | `./subagent-cache.db` | SQLite cache file path |
| `SUBAGENT_CHECKPOINT_DIR` | string | `./.subagent-checkpoints/` | Checkpoint directory for crash recovery |
| `SUBAGENT_PROMPT_TOKEN_COST` | decimal | `0` | Cost per prompt token (for telemetry cost estimation) |
| `SUBAGENT_COMPLETION_TOKEN_COST` | decimal | `0` | Cost per completion token (for telemetry cost estimation) |
| `SUBAGENT_API_URL` | string | `http://localhost:1234/v1/chat/completions` | LM Studio endpoint URL |
| `SUBAGENT_MODEL` | string | `default` | Model name sent in API requests |

## Usage Examples

### Example 1: Multi-file Code Review

**Invocation** (via MCP tool call):

```json
{
  "tool": "dispatch_sub_tasks",
  "arguments": {
    "tasks": [
      {
        "taskId": "review-auth",
        "prompt": "Review this authentication module for security issues:\n\n```typescript\n// ... auth.ts contents ...\n```",
        "systemPrompt": "You are a senior security engineer. Identify vulnerabilities, suggest fixes."
      },
      {
        "taskId": "review-db",
        "prompt": "Review this database layer for SQL injection and performance issues:\n\n```typescript\n// ... db.ts contents ...\n```"
      },
      {
        "taskId": "review-api",
        "prompt": "Review this API route handler for input validation issues:\n\n```typescript\n// ... routes.ts contents ...\n```"
      }
    ],
    "systemPrompt": "You are a code reviewer. Focus on bugs, security, and performance.",
    "synthesisPrompt": "Combine the individual code reviews into a unified report. Prioritize findings by severity (critical > high > medium > low). Include an executive summary.",
    "temperature": 0.3,
    "concurrency": 2
  }
}
```

**Response**:

```json
{
  "dispatchId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "completed",
  "tasks": [
    {
      "taskId": "review-auth",
      "sessionId": "11111111-2222-3333-4444-555555555555",
      "status": "success",
      "response": "## Auth Module Review\n\n### Critical: JWT secret hardcoded...",
      "telemetry": {
        "promptTokens": 1250,
        "completionTokens": 890,
        "totalTokens": 2140,
        "wallClockMs": 4200,
        "tokensPerSecond": 211.9
      }
    },
    {
      "taskId": "review-db",
      "sessionId": "22222222-3333-4444-5555-666666666666",
      "status": "success",
      "response": "## Database Layer Review\n\n### High: Unparameterized queries...",
      "telemetry": { "promptTokens": 980, "completionTokens": 720, "totalTokens": 1700, "wallClockMs": 3500, "tokensPerSecond": 205.7 }
    },
    {
      "taskId": "review-api",
      "sessionId": "33333333-4444-5555-6666-777777777777",
      "status": "success",
      "response": "## API Routes Review\n\n### Medium: Missing rate limiting...",
      "telemetry": { "promptTokens": 1100, "completionTokens": 650, "totalTokens": 1750, "wallClockMs": 3100, "tokensPerSecond": 209.7 }
    }
  ],
  "synthesis": {
    "status": "success",
    "response": "# Unified Code Review Report\n\n## Executive Summary\n3 modules reviewed, 1 critical finding..."
  },
  "telemetrySummary": {
    "totalPromptTokens": 3330,
    "totalCompletionTokens": 2260,
    "totalWallClockMs": 10800,
    "meanTokensPerSecond": 209.1,
    "slowestTask": { "taskId": "review-auth", "durationMs": 4200 },
    "fastestTask": { "taskId": "review-api", "durationMs": 3100 }
  }
}
```

### Example 2: Dry Run Preview

**Invocation**:

```json
{
  "tool": "dry_run_dispatch",
  "arguments": {
    "tasks": [
      { "taskId": "summarize-ch1", "prompt": "Summarize chapter 1: ..." },
      { "taskId": "summarize-ch2", "prompt": "Summarize chapter 2: ..." },
      { "taskId": "summarize-ch3", "prompt": "Summarize chapter 3: ..." }
    ],
    "systemPrompt": "Summarize the given text in 3 bullet points.",
    "concurrency": 2,
    "modelContextSize": 8192
  }
}
```

**Response**:

```json
{
  "taskCount": 3,
  "uniqueTasks": 3,
  "duplicateTasks": 0,
  "perTaskEstimates": [
    { "taskId": "summarize-ch1", "estimatedTokens": 1420, "exceedsBudget": false, "cached": false },
    { "taskId": "summarize-ch2", "estimatedTokens": 1380, "exceedsBudget": false, "cached": true },
    { "taskId": "summarize-ch3", "estimatedTokens": 1510, "exceedsBudget": false, "cached": false }
  ],
  "totalEstimatedTokens": 4310,
  "budgetLimit": 6553,
  "executionPlan": {
    "concurrency": 2,
    "batches": [
      { "batch": 0, "tasks": ["summarize-ch1", "summarize-ch3"] },
      { "batch": 1, "tasks": [] }
    ],
    "tasksToExecute": 2,
    "tasksFromCache": 1
  },
  "estimatedWallClockMs": 7200,
  "estimation_available": true
}
```

## Key Features

### Session Isolation
Each sub-task executes in a completely isolated context — independent message arrays, token counters, and tool call results. One sub-task's failure or context never contaminates another.

### Recursion Prevention
A hard depth limit of 1 prevents sub-agents from spawning their own sub-agents. The recursion guard filters `dispatch_sub_tasks` from all sub-session tool definitions and enforces the limit at the application layer.

### Result Caching & Deduplication
Results are cached in SQLite with LRU eviction (max 10,000 entries). Duplicate tasks within the same manifest are detected by SHA-256 hash and only executed once. The session registry enables cross-dispatch deduplication within the same server session.

### Crash Recovery
Checkpoints are written to disk as each task completes. After a crash, `resume_dispatch` reloads the manifest, validates checkpoint integrity, and re-dispatches only incomplete tasks.

### Telemetry
Per-session metrics include prompt/completion tokens, wall-clock time, and inference speed. Dispatch summaries aggregate totals and identify slowest/fastest tasks. Cost estimation uses configurable per-token rates.

### Auto-Chunking
Tasks exceeding the token budget can be automatically split along logical boundaries (paragraphs > headers > newlines > words), dispatched as separate sub-sessions, and merged back into a single result.

## Development

```bash
npm run build      # Compile TypeScript to dist/
npm run dev        # Watch mode compilation
npm run test       # Run unit + property + integration tests
npm run clean      # Remove compiled output
```

## Testing

Tests use Jest with fast-check for property-based testing:

- **Unit tests**: Input validation, edge cases, environment variable handling
- **Property tests**: Session isolation, dedup correctness, cache invariants, concurrency limits, retry policy, timeout enforcement, checkpoint round-trips
- **Integration tests**: End-to-end dispatch with mocked LM Studio API, tool call routing, checkpoint I/O

```bash
npm run test
```

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework (stdio transport)
- `zod` — Input validation schemas
- `better-sqlite3` — SQLite driver for dedup cache

## License

Non-Commercial License — See root LICENSE file.

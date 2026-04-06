# LLM Toolkit — Architecture Guide

## System Overview

**LLM Toolkit** is an enterprise-grade agent framework designed to orchestrate multiple specialized tools for software engineering tasks. The system is built on three pillars:

1. **Tool Isolation** — Each tool (Terminal, WebBrowser, Calculator, etc.) runs independently with strict contracts
2. **Memory Persistence** — SQLite-backed task history, solution patterns, and learned rules for intelligent decision-making
3. **Dual Server Architecture** — Both HTTP (Express) and MCP (Model Context Protocol) interfaces for maximum integration flexibility

---

## Core Patterns


### 1. Tool Contract Pattern & Normalization Layer

Every tool follows a standardized input/output contract. All tool calls—regardless of origin (HTTP, MCP, or workflow runner)—are normalized to a canonical schema before execution using a shared normalization utility (`shared/toolCallNormalizer.ts`). This ensures compatibility with both legacy and new tool call formats, reduces integration bugs, and enables robust multi-model orchestration. The normalization is enforced in both the MCP server and workflow runner.

**Input**: Zod-validated parameters (type-safe, documented)

```typescript
const schema = z.object({
  command: z.string().min(1),
  timeoutMs: z.number().positive().optional(),
});
// All tool calls are normalized before dispatch:
import { normalizeToolCall } from "../shared/toolCallNormalizer";
const canonicalCall = normalizeToolCall(rawInput, { taskRunId });
```

**Output**: Standardized response envelope (consistency across all tools)
```typescript
{
  success: boolean,
  data?: T,
  error?: { code: ErrorCode, message: string, details?: {} },
  timing: { durationMs: number, startTime: string },
  traceId: string  // For observability + memory linking
}
```

### 2. Dual Server Pattern

Each tool exposes both interfaces:

- **HTTP Server (Express)**
  - `GET /health` — Liveness check
  - `GET /tool-schema` — Tool contract (for clients)
  - `POST /tools/{tool_name}` — Tool invocation

- **MCP Server (Stdio)**
  - Registers tools with McpServer
  - Same handler logic as HTTP (no duplication)
  - Used by LM Studio, Claude, other MCP clients

### 3. Hardening Pattern

Safety-first approach:

- **Deny Patterns** — Explicit denylists for dangerous operations (Terminal: `rm -rf`, WebBrowser: `localhost`)
- **Sandbox** — Restrict resource access (Terminal: cwd to workspace, WebBrowser: block private IPs)
- **Truncation** — Limit output size to prevent token overflow (Terminal: 50KB stdout limit)
- **Error Codes** — Standardized error reporting (`INVALID_INPUT`, `TIMEOUT`, `POLICY_BLOCKED`, `EXECUTION_FAILED`)

### 4. Agent Loop Pattern

Orchestrator drives multi-step tasks:

```
1. Plan: Break prompt into tool calls (use Claude)
2. Execute: Run tools sequentially with retries
3. Memory: Look for similar past solutions (reuse patterns)
4. Observe: Log decisions, failures, outcomes
5. Learn: Update rules, record successful patterns
```

### 5. Memory Persistence Pattern

SQLite tables capture agent intelligence:

- **task_runs** — History of all agent executions
- **tool_calls** — Audit trail of every tool invocation
- **solution_patterns** — Reusable successful task traces (avoid re-planning)
- **learned_rules** — SSRF blocks, command denylists, constraints
- **agent_decisions** — Rationale for tool selections (explainability)
- **failed_attempts** — What didn't work (backtracking + learning)

---

## Tool Inventory

| Tool | Purpose | Port | Status |
|------|---------|------|--------|
| **Terminal** | Execute shell commands (OS-aware) | 3333 | ✅ Working |
| **WebBrowser** | Full headless Chromium browser — JS rendering, SPAs, cookies, screenshots, markdown output (v2.1.0) | 3334 | ✅ Working |
| **Calculator** | Math expressions (engineering notation) | 3335 | ✅ Working |
| **DocumentScraper** | Read documents with structured extraction + encrypted PDF detection | 3336 | ✅ Working |
| **AskUser** | Interactive interview and clarification workflows | 3338 | ✅ Working |
| **Clock** | Current date/time + timezone | 3337 | ✅ Working |
| **Browserless** | Advanced browser automation (screenshots, PDFs, scraping, content extraction, BrowserQL, Puppeteer code, downloads, export, Lighthouse audits) | 3003 | ✅ Working |
| **RAG** | Persistent retrieval augmented generation with source lifecycle + approval-gated writes | 3339 | ✅ Working |
| **Skills** | Persistent skill/playbook system — define parameterized step templates, execute by name (v2.1.0) | 3341 | ✅ Working |
| **ECM** | Extended Context Memory — 1M token context via vector retrieval, session isolation, extractive summarization (v2.1.0) | 3342 | ✅ Working |
| **CSVExporter** | Export parsed table data to CSV files | 3340 | ✅ Working |
| **Git** | Safe git operations with branch protection | 3011 | ✅ Working |
| **FileEditor** | Safe file read/write/search with workspace sandboxing | TBD | ✅ Working |
| **PackageManager** | Multi-ecosystem package management (npm/pip/cargo/maven/go) | TBD | ✅ Working |
| **Observability** | Structured logging, metrics, tracing library | N/A | ✅ Working |
| **BuildRunner** (Phase 2) | Compile, test, lint | TBD | 🔄 Planned |
| **AIModel** (Phase 2) | In-agent Claude/OpenAI calls | TBD | 🔄 Planned |
| **Orchestrator** (Phase 3) | Master agent runner | N/A | 🔄 Planned |

---

## v2.1.0 Additions: CLI and Slash Commands

### CLI Workspace (`CLI/`)

The `CLI/` workspace provides a `llm <command>` binary for invoking all tools directly from the terminal. It uses `commander` for argument parsing and routes requests to tool HTTP endpoints (ports 3330–3342).

**Install & build:**
```bash
npm install
npm run build:cli
# Optional: link globally
npm link --workspace=CLI
```

**Command groups:**

| Group | Commands |
|---|---|
| `llm tools` | `list`, `health`, `schema <tool>` |
| `llm calc` | `"<expr>"` with optional `--precision` |
| `llm browse` | `<url>` with `--format`, `--screenshot`, `--wait-selector` |
| `llm clock` | current time with `--timezone`, `--format` |
| `llm terminal` / `llm run` | `"<cmd>"` with `--cwd`, `--timeout` |
| `llm skills` | `list`, `get`, `run`, `define`, `delete` |
| `llm memory` | `stats`, `history`, `patterns`, `clear` |
| `llm ecm` | `store`, `retrieve`, `list`, `delete`, `summarize`, `clear`, `compact` |
| `llm rag` | `query`, `ingest`, `list`, `delete` |
| `llm ask` | `"<prompt>"` with `--title`, `--expires` |
| `llm workflow` | `run <file.json>` with `--session`, `--auto-approve`, `--timeout` |
| `llm config` | `show`, `set <key> <value>` |
| `llm compact` | top-level shortcut for ECM context compaction |

The CLI is intended for scripting and automation. See [`CLI/README.md`](../CLI/README.md) for the full command reference.

### SlashCommands Workspace (`SlashCommands/`)

The `SlashCommands/` workspace is an MCP server that exposes a single `slash_command` tool. When the user types `/command` in LM Studio chat, the LLM calls this tool automatically — no system prompt injection required.

**Architecture:**
- `parser.ts` — tokenizer + flag extractor; handles quoted strings and `--flag <value>` / `--flag` boolean syntax
- `router.ts` — maps parsed `DispatchDescriptor` to tool HTTP endpoints; `/compact` runs a two-step ECM summarize + list; `/tools health` runs parallel health checks
- `mcp-server.ts` — registers the `slash_command` tool with the full command reference in its description

**Handled commands:**

| Command | Routes to |
|---|---|
| `/compact` | ECM `summarize_session` → `list_segments` (reports remaining count) |
| `/ecm store\|retrieve\|list\|summarize\|clear` | ECM tool (port 3342) |
| `/calc <expr>` | Calculator tool (port 3335) |
| `/browse <url>` | WebBrowser tool (port 3334) |
| `/clock` | Clock tool (port 3337) |
| `/run <cmd>` | Terminal tool (port 3333) |
| `/skills list\|run\|get` | Skills tool (port 3341) |
| `/rag query\|ingest\|list` | RAG tool (port 3339) |
| `/ask <prompt>` | AskUser tool (port 3338) |
| `/tools list\|health\|schema` | All tool endpoints |
| `/memory stats\|history\|patterns` | AgentRunner SQLite (direct query) |
| `/config show` | CLI config |
| `/workflow run <file>` | AgentRunner (port 3330) |

**Setup:**
```json
"slash-commands": {
  "command": "node",
  "args": ["SlashCommands/dist/mcp-server.js"]
}
```

Run `npm run build:slash` to build. See [`docs/SLASH-COMMANDS.md`](SLASH-COMMANDS.md) for the full command reference.

---

## Code Quality Standards

### Test Coverage
- **Minimum**: 80% statement coverage per tool
- **Terminal**: 85% (critical safety)
- **Calculator**: 90% (deterministic)
- **Browserless**: 70% (external API dependency)

### Type Safety
- **Strict TypeScript**: All tools use `strict: true`
- **No `any` types**: Use `unknown` with type guards
- **JSDoc required**: All exported functions documented

### Code Style
- **Biome**: Unified formatting + linting (1-sec CI runs)
- **No manual review needed**: Biome fixes auto-apply

### Performance SLAs
- **Terminal**: < 10 seconds (default timeout)
- **WebBrowser**: < 20 seconds (network latency)
- **Calculator**: < 1 second
- **Clock**: < 100 milliseconds
- **Browserless**: < 30 seconds

---

## Security Model

### Threat: Arbitrary Command Execution

**Mitigation**: Command allowlist/denylist (Terminal)
```typescript
const DENY_PATTERNS = [
  /rm -rf/,
  /format /,
  /mkfs/,
  /ssh.*-p\d+/      // Network exfil
];
```

**Acceptance**: Unsafe commands blocked with `POLICY_BLOCKED` error code + audit metadata

### Threat: SSRF (Server-Side Request Forgery)

**Mitigation**: Private IP blocking (WebBrowser)
```typescript
const BLOCKED = [
  /localhost|127\.0\.0\.1/,
  /10\.\d+\.\d+\.\d+/,
  /192\.168\.\d+\.\d+/,
  /172\.(16-31)\.\d+\.\d+/
];
```

**Acceptance**: Private URLs fail fast with clear SSRF error code

### Threat: Unbounded Resource Use

**Mitigation**: Timeouts + concurrency limits
- Terminal: 120 second max timeout
- WebBrowser: 60 second max timeout
- Browserless: 5 concurrent requests (configurable, queue beyond), strict timeout enforcement on all handlers

---

## Deployment Targets

### LM Studio (MCP Protocol)
```json
{
  "mcpServers": {
    "llm-toolkit": {
      "command": "node",
      "args": ["dist/lm-studio-runner.js"]
    }
  }
}
```

### VS Code Extension (Copilot Chat integration)
- Right-click context: "Fix with Agent", "Generate Tests"
- Inline suggestions + code actions

### CLI Agent
```bash
npx llm-engineer --task "fix the failing test in src/math.test.ts"
```

### HTTP API Gateway
```bash
curl -X POST http://localhost:3000/api/v1/execute-task \
  -d '{"prompt": "...", "sessionId": "..."}'
```

---

## Development Workflow

### 1. Add a New Tool

```bash
mkdir MyTool
cp -r Terminal/. MyTool/
# Edit MyTool/src/index.ts (HTTP handler)
# Edit MyTool/src/mcp-server.ts (MCP registration)
# Create MyTool/tests/ (85%+ coverage required)
npm install -w MyTool
npm run build
npm test
```

### 2. Hardening Review (Phase 1)

Before shipping a tool, verify:
- ✅ No `POLICY_BLOCKED` FPs (false denials on legitimate commands)
- ✅ All hardening tests pass
- ✅ Performance SLA met
- ✅ Error codes consistent with other tools

### 3. Memory Integration

If tool creates side effects or makes decisions:
```typescript
await memory.recordToolCall(taskRunId, toolName, input, output, success);
await memory.recordDecision(taskRunId, step, "chose tool X because...", alternatives);
```

---

## Key Files

| File | Purpose |
|------|---------|
| `biome.json` | Code format + linting config |
| `jest.config.ts` | Test harness (80% coverage gates) |
| `tsconfig.json` | TypeScript strict mode |
| `.github/workflows/ci.yml` | CI gates (Biome + Jest + type-check + build) |
| `Memory/src/index.ts` | SQLite persistence layer |
| `testing/test-utils.ts` | Shared test helpers |
| `testing/responses.ts` | Standard response envelope |
| `docs/CODE-QUALITY.md` | Detailed quality standards |
| `docs/MEMORY-PATTERNS.md` | Memory query patterns |
| `docs/SLASH-COMMANDS.md` | Slash command reference (v2.1.0) |
| `CLI/README.md` | CLI command reference (v2.1.0) |
| `CONTRIBUTING.md` | PR workflow + checklist |

---

**Last Updated**: April 2026  
**Version**: 2.1.0

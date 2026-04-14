# Robust Coding Agent Roadmap (Phase 1 → Phase 3)

This plan is tailored to the current LLM Toolkit workspace:
- Terminal
- WebBrowser (headless Chromium)
- Calculator
- Clock
- Browserless
- AskUser
- RAG
- PythonShell
- Skills
- ECM
- CSVExporter
- Git
- FileEditor
- PackageManager
- Observability
- CLI (`llm` binary)
- SlashCommands (MCP `/command` shortcuts)

## Success Criteria
- Agent can reliably plan, execute, validate, and recover.
- Tool calls are safe by default.
- Every run is observable and debuggable.
- New tools can be added without breaking existing MCP setup.

---

## Phase 1 — Foundation + Safety ✅ COMPLETE

### 1) Unified Tool Contracts ✅
- [x] Standardize tool response envelope for all tools:
  - `success`, `errorCode`, `errorMessage`, `data`, `timingMs`, `traceId`
- [x] Add consistent input validation errors (`INVALID_INPUT`, `TIMEOUT`, `POLICY_BLOCKED`, `EXECUTION_FAILED`)
- [x] Ensure MCP and HTTP return equivalent payload semantics

**Acceptance**: Same request gets equivalent structure from HTTP and MCP paths.

### 2) Terminal Hardening ✅
- [x] Add command allowlist mode (default on)
- [x] Add deny patterns for destructive commands (format/del/rm -rf/network exfil)
- [x] Restrict `cwd` to workspace subtree (no parent traversal)
- [x] Add max stdout/stderr truncation with explicit truncation markers

**Acceptance**: Unsafe commands are blocked with `POLICY_BLOCKED` and audit metadata.

### 3) WebBrowser Hardening ✅
- [x] Enforce URL allow/deny policy (block localhost/private ranges by default)
- [x] Add content-type checks and max download bytes guard
- [x] Add redirect limit and protocol restrictions (`http/https` only)
- [x] Add explicit SSRF error codes

**Acceptance**: Disallowed/internal URLs fail fast and never fetch content.

### 4) Calculator Reliability ✅
- [x] Keep symbol normalization map versioned and test-covered
- [x] Add clearer unit mismatch hints in error payload
- [x] Add deterministic formatting options (`fixed`, `scientific`, `auto`)

**Acceptance**: `sin(30°)`, `sin(π/6)`, superscripts, and engineering prefixes pass consistently.

### 5) Browserless Hardening ✅
- [x] Add API key validation and rotation support in environment
- [x] Add concurrency limiting to prevent quota exhaustion (default: 5 concurrent requests)
- [x] Add region failover logic for multi-region deployment
- [x] Add CAPTCHA solve failure handling and fallback strategies
- [x] Add screenshot/PDF timeout guards for large pages

**Acceptance**: Concurrent requests queue when limit reached vs. failing immediately.

---

## Phase 2 — Orchestration + Workflow Execution ✅ COMPLETE

### 6) Agent Runner (Local) ✅
- [x] Create a lightweight orchestrator service that can:
  - select tool
  - call tool
  - validate output
  - retry with fallback policy
- [x] Add step graph execution (sequential + limited parallel)
- [x] Add per-step timeout and cancellation propagation

**Acceptance**: Multi-step tasks complete with retries and partial-failure handling.

### 7) Task Planning + Memory ✅
- [x] Add short-lived run memory (context for one session)
- [x] Add persistent run history store (SQLite)
- [x] Add retrieval of prior successful tool patterns

**Acceptance**: Agent can reuse prior solution traces for similar prompts.

### 8) Tool Registry ✅
- [x] Central registry of tools and capabilities (`read`, `execute`, `compute`)
- [x] Health checker that validates all MCP entrypoints exist before session start
- [x] Version each tool schema and surface compatibility warnings

**Acceptance**: Broken tool paths are detected before user chat execution.

---

## Phase 3 — Observability + Eval + Operations ✅ COMPLETE

### 9) Observability ✅
- [x] Add structured logs across all tools (`traceId`, `toolName`, `durationMs`, `status`)
  - Created Logger class with ConsoleTransport, JSONTransport, FileTransport
  - Implemented child logger creation for tool-specific context
- [x] Add local metrics export (JSON or Prometheus text format)
  - Created MetricsRegistry with Counter, Histogram, and Gauge support
  - Each tool registers execution metrics with labels (status, errorCode)
  - Implemented Prometheus-compatible export format
- [x] Add run-level trace timeline (plan → tool calls → output)
  - Created Tracer class with workflow and span tracking
  - Timeline export with millisecond precision
  - Parent-child span relationships for multi-step workflows
- [x] Integrate observability into AgentRunner
  - Workflow execution creates root trace with step spans
  - Step metrics and logs with correlation IDs
  - Duration histograms and error tracking
- [x] Add metrics tracking to Terminal and Calculator tools
  - execution_total counter with status/error labels
  - duration_ms histogram for performance analysis
  - Metrics recorded at both success and failure paths

**Acceptance**: Each agent run is fully observable with logs, metrics, and distributed traces. 187 tests passing.

### 10) Evaluation Harness (Phase 4) ✅
- [x] Build regression suite of coding-agent tasks:
  - file edit task
  - shell build task
  - web retrieval + summarize task
  - math/engineering compute task
- [x] Track pass rate, retries, and failure categories
- [x] Add "golden traces" for stable benchmark runs

**Acceptance**: `npm run eval:run` writes evaluation results + golden traces and fails the gate if baseline thresholds are violated.

### 11) Workspace Operations ✅
- [x] Add root task(s) to build/test all tools together
- [x] Add startup script to verify MCP binaries + env before LM Studio use
- [x] Keep top-level `mcp.json` block synchronized when tools are added

**Acceptance**: One command validates readiness of Terminal, WebBrowser, Calculator, Clock, Browserless.

---

## Immediate Next 15 Tasks (Execution Order)
1. Add CI cache optimization for workspace builds/tests.
2. Add root `verify:all` script that chains `check:ci`, `type-check`, `test:ci`, `startup:check:strict`, and `eval:run`.
3. Add branch protection guidance for required status checks in repository settings.
4. Add pre-push hook option (documented) for local readiness and regression gates.
5. Expand evaluation dataset with negative-path scenarios per tool.
6. Add deterministic seed support for evaluation trace generation.
7. Add baseline drift report that compares current run vs baseline deltas.
8. Add Browserless env preflight checks for region/timeouts/concurrency bounds.
9. Add read-only smoke tests for all MCP server entrypoints (`tool-schema`, `health`).
10. Add integration test that validates `verify:mcp-sync` against README updates.
11. Add CI artifact upload for evaluation results and golden traces.
12. Add metrics export endpoint smoke test for observability module.
13. Add documented release checklist covering build, eval, and startup readiness.
14. Add monthly dependency audit task to keep workspace packages current.
15. Plan Phase 4 launchers implementation (LM Studio + CLI + VS Code + HTTP) using current gates.

> **v2.2.0 status**: Extended toolset (Git/FileEditor/PackageManager/CSVExporter/PythonShell/Observability integrations) is in the shipped baseline with verify/build gates.

---

## MCP Governance Rule
Whenever a new tool is added:
1. Add the tool folder and MCP server.
2. Build and verify `dist/mcp-server.js` exists.
3. Update main README `mcp.json` block (including environment variables).
4. Add tool-specific hardening section in Phase 1 (policy, timeout, quota controls).
5. Add tool-specific regression tests in Phase 3 evaluation suite.
6. Run `verify-tools` before using LM Studio.

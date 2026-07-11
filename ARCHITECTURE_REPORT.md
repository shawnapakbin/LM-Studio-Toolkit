# LLM-Toolkit — Architecture Report (via Graphify)

**Generated:** July 10, 2026  
**Graph Stats:** 3,860 nodes | 6,447 edges | 281 communities | 84% extracted / 16% inferred / 0% ambiguous

---

## 1. Project Overview

LLM-Toolkit is a modular, multi-service platform for orchestrating LLM-powered workflows with MCP (Model Context Protocol) tool servers. It provides a suite of specialized services, an agent runner for workflow execution, observability infrastructure, and a desktop installer with a React-based UI.

---

## 2. Core Modules & Responsibilities

| Module | Role | Key Entities |
|--------|------|--------------|
| **AgentRunner** | Workflow orchestration engine with step execution, retry logic, parallel/sequential execution, session management, and approval flows | `AgentRunner`, `ToolRegistry`, `MemoryStore` |
| **BlenderBridge** | MCP bridge to Blender 3D — translates tool calls into Python code executed via TCP socket to the Blender add-on | `createBlenderBridgeMcpServer()`, `generateCodeForTool()`, 31 tools |
| **AskUser** | Human-in-the-loop interview system — creates question sets, collects responses with expiry | `AskUserStore`, `handleAskUserRequest()`, policy validators |
| **RAG** | Retrieval-Augmented Generation — document ingestion, embedding, chunking, vector search | `RAGService`, `RAGStore`, `EmbeddingProvider` |
| **Skills** | Skill definition and execution engine — stores reusable multi-step workflows with parameter interpolation | `SkillsStore`, `defineSkill()`, `executeSkill()` |
| **Memory** | Persistent task memory — records tool calls, patterns, decisions, and failures for learning | `MemoryStore` |
| **Observability** | Logging, metrics (Counter/Histogram/Gauge), and distributed tracing | `MetricsRegistry`, `Tracer`, `Logger` |
| **SlashCommands** | Command router and dispatch for slash-command style interactions | `route()`, `dispatch()` |
| **WebBrowser** | Browser automation MCP server (Playwright-based) | `main()`, MCP server |
| **Terminal** | Terminal interaction MCP server | MCP server |
| **Calculator** | Math operations MCP server | MCP server |
| **Clock** | Time/date utilities MCP server | MCP server |
| **Git** | Git operations MCP server | MCP server |
| **PythonShell** | Python environment detection and execution | `detectPythonEnvironment()`, MCP server |
| **PackageManager** | Package management MCP server with rate limiting | MCP server, `checkRateLimit()` |
| **DocumentScraper** | Document fetching/scraping service | MCP server |
| **Installer** | Tauri-based desktop installer with React renderer | `ToolCard`, `Panel`, build pipeline |
| **shared** | Cross-module utilities — response builders, types, timer, tool call normalizer | `createSuccessResponse()`, `createErrorResponse()`, `OperationTimer`, `normalizeToolCall()` |

---

## 3. Architectural Patterns

- **MCP-first design**: Every service exposes tools via the Model Context Protocol (stdio transport). Each has a `mcp-server.ts` entry point using `@modelcontextprotocol/sdk`.
- **Passthrough + Orchestration**: BlenderBridge uses a dual pattern — 5 orchestration tools (codegen + execute) and 26 passthrough tools (direct forwarding to upstream).
- **Policy-driven validation**: Each service has a `policy.ts` that validates inputs before any side effects. Validators return error strings or null.
- **Store pattern**: Persistent state uses SQLite via a `Store` class with schema initialization.
- **Shared types**: A `shared/` module provides common response wrappers, trace IDs, and timing utilities across all services.

---

## 4. God Nodes (Most Connected Components)

These are the highest-connectivity nodes — the architectural pivots that everything depends on:

| Rank | Node | Edges | Location |
|------|------|-------|----------|
| 1 | `get()` | 89 | SlashCommands dispatch |
| 2 | `backend_wayland` | 75 | Blender MCP test infrastructure |
| 3 | `_synthetic_corpus()` | 56 | Blender MCP RST search tests |
| 4 | `_search()` | 56 | Blender MCP RST doc search |
| 5 | `_TestServerMixin` | 53 | Blender MCP test mixin |
| 6 | `main()` | 42 | Multiple MCP server entry points |
| 7 | `run()` | 38 | Scripts + test utilities |
| 8 | `createErrorResponse()` | 30 | Shared error builder |
| 9 | `CaptureOutput` | 29 | Blender add-on output capture |
| 10 | `WeakSandboxForLLM` | 29 | Blender add-on sandboxing |

**Observation:** The Blender MCP codebase (under `Manifesto/blender_mcp-main`) dominates the top connectivity due to its extensive test infrastructure and cross-cutting RST documentation corpus. The actual toolkit services are more evenly distributed.

---

## 5. Toxic Hotspots (High Complexity + High Churn)

| File | Risk Score | Concern |
|------|-----------|---------|
| `AgentRunner/src/runner.ts` | **59%** | High architectural complexity meets frequent changes |

**Analysis:** The `AgentRunner` runner is the most complex single file in the project. It handles:
- Prompt ambiguity analysis
- Clarification workflow building
- Step execution with retry
- Sequential and parallel execution modes
- Workflow cancellation
- Approval flows and session auto-approve

This is the one file that could benefit from decomposition if complexity continues to grow.

---

## 6. Refactoring Assessment

> **Architecture is stable. No urgent refactors proposed.**

Graphify found no structural violations or coupling anti-patterns that warrant immediate action. The modular MCP-per-service design keeps coupling low.

---

## 7. Compliance & Governance

> **Architecture check passed. No violations found.**

---

## 8. Code Ownership

All 3,860 components are currently **unowned** (no CODEOWNERS file). Consider adding ownership assignments as the team grows to clarify maintenance responsibility per module.

---

## 9. Inter-Module Dependencies

The shortest path from AgentRunner to BlenderBridge is **4 hops** through shared error handling and MCP server creation — indicating good separation. Services communicate through MCP tool interfaces, not direct imports.

---

## 10. Recommendations

| Priority | Action | Rationale |
|----------|--------|-----------|
| Medium | Decompose `AgentRunner/src/runner.ts` | 59% risk score, too many responsibilities in one class |
| Low | Add CODEOWNERS | All 3,860 nodes unowned — ownership unclear |
| Low | Consider extracting Blender MCP test infrastructure | High connectivity from `Manifesto/` test utils inflates graph metrics |
| Info | Deprecated modules (`ECM`) still in graph | `deprecated/ECM/` adds noise — consider removing from builds |

---

## 11. Summary

The LLM-Toolkit is a well-structured monorepo with clean module boundaries enforced by the MCP protocol. Each service is independently deployable as a stdio server. The only structural concern is the growing complexity of the AgentRunner's main orchestration file. The architecture is stable, compliant, and ready for continued feature development.

# vNext Feature Manifest

Purpose: This file marks intentional enhancements that belong to the upcoming release scope so they are not mistaken for unrelated drift during hardening or review.

Release target: `v2.2.0`
Status: `released`
Owner: `core-maintainers`

## Included vNext Features (v2.2.0 — Released)

1. `CLI` workspace (`CLI/`)
- Scope: `llm <command>` terminal binary for invoking all tools from the shell. Uses `commander` for argument parsing; routes to tool HTTP endpoints.
- Key paths: `CLI/src/`, `CLI/tests/`.

2. `SlashCommands` workspace (`SlashCommands/`)
- Scope: MCP server exposing a single `slash_command` tool. Intercepts `/command` messages in LM Studio chat and routes them to the appropriate tool via HTTP.
- Key paths: `SlashCommands/src/`, `SlashCommands/tests/`.

---

## v2.1.0 Features (Released)

1. `AskUser` tool
- Scope: async interview workflow for planning and approval collection.
- Key paths: `AskUser/`.

2. `RAG` tool
- Scope: persistent ingestion/retrieval with source lifecycle and approval-gated writes.
- Key paths: `RAG/`.

3. `Terminal` punchout mode
- Scope: visible terminal window execution and terminal session reuse.
- Key paths: `Terminal/src/punchout.ts`, `Terminal/src/index.ts`, `Terminal/src/mcp-server.ts`, `Terminal/tests/http.test.ts`.

4. Shared package and tool call normalization
- Scope: standardize shared package identity, imports, and canonical tool call schema for all tools and workflows.
- Key paths: `shared/package.json`, `shared/types.ts`, `shared/toolCallNormalizer.ts`, normalization logic in MCP server and workflow runner.

5. MCP config and sync enhancements
- Scope: centralized MCP server config generation and LM Studio bridge sync.
- Key paths: `scripts/workspace/mcp-config.js`, `scripts/workspace/sync-lmstudio-bridge-configs.js`, `scripts/workspace/generate-mcp-config.js`.

6. Evaluation harness hardening
- Scope: expected-success semantics for negative tests and baseline/drift support.
- Key paths: `testing/evaluation/`.

## Documentation

| Document | Purpose |
|----------|---------|
| [Browserless/README.md](../Browserless/README.md) | Browserless MCP tool usage, schemas, and troubleshooting |
| [CLI/README.md](../CLI/README.md) | CLI command reference |
| [docs/SLASH-COMMANDS.md](SLASH-COMMANDS.md) | Slash command reference |

## Marking Rules (Going Forward)

1. Any release-scoped feature must be listed in this file before merge.
2. PR titles for these items should use prefix: `feat(vnext): ...`.
3. Commits that only harden vNext functionality should use prefix: `chore(vnext-hardening): ...`.
4. If scope changes, update this file and `docs/RELEASE_CHECKLIST.md` in the same PR.

---

## In-Progress / Staging (Not Yet Released)

The following directories contain source code that is not yet gated by startup-check, not included in `build:tools`, and have no README startup entries. They are intentional future scope — do not treat as unrelated drift.

### `PackageManager/`
- Scope: MCP server and policy layer for installing/removing npm packages on behalf of the agent. Key files: `src/mcp-server.ts`, `src/package-manager.ts`, `src/policy.ts`.
- Status: source present, no tests, no dist binary, not in startup-check.

### `Git/`
- Scope: MCP server wrapping common git operations (status, diff, commit, push) with policy guards. Key files: `src/mcp-server.ts`, `src/git.ts`, `src/policy.ts`.
- Status: source present and pre-compiled (`.js` files in src/), no jest tests, not in startup-check.

### `FileEditor/`
- Scope: MCP server exposing read/write/patch file operations with safety policy. Key files: `src/file-editor.ts`, `src/policy.ts`.
- Status: source present and pre-compiled (`.js` files in src/), no jest tests, not in startup-check.

### `Observability/`
- Scope: Shared logging, metrics, and tracing library for all LLM Toolkit tools. Provides structured logger, OpenTelemetry-compatible tracer, and Prometheus-style metrics. Key files: `src/logger.ts`, `src/tracer.ts`, `src/metrics.ts`.
- Status: library (no MCP entry point), `src/index.test.ts` present but not wired into root Jest config.

### `Manifesto/Vibing-Manifesto.md`
- Scope: Project philosophy document — not a code workspace.
- Status: documentation only, no build artifact needed.

## Out Of Scope For v2.2.0

- Phase 2 tools (Git, FileEditor, PackageManager, BuildRunner, AIModel, Observability HTTP endpoint).
- Agent orchestrator (Phase 3).
- Breaking API changes without explicit migration notes.

## Planned for v2.3.0

- Optional CLI commands: `llm workflow status`, `llm workflow list`, `llm doc scrape`, `llm git *`, `llm file *`, `llm pkg *`, `llm build *`, `llm observe *`, `llm session *`
- Corresponding slash commands: `/workflow`, `/git`, `/file`, `/build`, `/observe`, `/session`
- Phase 2 tools as they become available

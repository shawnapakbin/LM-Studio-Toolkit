# LLM Toolkit

**Enhanced Feature: Unified Tool Call Normalization**

All tool calls—whether originating from HTTP, MCP, or internal workflows—are automatically normalized to a canonical schema before execution. This ensures seamless compatibility across legacy and new tool call formats, reduces integration bugs, and enables robust multi-model orchestration. The normalization logic is shared and enforced in both the MCP server and workflow runner. See `shared/toolCallNormalizer.ts` for implementation details.

See implementation roadmap: [AGENT_ROADMAP.md](AGENT_ROADMAP.md)

**Version**: 2.2.0  
**Status**: Phase 0 (Foundation) ✅ Complete + v2.1.0 enhancements ✅ + v2.2.0 CLI & Slash Commands ✅

Enterprise-grade LLM software engineer agent with multi-tool orchestration, SQL-backed memory, and unified quality gates.

**GitHub**: https://github.com/shawnapakbin/llm-toolkit-by-shawna

## Quick Start

### Installation

```bash
git clone https://github.com/shawnapakbin/llm-toolkit-by-shawna.git llm-toolkit
cd llm-toolkit
node scripts/setup/setup.js --gui   # Browser GUI (recommended)
# or
node scripts/setup/setup.js         # CLI
```

The setup script handles everything: dependency install, build, `.env` scaffolding, and LM Studio bridge config sync. See [INSTALL.md](INSTALL.md) for full details.

### Repair

If the installation gets corrupted or you move the project folder:

```bash
npm run setup:repair
```

### Verify Setup

```bash
npm run startup:check   # Workspace readiness check
```


## Architecture

### Tool Call Normalization Layer

All tool calls are normalized to a canonical format before dispatch, regardless of their origin. This guarantees that every tool invocation—whether from HTTP, MCP, or workflow runner—follows the same schema, improving reliability and extensibility. See `shared/toolCallNormalizer.ts`.

### 18 Tool Modules + CLI & Slash Commands

- **[Terminal](Terminal/README.md)** — Execute shell commands (OS-aware: Windows/macOS/Linux) ✅
- **[WebBrowser](WebBrowser/README.md)** — Full headless Chromium browser — JS rendering, SPAs, cookies, screenshots, markdown output ✅
- **[Calculator](Calculator/README.md)** — Math expressions (engineering notation, symbol normalization) ✅
- **[DocumentScraper](DocumentScraper/README.md)** — Read documents with structured extraction + encrypted PDF detection ✅
- **[Clock](Clock/README.md)** — Date/time + timezones (IANA + locale formatting) ✅
- **[Browserless](Browserless/README.md)** — Advanced browser automation (screenshots, PDFs, scraping, content extraction, BrowserQL, Puppeteer code, downloads, export, Lighthouse audits) ✅
- **[AskUser](AskUser/README.md)** — Interactive interview workflow for planning and clarification ✅
- **[RAG](RAG/README.md)** — Persistent retrieval augmented generation with source lifecycle + approval-gated writes ✅
- **[Skills](Skills/README.md)** — Persistent skill/playbook system — define parameterized step templates, execute by name ✅
- **[ECM](ECM/README.md)** — Extended Context Memory — effective 1M token context via vector retrieval and session isolation ✅
- **[CSVExporter](CSVExporter/README.md)** — Export parsed table data to CSV files ✅
- **[Git](Git/README.md)** — Safe git operations with branch protection ✅
- **[FileEditor](FileEditor/README.md)** — Safe file read/write/search with workspace sandboxing ✅
- **[PackageManager](PackageManager/README.md)** — Multi-ecosystem package management (npm/pip/cargo/maven/go) ✅
- **[Observability](Observability/README.md)** — Structured logging, metrics, and distributed tracing library ✅
- **[CLI](CLI/README.md)** — `llm <command>` terminal binary for invoking all tools from the shell ✅
- **[SlashCommands](docs/SLASH-COMMANDS.md)** — MCP server exposing `/command` shortcuts for LM Studio chat ✅

### Foundation Layer (Phase 0 ✅)

- **[Biome](biome.json)** — Unified code formatting + linting (1-sec CI runs)
- **[Jest](jest.config.ts)** — Test harness with 80% coverage gates
- **[SQLite Memory](Memory/)** — Task history, solution patterns, learned rules
- **CI/CD Gates** — `.github/workflows/ci.yml` enforces quality on every PR

### Pre-Commit Hooks

Pre-commit quality gates are enforced automatically via [Husky](https://typicode.github.io/husky/) + [lint-staged](https://github.com/lint-staged/lint-staged). On every commit, `biome check` runs on staged `*.{ts,js,json}` files.

### Build Order

```bash
npm run build   # shared → observability → tools (18 modules) → memory
```

### Phases Complete ✅

- Phase 0: Foundation — code quality, tests, CI gates ✅
- Phase 1: Tool hardening + safety ✅
- Phase 2: Orchestration + workflow execution ✅
- Phase 3: Extended tools (Git, FileEditor, PackageManager, CSVExporter, Observability) ✅

See [AGENT_ROADMAP.md](AGENT_ROADMAP.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Release Scope Tracking

To avoid confusion between intentional version enhancements and accidental drift, all upcoming release features must be listed in [docs/VNEXT_FEATURES.md](docs/VNEXT_FEATURES.md).

During hardening for the next release:
- Treat listed features as intentional scope.
- Treat unlisted feature additions as out-of-scope until the manifest is updated.
- Run `npm run verify:all` before release sign-off.

## Code Quality

### Quality Gates (Every PR)

```bash
npm run verify:vnext-scope # Enforce vNext manifest updates for new tool scope
npm run check:ci       # Biome: format + lint ✓
npm run type-check     # TypeScript strict mode ✓
npm run test:ci        # Jest: 80%+ coverage ✓
npm run build          # Compilation check ✓
npm run startup:check:strict # Startup readiness + strict env gate ✓
npm run verify:all     # Combined release hardening gate ✓
```

`startup:check:strict` requires `BROWSERLESS_API_KEY` to be set.

### Standards

- **Test Coverage**: 80% minimum (Terminal: 85%, Calculator: 90%)
- **Type Safety**: `strict: true`, no `any` types
- **Code Style**: Biome (2-space indent, 100-char lines, trailing commas)
- **Documentation**: JSDoc on all exports, architecture docs for design changes
- **Performance**: SLA benchmarks (Terminal < 10s, WebBrowser < 20s, Calculator < 1s)

See [docs/CODE-QUALITY.md](docs/CODE-QUALITY.md) for full standards.

## Development

### Before Making Changes

1. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
2. Read [CONTRIBUTING.md](CONTRIBUTING.md)
3. Create feature branch: `git checkout -b feat/description`

### Workflow

```bash
# Make changes to src/
npm run format        # Auto-fix formatting
npm run lint          # Auto-fix linting
npm run type-check    # Verify type safety
npm test              # Run tests locally (watch mode)
npm run check         # Final pre-commit check
git add .
git commit -m "feat(Tool): description"
git push origin feat/description
# Create pull request
```

## Slash Commands (LM Studio Chat)

You can control the toolkit directly from the LM Studio chat window by typing `/commands`. The `slash_command` MCP tool intercepts messages starting with `/` and routes them to the appropriate tool automatically — no system prompt required.

```
/compact                  → Summarize + compact ECM context memory
/calc sin(30°)            → Evaluate a math expression
/browse https://...       → Fetch and render a URL
/clock --timezone UTC     → Get current time
/run ls -la               → Execute a shell command
/skills list              → List all defined skills
/rag query <text>         → Query the knowledge base
/tools health             → Health-check all tools
/memory stats             → Show workflow run statistics
```

Add `slash-commands` to your LM Studio `mcp.json` (run `npm run mcp:print-config` for the full config), then build with `npm run build:slash`.

See [docs/SLASH-COMMANDS.md](docs/SLASH-COMMANDS.md) for the full command reference.

---

## Deployment

### LM Studio Integration (v1 Configuration)

Update your LM Studio `mcp.json`:

```bash
npm run mcp:print-config
```

Use the generated JSON as-is (paths are resolved for your current local folder). Avoid editing paths manually.

To auto-deploy BOM-free bridge configs into installed LM Studio MCP plugins:

```bash
npm run mcp:sync-lmstudio
```

Optional override for non-default plugin location:

```bash
# Windows PowerShell
$env:LMSTUDIO_MCP_PLUGIN_ROOT=(Read-Host "Enter absolute path to your LM Studio MCP plugins folder")
npm run mcp:sync-lmstudio
```

## Complete `mcp.json` Example

> **⚠ WARNING — Do NOT copy-paste this directly into LM Studio.**
> The paths below are **relative** (illustration only). LM Studio resolves relative paths from its own plugin directory, not your project root, which will cause `Cannot find module` errors for every server.
> Always generate the correct absolute-path config for your machine:
> ```bash
> npm run mcp:print-config   # print to stdout
> npm run mcp:sync-lmstudio  # auto-deploy into LM Studio
> ```

```json
{
	"mcpServers": {
		"terminal": {
			"command": "node",
			"args": ["Terminal/dist/mcp-server.js"],
			"env": {
				"TERMINAL_DEFAULT_TIMEOUT_MS": "60000",
				"TERMINAL_MAX_TIMEOUT_MS": "120000"
			}
		},
		"web-browser": {
			"command": "node",
			"args": ["WebBrowser/dist/mcp-server.js"],
			"env": {
				"BROWSER_DEFAULT_TIMEOUT_MS": "20000",
				"BROWSER_MAX_TIMEOUT_MS": "60000",
				"BROWSER_MAX_CONTENT_CHARS": "12000",
				"BROWSER_HEADLESS": "true"
			}
		},
		"calculator": {
			"command": "node",
			"args": ["Calculator/dist/mcp-server.js"],
			"env": {
				"CALCULATOR_DEFAULT_PRECISION": "12",
				"CALCULATOR_MAX_PRECISION": "20"
			}
		},
		"document-scraper": {
			"command": "node",
			"args": ["DocumentScraper/dist/mcp-server.js"],
			"env": {
				"DOC_SCRAPER_DEFAULT_TIMEOUT_MS": "20000",
				"DOC_SCRAPER_MAX_TIMEOUT_MS": "60000",
				"DOC_SCRAPER_MAX_CONTENT_BYTES": "52428800",
				"DOC_SCRAPER_MAX_CONTENT_CHARS": "50000",
				"DOC_SCRAPER_WORKSPACE_ROOT": ""
			}
		},
		"clock": {
			"command": "node",
			"args": ["Clock/dist/mcp-server.js"],
			"env": {
				"CLOCK_DEFAULT_TIMEZONE": "",
				"CLOCK_DEFAULT_LOCALE": "en-US"
			}
		},
		"browserless": {
			"command": "node",
			"args": ["Browserless/dist/mcp-server.js"],
			"env": {
				"BROWSERLESS_API_KEY": "",
				"BROWSERLESS_DEFAULT_REGION": "production-sfo",
				"BROWSERLESS_DEFAULT_TIMEOUT_MS": "30000",
				"BROWSERLESS_MAX_TIMEOUT_MS": "120000",
				"BROWSERLESS_CONCURRENCY_LIMIT": "5"
			}
		},
		"ask-user": {
			"command": "node",
			"args": ["AskUser/dist/mcp-server.js"],
			"env": {
				"ASK_USER_DB_PATH": "./memory.db",
				"ASK_USER_DEFAULT_EXPIRES_SECONDS": "1800",
				"ASK_USER_MAX_EXPIRES_SECONDS": "86400",
				"ASK_USER_MAX_QUESTIONS": "20"
			}
		},
		"rag": {
			"command": "node",
			"args": ["RAG/dist/mcp-server.js"],
			"env": {
				"RAG_DB_PATH": "./rag.db",
				"RAG_EMBEDDINGS_MODE": "lmstudio",
				"RAG_EMBEDDING_MODEL": "nomic-ai/nomic-embed-text-v1.5",
				"RAG_DOC_SCRAPER_ENDPOINT": "http://localhost:3336/tools/read_document",
				"RAG_ASK_USER_ENDPOINT": "http://localhost:3338/tools/ask_user_interview",
				"RAG_BYPASS_APPROVAL": "true",
				"RAG_CHUNK_SIZE_TOKENS": "384",
				"RAG_CHUNK_OVERLAP_TOKENS": "75"
			}
		},
		"skills": {
			"command": "node",
			"args": ["Skills/dist/mcp-server.js"],
			"env": {
				"SKILLS_DB_PATH": "./skills.db"
			}
		},
		"ecm": {
			"command": "node",
			"args": ["ECM/dist/mcp-server.js"],
			"env": {
				"ECM_DB_PATH": "./ecm.db",
				"ECM_EMBEDDINGS_MODE": "lmstudio",
				"ECM_EMBEDDING_MODEL": "nomic-ai/nomic-embed-text-v1.5"
			}
		},
		"slash-commands": {
			"command": "node",
			"args": ["SlashCommands/dist/mcp-server.js"],
			"env": {
				"SLASH_DEFAULT_SESSION": "default"
			}
		}
	}
}
```

Phase 2 will introduce unified orchestrator MCP server and multi-interface launchers.


## Browserless MCP Tool Usage

### Quick Setup for LLM/Agent Workflows

1. **Get a Browserless API token** from https://browserless.io/account/
2. **Set your token** in your environment (recommended: `.env` or system env):
	 - `BROWSERLESS_API_KEY=your-token-here`
3. **Never commit your token to version control.**

### Tool Registration
- **Cloud:** The Browserless tool is registered to the official MCP endpoint:
	- Endpoint: `https://mcp.browserless.io/mcp?token=YOUR_TOKEN`
	- Token is loaded from `BROWSERLESS_API_KEY` or `BROWSERLESS_API_TOKEN`.
- **Local:** For development, run the tool at `http://localhost:3003` (see [Browserless/README.md](Browserless/README.md)).

### LLM/Agent Integration
- Use the MCP endpoint for all browser automation tasks: screenshots, PDFs, scraping, content extraction, BrowserQL, Puppeteer code, downloads, export, Lighthouse audits, and more.
- See [Browserless/README.md](Browserless/README.md) for full tool list, schemas, and examples.

### Example `.env` file
```
BROWSERLESS_API_KEY=your-browserless-api-token-here
```

### Troubleshooting
- **401/Invalid API key:** Check your token and environment variable.
- **Protocol errors:** Ensure you are using the correct endpoint (MCP for cloud, HTTP for local).
- See [Browserless official docs](https://docs.browserless.io/) for more.

## Testing & CI/CD

### Local Testing

```bash
npm test              # Run all tests (watch mode)
npm run test:ci       # CI mode (coverage report)
npm run benchmark     # Performance SLA checks
```

### GitHub Actions

Automated on every push/PR:
- Biome format + lint check
- TypeScript compilation + type check
- Jest test suite + coverage threshold
- Build verification
- Startup readiness gate (`startup:check:strict`)

Required GitHub Actions secret:
- `BROWSERLESS_API_KEY`

## Troubleshooting Readiness Checks

### ✗ "missing built MCP binary"

**Fix**: Rebuild and verify the artifact.
```bash
npm run build
npm run verify-tools
```

### ✗ "mcp.json block is not valid JSON" or path mismatch

**Fix**: Ensure paths in README MCP section match the exact `dist/mcp-server.js` artifact locations.
```bash
npm run verify:mcp-sync
```

### ✗ "BROWSERLESS_API_KEY is not configured" (local)

**Fix**: Set the environment variable for local testing.
```bash
# macOS/Linux
read -rsp "BROWSERLESS_API_KEY: " BROWSERLESS_API_KEY; echo
export BROWSERLESS_API_KEY
npm run startup:check

# Windows PowerShell
$env:BROWSERLESS_API_KEY = Read-Host "BROWSERLESS_API_KEY"
npm run startup:check
```

### ✗ CI build fails on "Startup readiness (strict)"

**Fix**: Add GitHub Actions secret `BROWSERLESS_API_KEY` in Settings → Secrets → Actions.

## Memory System

The SQLite-backed memory store enables:

- **Task Reuse**: Replay proven solution patterns for similar prompts
- **Decision Tracking**: Audit why tool X was chosen over Y
- **Failure Learning**: Capture what didn't work for backtracking
- **Rule Learning**: SSRF blocks, command denylists discovered during execution

See [Memory/README.md](Memory/README.md) for details.


## Documentation

| Document | Purpose |
|----------|---------|
| [INSTALL.md](INSTALL.md) | Step-by-step installation and setup guide |
| [AGENT_ROADMAP.md](AGENT_ROADMAP.md) | Implementation phases + progress |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design + patterns |
| [docs/CICD.md](docs/CICD.md) | CI gates + branch protection guidance |
| [docs/CODE-QUALITY.md](docs/CODE-QUALITY.md) | Quality standards + benchmarks |
| [docs/VNEXT_FEATURES.md](docs/VNEXT_FEATURES.md) | Source of truth for intentional next-version scope |
| [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) | Release hardening and sign-off steps |
| [CONTRIBUTING.md](CONTRIBUTING.md) | PR workflow + code review checklist |
| [Memory/README.md](Memory/README.md) | Memory persistence API |
| [Browserless/README.md](Browserless/README.md) | Browserless MCP tool usage, schemas, and troubleshooting |
| [Skills/README.md](Skills/README.md) | Skills Tool — persistent playbook system |
| [ECM/README.md](ECM/README.md) | ECM Tool — extended context memory |
| [CLI/README.md](CLI/README.md) | CLI command reference (v2.2.0) |
| [docs/SLASH-COMMANDS.md](docs/SLASH-COMMANDS.md) | Slash command reference (v2.2.0) |
| [SlashCommands/README.md](SlashCommands/README.md) | SlashCommands MCP server setup |


## Features & Status

| Feature | Status | Notes |
|---------|--------|-------|
| CLI + Slash Commands | ✅ | `llm <command>` terminal binary + `/command` MCP shortcuts for LM Studio chat (v2.2.0) |
| Tool call normalization | ✅ | Canonicalizes all tool calls before execution |
| 11 core tools | ✅ | Terminal, WebBrowser (headless), Calculator, DocumentScraper, Clock, Browserless, AskUser, RAG, Skills, ECM |
| WebBrowser headless upgrade | ✅ | Playwright Chromium — JS rendering, SPAs, cookies, screenshots, markdown (v2.1.0) |
| Skills Tool | ✅ | Persistent parameterized playbooks with {{interpolation}} (v2.1.0) |
| ECM Tool | ✅ | 1M token context via vector retrieval + session isolation (v2.1.0) |
| Biome format + lint | ✅ | CI gate, auto-fix on save |
| Jest test suite | ✅ | 80% coverage minimum |
| SQLite memory | ✅ | Task history, patterns, rules |
| GitHub Actions CI | ✅ | Biome + lint + test + build |
| Tool hardening (Phase 1) | 🔄 | Command denylist, SSRF blocking, output truncation |
| New tools (Phase 2) | 🔄 | Git, FileEditor, PackageManager, BuildRunner, AIModel, Observability |
| Agent orchestrator (Phase 3) | 🔄 | Multi-step task planning + pattern replay |
| Multi-interface launchers (Phase 4) | 🔄 | LM Studio + CLI + VS Code + HTTP |


## Contributing

### Tool Call Normalization
All contributors must ensure that any new tool or workflow entry point uses the shared normalization utility for tool calls. This is critical for maintaining compatibility and reliability across the system.

See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development setup
- Code review checklist
- Adding new tools
- Reporting issues

## License

Non-Commercial License (Commercial use requires a separate negotiated agreement with royalties) — See LICENSE file.
Original Author: Shawna Pakbin

## Contact

**GitHub**: [@shawnapakbin](https://github.com/shawnapakbin)  
**Repository**: https://github.com/shawnapakbin/llm-toolkit-by-shawna

---

**Last Updated**: April 2, 2026  
Built with ❤️ for LLM-powered software engineering

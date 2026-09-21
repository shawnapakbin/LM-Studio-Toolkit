# LLM Toolkit

**Enhanced Feature: Unified Tool Call Normalization**

Every tool-call entry point routes through the single shared `normalizeToolCall` utility (`shared/toolCallNormalizer.ts`), so tool calls—whether originating from HTTP, MCP, or internal workflows—are normalized to one canonical schema before execution. AgentRunner, SubAgent, and AskUser all use this same unified path with no partial or alternative normalization branches, which guarantees identical normalized output across entry points, reduces integration bugs, and enables robust multi-model orchestration.

See implementation roadmap: [AGENT_ROADMAP.md](AGENT_ROADMAP.md)

**Version**: 5.1.1  
**Status**: Phase 0 (Foundation) ✅ Complete + installer hardening ✅ + CLI & Slash Commands ✅ + 3DTool MCP Server ✅ + SubAgent MCP Server ✅ + LAN SubAgent ✅ + Common Plugin Injection ✅ + unified config ✅ + Tauri installer ✅

Enterprise-grade LLM software engineer agent with multi-tool orchestration, SQL-backed memory, and unified quality gates.

**GitHub**: https://github.com/shawnapakbin/llm-toolkit

## Quick Start

### Installation

Run '.\setup.bat' in the root folder.

Preferred: GUI installer artifacts from Releases (Windows portable EXE, macOS DMG, Linux AppImage).

Fallback: script setup from a repo clone.

```bash
git clone https://github.com/shawnapakbin/llm-toolkit llm-toolkit
cd llm-toolkit
node scripts/setup/setup.js --gui   # Browser GUI (fallback when installer artifact is unavailable)
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

Every tool-call entry point routes through the shared `normalizeToolCall` utility (`shared/toolCallNormalizer.ts`) before dispatch, regardless of origin. AgentRunner, SubAgent, and AskUser all use this one unified path — there are no passthrough stubs, legacy branches, or alternative normalization paths. This guarantees every tool invocation follows the same canonical schema, improving reliability and extensibility.

### 16 Registered Plugin Entries

The toolkit registers **16 plugin entries** with LM Studio. This is the single authoritative count. The `common` entry bundles 4 tools (Calculator, Clock, AskUser, DocumentScraper) into one plugin, and Browserless registers via its schema-proxy wrapper (`Browserless/scripts/schema-proxy.js`) rather than a `src/mcp-server.ts` entry point — so the number of registered plugin entries is fewer than the number of underlying tools.

Registered plugin entries:

- **[Terminal](Terminal/README.md)** — Execute shell commands (OS-aware: Windows/macOS/Linux) ✅
- **[WebBrowser](WebBrowser/README.md)** — Full headless Chromium browser — JS rendering, SPAs, cookies, screenshots, markdown output ✅
- **[mcp/common](mcp/common/README.md)** — Unified common tools plugin bundling Calculator, Clock, AskUser, and DocumentScraper (4 tools in 1 entry) ✅
- **[Browserless](Browserless/README.md)** — Advanced browser automation via the schema-proxy wrapper (screenshots, PDFs, scraping, content extraction, BrowserQL, Puppeteer code, downloads, export, Lighthouse audits) ✅
- **[RAG](RAG/README.md)** — Persistent retrieval augmented generation with source lifecycle + approval-gated writes ✅
- **[PythonShell](PythonShell/README.md)** — Python code execution + REPL/IDLE launch with startup detection guidance ✅
- **[Skills](Skills/README.md)** — Persistent skill/playbook system — define parameterized step templates, execute by name ✅
- **[SlashCommands](docs/SLASH-COMMANDS.md)** — MCP server exposing `/command` shortcuts for LM Studio chat ✅
- **[BlenderBridge](BlenderBridge/README.md)** — Bridge to a running Blender instance for scene inspection and edits ✅
- **[3DTool](3DTool/README.md)** — 3D model viewer/editor MCP server with multi-format support (OBJ, glTF/GLB), scene management, materials, undo/redo ✅
- **[SubAgent](SubAgent/README.md)** — Fan-out/fan-in parallel inference dispatcher for sub-agent task delegation ✅
- **[LanSubAgent](LanSubAgent/README.md)** — LAN-aware multi-endpoint inference dispatcher — distributes tasks across LM Studio instances on the local network ✅
- **[Git](Git/README.md)** — Safe git operations with branch protection ✅
- **[PackageManager](PackageManager/README.md)** — Multi-ecosystem package management (npm/pip/cargo/maven/go) ✅
- **[CSVExporter](CSVExporter/README.md)** — Export parsed table data to CSV files ✅
- **[FileEditor](FileEditor/README.md)** — Safe file read/write/search with workspace sandboxing (registered runtime MCP server) ✅

### Supporting Library Workspaces (not registered as plugins)

- **[Observability](Observability/README.md)** — Structured logging, metrics, and distributed tracing library
- **[Memory](Memory/README.md)** — SQLite-backed task history, solution patterns, and learned rules
- **[AgentRunner](AgentRunner/README.md)** — Workflow runner and tool registry consumed by other workspaces
- **[CLI](CLI/README.md)** — `llm <command>` terminal binary for invoking tools from the shell
- **[Installer](Installer/README.md)** — Tauri-based native GUI installer (Windows EXE, macOS DMG, Linux AppImage)
- **shared** — Shared types and the `normalizeToolCall` utility

### Foundation Layer (Phase 0 ✅)

- **[Biome](biome.json)** — Unified code formatting + linting (1-sec CI runs)
- **[Jest](jest.config.ts)** — Test harness with 80% coverage gates
- **[SQLite Memory](Memory/)** — Task history, solution patterns, learned rules
- **CI/CD Gates** — `.github/workflows/ci.yml` enforces quality on every PR

### Pre-Commit Hooks

Pre-commit quality gates are enforced automatically via [Husky](https://typicode.github.io/husky/) + [lint-staged](https://github.com/lint-staged/lint-staged). On every commit, `biome check` runs on staged `*.{ts,js,json}` files.

### Build Order

```bash
npm run build   # shared → observability → tools → common → memory
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
npm run test:ci        # Jest: coverage threshold ✓
npm run build          # Compilation check ✓
npm run startup:check  # Startup readiness ✓
npm run verify:all     # Combined release hardening gate ✓
```

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
/calc sin(30°)            → Evaluate a math expression
/browse https://...       → Fetch and render a URL
/clock --timezone UTC     → Get current time
/run ls -la               → Execute a shell command
/skills list              → List all defined skills
/rag query <text>         → Query the knowledge base
/tools health             → Health-check all tools
/memory stats             → Show workflow run statistics
```

The `slash-commands` server is registered as a plugin automatically by `npm run mcp:sync-lmstudio`; no manual configuration is required. Build it with `npm run build:slash`.

See [docs/SLASH-COMMANDS.md](docs/SLASH-COMMANDS.md) for the full command reference.

---

## Deployment

### LM Studio Integration (Plugin-Only)

The toolkit uses a **plugin-only configuration model** — this is the sole supported method. All 16 registered servers are provisioned automatically as LM Studio plugins; there is no manual configuration step.

To auto-deploy BOM-free bridge configs into installed LM Studio MCP plugins:

```bash
npm run mcp:sync-lmstudio
```

This writes exclusively to per-plugin directories (`~/.lmstudio/extensions/plugins/mcp/{serverName}/`). The toolkit **never** touches the user-editable top-level LM Studio config file, and no manual configuration is required. Each plugin directory is tagged with `_owner: "llm-toolkit"` so the toolkit can safely identify and manage its own entries without touching plugins from other applications.

On each sync, old toolkit-owned plugin directories are removed before fresh ones are provisioned. User-customized env values (e.g., API keys you've set manually in a bridge config) are preserved across re-syncs.

### Managing Plugins

Use the toolkit commands to manage all 16 plugin entries — no file editing required:

```bash
npm run mcp:sync-lmstudio  # auto-deploy into LM Studio plugin directories
npm run uninstall          # remove all toolkit plugins from LM Studio
```

Environment overrides for each server are read from the unified `llm-toolkit.config.yaml` when present; the plugin bridge configs are generated from `scripts/workspace/mcp-config.js`, the single registration source of truth.

Optional override for a non-default plugin location:

```bash
# Windows PowerShell
$env:LMSTUDIO_MCP_PLUGIN_ROOT=(Read-Host "Enter absolute path to your LM Studio MCP plugins folder")
npm run mcp:sync-lmstudio
```


## Browserless MCP Tool Usage

### Quick Setup for LLM/Agent Workflows

1. **Get a Browserless API token** from https://browserless.io/account/
2. **Set your token** in your `.env` file: `BROWSERLESS_API_KEY=your-token-here`
3. **Run setup** to sync bridge configs: `node scripts/setup/setup.js`
4. **Never commit your token to version control.**

### How It Works

Browserless runs through a **schema-proxy** that wraps the official `@browserless.io/mcp` package. The proxy fixes incompatible JSON schemas that break LM Studio's grammar-based constrained output generation. See [Browserless/README.md](Browserless/README.md) for details.

### Tool Registration

The bridge config uses the schema-proxy wrapper:
```json
{
  "command": "node",
  "args": ["Browserless/scripts/schema-proxy.js"],
  "env": { "BROWSERLESS_TOKEN": "your-token" }
}
```

### Example `.env` file
```
BROWSERLESS_API_KEY=your-browserless-api-token-here
```

### Troubleshooting
- **401/Invalid API key:** Check your token and environment variable.
- **Grammar parse errors:** Ensure the bridge config points to `schema-proxy.js`, not raw `npx`.
- **spawn EINVAL:** Node.js 24+ must be installed and on PATH.
- See [Browserless/README.md](Browserless/README.md) for more.

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
- Build verification + startup readiness gate

## Troubleshooting Readiness Checks

### ✗ "missing built MCP binary"

**Fix**: Rebuild and verify the artifact.
```bash
npm run build
npm run verify-tools
```

### ✗ "plugin registration out of sync" or unresolved artifact

**Fix**: Rebuild so every registered server's `dist/mcp-server.js` artifact exists, then re-run the sync gate.
```bash
npm run build
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
| [3DTool/README.md](3DTool/README.md) | 3DTool MCP server — 3D viewer/editor with multi-format support |
| [SubAgent/README.md](SubAgent/README.md) | SubAgent MCP server — parallel inference dispatch for sub-agent delegation |
| [LanSubAgent/README.md](LanSubAgent/README.md) | LAN SubAgent — distributed multi-endpoint inference with health checking, load balancing, and GUI |
| [CLI/README.md](CLI/README.md) | CLI command reference |
| [docs/SLASH-COMMANDS.md](docs/SLASH-COMMANDS.md) | Slash command reference |
| [SlashCommands/README.md](SlashCommands/README.md) | SlashCommands MCP server setup |
| [Installer/README.md](Installer/README.md) | Tauri installer setup, build, and usage guide |


## Features & Status

| Feature | Status | Notes |
|---------|--------|-------|
| CLI + Slash Commands | ✅ | `llm <command>` terminal binary + `/command` MCP shortcuts for LM Studio chat |
| 3DTool MCP Server | ✅ | Multi-format 3D viewer/editor with scene management, materials, validation, undo/redo |
| SubAgent MCP Server | ✅ | Fan-out/fan-in parallel inference dispatcher for sub-agent task delegation |
| LAN SubAgent | ✅ | Distributed inference across LAN — multi-endpoint load balancing, health checking, UDP discovery, GUI config |
| FileEditor MCP Server | ✅ | Safe file read/write/search with workspace sandboxing — a registered runtime MCP server |
| Tool call normalization | ✅ | Every entry point routes through the shared `normalizeToolCall` (one unified path) |
| Unified configuration | ✅ | Single-source `llm-toolkit.config.yaml` for all tool settings |
| Tauri installer | ✅ | Cross-platform native GUI installer — Windows EXE, macOS DMG, Linux AppImage |
| 16 registered plugin entries | ✅ | Terminal, WebBrowser, common (bundles Calculator/Clock/AskUser/DocumentScraper), Browserless (schema-proxy), RAG, PythonShell, Skills, SlashCommands, BlenderBridge, 3DTool, SubAgent, LanSubAgent, Git, PackageManager, CSVExporter, FileEditor |
| WebBrowser headless upgrade | ✅ | Playwright Chromium — JS rendering, SPAs, cookies, screenshots, markdown |
| Skills Tool | ✅ | Persistent parameterized playbooks with {{interpolation}} |
| Biome format + lint | ✅ | CI gate, auto-fix on save |
| Jest test suite | ✅ | 80% coverage minimum |
| SQLite memory | ✅ | Task history, patterns, rules |
| GitHub Actions CI | ✅ | Biome + lint + test + build |
| Tool hardening (Phase 1) | ✅ | Command denylist, SSRF blocking, output truncation |
| Extended toolset (Phase 3) | ✅ | Git, FileEditor, PackageManager, CSVExporter, Observability |
| Planned expansion (future) | 🔄 | BuildRunner, AIModel, broader orchestration surface |
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

**Last Updated**: August 21, 2026  
Built with ❤️ for LLM-powered software engineering

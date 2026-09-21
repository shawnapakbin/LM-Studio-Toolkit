# Installation Guide

Quick reference for setting up LLM Toolkit.

---

## Prerequisites

| Requirement | Minimum | Check |
|-------------|---------|-------|
| Node.js | 18+ | `node --version` |
| npm | 8+ | `npm --version` |
| LM Studio | Any | [lmstudio.ai](https://lmstudio.ai) |
| Browserless API key | — | [browserless.io/account](https://browserless.io/account/) |

---

## Option A — Native GUI Installer (recommended)

Download the latest release artifact for your OS from GitHub Releases:
- Windows: `install-XXXX.exe` (portable)
- macOS: `install.dmg`
- Linux: `install.AppImage`

If your platform artifact is temporarily unavailable, use Option B fallback below.

---

## Option B — GUI Setup via Repo Clone (fallback)

```bash
git clone https://github.com/shawnapakbin/llm-toolkit-by-shawna.git llm-toolkit
cd llm-toolkit
node scripts/setup/setup.js --gui
```

A browser window opens at `http://127.0.0.1:7432`.

1. Click **Install / Setup**
2. Watch the live log — all 6 steps run automatically
3. When complete, add your Browserless API key to `.env`
4. Restart LM Studio

Use **Repair** if the installation gets corrupted or you change your workspace path.

---

## Option C — CLI Setup

```bash
git clone https://github.com/shawnapakbin/llm-toolkit-by-shawna.git llm-toolkit
cd llm-toolkit
node scripts/setup/setup.js
```

Or via npm after the first install:

```bash
npm run setup          # Full install
npm run setup:repair   # Repair / reinstall
npm run setup:gui      # Browser GUI
```

---

## What Setup Does

| Step | Action |
|------|--------|
| 1 | Checks Node 18+ and npm 8+ |
| 2 | Creates `.env` from `.env.example` if missing |
| 3 | Runs `npm install` |
| 4 | Runs `npm run build` (compiles all tools + CLI + SlashCommands) |
| 5 | Verifies all tool binaries exist |
| 6 | Syncs LM Studio bridge configs with correct paths and API key |
| 7 | Generates `llm-toolkit.config.yaml` from defaults (if not already present) |

---

## Unified Configuration

Starting with v2.4.0, all tool settings are managed through a single YAML file at the project root:

```
llm-toolkit.config.yaml
```

This file is the **single source of truth** for every tool server's configuration — ports, timeouts, API keys, and workspace paths. Individual `.env` variables and per-tool environment overrides still work but are superseded by values in the config file when present.

### Example (trimmed)

```yaml
global:
  logLevel: info              # Log level for all tools (info | debug | warn | error)
  workspaceRoot: .            # Root workspace path

terminal:
  port: 3333                  # HTTP port for Terminal server
  defaultTimeoutMs: 60000     # Default command timeout
  maxTimeoutMs: 120000        # Maximum allowed timeout

webbrowser:
  port: 3334                  # HTTP port for WebBrowser server
  headless: true              # Run browser in headless mode
  maxContentChars: 12000      # Max output character limit

browserless:
  port: 3003                  # HTTP port for Browserless proxy
  apiKey: YOUR_API_KEY_HERE   # Browserless API key (replace with your key)
  apiUrl: https://production-sfo.browserless.io

rag:
  port: 3339                  # HTTP port for RAG server
  dbPath: ./rag.db            # Path to RAG SQLite database
  embeddingModel: nomic-ai/nomic-embed-text-v1.5
```

> All examples use placeholder values. Never commit real API keys to version control.

---

## Migrating from .env to Unified Config

If you're upgrading from a previous version that used `.env` files or per-tool environment variables, run the migration CLI:

```bash
npx migrate-config
```

This reads your existing `.env` and per-tool environment variables and produces a fully populated `llm-toolkit.config.yaml` at the project root. Existing settings are preserved; new fields receive default values.

After migration, you can remove tool-specific environment variables from your shell profile — the config file takes precedence.

---

## After Setup

### Set your Browserless API key

Open `.env` in the project root and set:

```
BROWSERLESS_API_KEY=your-key-here
```

Get your key at [browserless.io/account](https://browserless.io/account/).

Then re-run sync so LM Studio picks it up:

```bash
npm run setup:repair
```

### Restart LM Studio

Restart LM Studio to reload the updated MCP bridge configs.

### Verify everything is working

```bash
npm run startup:check
```

### Adjust Tool Settings

All tool settings (ports, timeouts, API keys) live in `llm-toolkit.config.yaml` at the project root. Edit this file to customize behavior.

Changes take effect on the next tool server restart (re-run `npm run setup:repair` or restart LM Studio).

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Cannot find module '...dist/mcp-server.js'` | Run `npm run setup:repair` — sets `cwd` in bridge configs |
| `BROWSERLESS_API_KEY is not configured` | Add key to `.env`, then re-run `npm run setup:repair` |
| Build fails | Check Node version (`node --version` must be 18+) |
| LM Studio doesn't see tools | Restart LM Studio after setup |
| Plugin not installed in LM Studio | Install the MCP plugin in LM Studio first, then re-run setup |

See [docs/FAQ.md](docs/FAQ.md) for detailed issue explanations.

---

## Manual LM Studio Path Override

If LM Studio is installed in a non-default location:

```bash
# Windows PowerShell
$env:LMSTUDIO_MCP_PLUGIN_ROOT="C:\path\to\your\lmstudio\plugins\mcp"
npm run setup

# macOS / Linux
LMSTUDIO_MCP_PLUGIN_ROOT="/path/to/your/lmstudio/plugins/mcp" npm run setup
```

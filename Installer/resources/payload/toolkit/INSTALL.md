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

## Option A — GUI Setup (recommended)

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

## Option B — CLI Setup

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

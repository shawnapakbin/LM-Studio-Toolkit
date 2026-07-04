# LM Studio MCP Integration Guide

Quick reference for connecting LLM Toolkit to LM Studio via the Model Context Protocol.

---

## Prerequisites

- LM Studio installed with the MCP plugin
- LLM Toolkit built (`npm run build` from repo root)
- Browserless API key (for the Browserless tool)

---

## Generate Your `mcp.json`

The easiest way to get a ready-to-paste config with correct absolute paths for your machine:

```bash
npm run mcp:print-config
```

To auto-deploy configs directly into your LM Studio MCP plugin folder:

```bash
npm run mcp:sync-lmstudio
```

If LM Studio is installed in a non-default location:

```bash
# Windows PowerShell
$env:LMSTUDIO_MCP_PLUGIN_ROOT="C:\path\to\lmstudio\plugins\mcp"
npm run mcp:sync-lmstudio
```

---

## Available MCP Servers

| Server key | Tool | Port | Description |
|---|---|---|---|
| `terminal` | `run_terminal_command` | 3333 | Execute shell commands (OS-aware) |
| `web-browser` | `browse_web` | 3334 | Headless Chromium — JS rendering, screenshots, markdown |
| `basic` | `get_current_datetime`, `calculate_engineering`, `interview_user` | stdio | Consolidated Clock + Calculator + AskUser MCP plugin. Always allowed — no permission prompts or approval tokens required. |
| `document-scraper` | `read_document` | 3336 | Read local/remote documents (PDF, DOCX, HTML, CSV) |
| `rag` | `ingest_documents`, `query_knowledge` | 3339 | Persistent retrieval-augmented generation |
| `python-shell` | `python_run_code`, `python_open_repl`, `python_open_idle` | 3343 | Python execution and shell/editor launch |
| `skills` | `skills` | 3341 | Define and execute named parameterized playbooks |
| `browserless` | 7 tools | 3003 | Advanced browser automation (BrowserQL, screenshots, PDFs, scraping) |
| `slash-commands` | `slash_command` | stdio | `/command` shortcuts for LM Studio chat |
| `3d-tool` | `launch_viewer`, `poll_interactions`, `edit_3d_file`, `get_model_metadata` | 3344 | Interactive 3D model viewer — load OBJ files, annotate geometry, live-reload edits |

---

## Minimal `mcp.json` (Core Tools)

`basic` is always allowed — no permission prompts or approval tokens required.

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
    "basic": {
      "command": "node",
      "args": ["Basic/dist/mcp-server.js"]
    },
    "web-browser": {
      "command": "node",
      "args": ["WebBrowser/dist/mcp-server.js"],
      "env": {
        "BROWSER_HEADLESS": "true"
      }
    }
  }
}
```

For the full config with all 10 MCP servers, see the `mcp.json` example in [README.md](README.md#complete-mcpjson-example).

---

## Slash Commands

Add `slash-commands` to your `mcp.json` to enable `/command` shortcuts in LM Studio chat:

```json
"slash-commands": {
  "command": "node",
  "args": ["SlashCommands/dist/mcp-server.js"],
  "env": {
    "SLASH_DEFAULT_SESSION": "default"
  }
}
```

Then type `/calc sin(30°)`, `/browse https://...`, etc. directly in chat.

See [docs/SLASH-COMMANDS.md](docs/SLASH-COMMANDS.md) for the full command reference.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Cannot find module '...dist/mcp-server.js'` | Run `npm run build` then `npm run mcp:sync-lmstudio` |
| Tool not appearing in LM Studio | Restart LM Studio after updating `mcp.json` |
| `BROWSERLESS_API_KEY is not configured` | Add key to `.env`, re-run `npm run setup:repair` |
| Path errors after moving the project | Run `npm run setup:repair` to regenerate bridge configs |

See [docs/FAQ.md](docs/FAQ.md) for detailed issue explanations.

---

**Last Updated**: April 2026

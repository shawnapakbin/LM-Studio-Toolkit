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
| `calculator` | `calculate_engineering` | 3335 | Math expressions, engineering notation, unit conversions |
| `document-scraper` | `read_document` | 3336 | Read local/remote documents (PDF, DOCX, HTML, CSV) |
| `clock` | `get_current_datetime` | 3337 | Current date/time with timezone + locale formatting |
| `ask-user` | `ask_user_interview` | 3338 | Interactive clarification interview workflow |
| `rag` | `ingest_documents`, `query_knowledge` | 3339 | Persistent retrieval-augmented generation |
| `skills` | `skills` | 3341 | Define and execute named parameterized playbooks |
| `ecm` | `ecm` | 3342 | Extended Context Memory — 1M token context via vector retrieval |
| `browserless` | 7 tools | 3003 | Advanced browser automation (BrowserQL, screenshots, PDFs, scraping) |
| `slash-commands` | `slash_command` | stdio | `/command` shortcuts for LM Studio chat |

---

## Minimal `mcp.json` (Core Tools)

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
    "calculator": {
      "command": "node",
      "args": ["Calculator/dist/mcp-server.js"]
    },
    "clock": {
      "command": "node",
      "args": ["Clock/dist/mcp-server.js"]
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

For the full config with all 11 tools, see the `mcp.json` example in [README.md](README.md#complete-mcpjson-example).

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

Then type `/compact`, `/calc sin(30°)`, `/browse https://...`, etc. directly in chat.

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

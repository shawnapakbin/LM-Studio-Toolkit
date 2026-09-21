# LM Studio MCP Integration Guide

Quick reference for connecting LLM Toolkit to LM Studio via the Model Context Protocol.

---

## Prerequisites

- LM Studio installed with the MCP plugin
- LLM Toolkit built (`npm run build` from repo root)
- Browserless API key (for the Browserless tool)

---

## Plugin-Only Configuration

The toolkit uses a **plugin-only configuration model** — this is the sole supported method. All 16 registered servers are provisioned automatically as LM Studio plugins; you never create, open, or edit any LM Studio config file by hand.

Provision (or re-provision) every toolkit plugin:

```bash
npm run mcp:sync-lmstudio
```

This writes only to per-plugin directories (`~/.lmstudio/extensions/plugins/mcp/{serverName}/`) and never touches the user-editable top-level LM Studio config. If LM Studio is installed in a non-default location:

```bash
# Windows PowerShell
$env:LMSTUDIO_MCP_PLUGIN_ROOT="C:\path\to\lmstudio\plugins\mcp"
npm run mcp:sync-lmstudio
```

Per-server environment values are read from the unified `llm-toolkit.config.yaml`. See [mcp-json.md](mcp-json.md) for the full registration model.

---

## Registered Plugin Entries (16)

The toolkit registers **16 plugin entries** — the single authoritative count. The `common` entry bundles 4 tools (Calculator, Clock, AskUser, DocumentScraper) into one plugin, and Browserless registers via its schema-proxy wrapper (`Browserless/scripts/schema-proxy.js`), so registered entries are fewer than the underlying tools.

| Registered entry | Description |
|---|---|
| `terminal` | Execute shell commands (OS-aware) |
| `web-browser` | Headless Chromium — JS rendering, screenshots, markdown |
| `common` | Bundles Calculator, Clock, AskUser, and DocumentScraper |
| `browserless` | Advanced browser automation via the schema-proxy wrapper |
| `rag` | Persistent retrieval-augmented generation |
| `python-shell` | Python execution + REPL/IDLE launch |
| `skills` | Define and execute named parameterized playbooks |
| `slash-commands` | `/command` shortcuts for LM Studio chat |
| `blender-bridge` | Bridge to a running Blender instance |
| `3dtool` | 3D model viewer/editor |
| `sub-agent` | Fan-out/fan-in parallel inference dispatch |
| `lan-sub-agent` | LAN-aware multi-endpoint inference dispatch |
| `git` | Safe git operations with branch protection |
| `package-manager` | Multi-ecosystem package management |
| `csv-exporter` | Export parsed table data to CSV |
| `file-editor` | Safe file read/write/search (registered runtime MCP server) |

---

## Slash Commands

The `slash-commands` server is registered as a plugin automatically by `npm run mcp:sync-lmstudio` — no manual configuration is required. Build it with `npm run build:slash`, then type `/calc sin(30°)`, `/browse https://...`, etc. directly in chat.

See [SLASH-COMMANDS.md](SLASH-COMMANDS.md) for the full command reference.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Cannot find module '...dist/mcp-server.js'` | Run `npm run build` then `npm run mcp:sync-lmstudio` |
| Tool not appearing in LM Studio | Restart LM Studio after `npm run mcp:sync-lmstudio` |
| `BROWSERLESS_API_KEY is not configured` | Add key to `.env`, re-run `npm run setup:repair` |
| Path errors after moving the project | Run `npm run setup:repair` to regenerate bridge configs |

See [FAQ.md](FAQ.md) for detailed issue explanations.

---

**Last Updated**: April 2026

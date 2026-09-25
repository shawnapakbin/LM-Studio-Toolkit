# LM Studio MCP Integration Guide

Quick reference for connecting LLM Toolkit to LM Studio via the Model Context Protocol.

---

## Prerequisites

- LM Studio installed with the MCP plugin
- LLM Toolkit built (`npm run build` from repo root)
- Browserless API key (for the Browserless tool)

---

## Plugin-Only Configuration

The toolkit uses a **plugin-only configuration model** — this is the sole supported method. All 9 registered servers are provisioned automatically as LM Studio plugins; you never create, open, or edit any LM Studio config file by hand.

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

## Registered Plugin Entries (9)

See [mcp-json.md](mcp-json.md) for the full list of the 9 registered plugin entries. In short: the `common` entry bundles 4 tools (Calculator, Clock, AskUser, DocumentScraper) into one plugin, and Browserless registers via its schema-proxy wrapper (`Browserless/scripts/schema-proxy.js`), so registered entries are fewer than the underlying tools.

---

## Slash Commands

The `slash-commands` server is currently **Unshipped** — it remains in the repository and still builds (`npm run build:slash`), but is not provisioned by `npm run mcp:sync-lmstudio` in this release. It can be re-enabled in a future release without reconstruction.

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

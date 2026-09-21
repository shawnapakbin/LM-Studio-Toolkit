# LM Studio Integration (Plugin-Only)

The toolkit uses a **plugin-only configuration model**, and this is the sole supported method. You never create, open, or edit any top-level LM Studio config by hand — all 16 registered servers are provisioned automatically as LM Studio plugins.

## How registration works

`scripts/workspace/mcp-config.js` is the single registration source of truth. Running the sync generates a BOM-free bridge config for each server and writes it into that server's own per-plugin directory:

```bash
npm run mcp:sync-lmstudio
```

This writes exclusively to per-plugin directories at `~/.lmstudio/extensions/plugins/mcp/{serverName}/`. The toolkit never writes to the user-editable top-level LM Studio config. Each plugin directory is tagged with `_owner: "llm-toolkit"` so the toolkit can safely manage its own entries without touching plugins from other applications.

To remove all toolkit plugins from LM Studio:

```bash
npm run uninstall
```

## Registered plugin entries (16)

The toolkit registers **16 plugin entries** — the single authoritative count. Note that the `common` entry bundles 4 tools (Calculator, Clock, AskUser, DocumentScraper) into one plugin, and Browserless registers via its schema-proxy wrapper (`Browserless/scripts/schema-proxy.js`) rather than a `src/mcp-server.ts` entry point, so the number of registered entries is fewer than the number of underlying tools.

| # | Registered entry | Notes |
|---|------------------|-------|
| 1 | terminal | Shell command execution |
| 2 | web-browser | Headless Chromium |
| 3 | common | Bundles Calculator, Clock, AskUser, DocumentScraper |
| 4 | browserless | Registers via schema-proxy wrapper |
| 5 | rag | Retrieval augmented generation |
| 6 | python-shell | Python execution + REPL |
| 7 | skills | Persistent playbooks |
| 8 | slash-commands | `/command` shortcuts |
| 9 | blender-bridge | Bridge to a running Blender instance |
| 10 | 3dtool | 3D viewer/editor |
| 11 | sub-agent | Parallel inference dispatch |
| 12 | lan-sub-agent | LAN-aware inference dispatch |
| 13 | git | Safe git operations |
| 14 | package-manager | Multi-ecosystem package management |
| 15 | csv-exporter | Export table data to CSV |
| 16 | file-editor | Safe file read/write/search (registered runtime MCP server) |

## Environment overrides

Per-server environment values are read from the unified `llm-toolkit.config.yaml` at the project root when present. Build all servers before syncing so each `dist/mcp-server.js` artifact exists:

```bash
npm run build
npm run mcp:sync-lmstudio
```

Optional override for a non-default plugin location:

```bash
# Windows PowerShell
$env:LMSTUDIO_MCP_PLUGIN_ROOT=(Read-Host "Enter absolute path to your LM Studio MCP plugins folder")
npm run mcp:sync-lmstudio
```

## Additional Resources

- **Full documentation:** [../README.md](../README.md)
- **RAG workflows:** [QUICKSTART-RAG.md](QUICKSTART-RAG.md)
- **Sudo / privileged commands:** [QUICKSTART-SUDO.md](QUICKSTART-SUDO.md)
- **Troubleshooting guide:** [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

# Port Registry

Central reference for all LLM Toolkit tool port assignments.

| Port | Tool | Protocol | Status |
|------|------|----------|--------|
| 3003 | Browserless | HTTP + MCP | Active |
| 3011 | Git | HTTP + MCP | Staging |
| 3333 | Terminal | HTTP + MCP | Active |
| 3334 | WebBrowser | HTTP + MCP | Active |
| 3335 | Calculator | HTTP + MCP | Active |
| 3336 | DocumentScraper | HTTP + MCP | Active |
| 3337 | Clock | HTTP + MCP | Active |
| 3338 | AskUser | HTTP + MCP | Active |
| 3339 | RAG | HTTP + MCP | Active |
| 3343 | PythonShell | HTTP + MCP | Active |
| 3340 | CSVExporter | HTTP + MCP | Staging |
| 3341 | Skills | HTTP + MCP | Active |

## Non-HTTP / Stdio Tools

| Tool | Interface | Status |
|------|-----------|--------|
| CLI | Terminal binary (`llm`) | Active |
| SlashCommands | MCP Stdio only | Active |
| FileEditor | MCP (registered runtime server) | Active |
| PackageManager | MCP (registered runtime server) | Active |
| Memory | Library (no server) | Active |
| Observability | Library (no server) | Active |
| AgentRunner | Library (no server) | Active |

## Notes

- Ports 3333–3341 are reserved for LLM Toolkit tools.
- Port 3003 is used by Browserless (external service proxy).
- Port 3011 is assigned to the Git tool.
- Environment variable `{TOOL}_PORT` can override default ports (e.g., `TERMINAL_PORT=3333`).
- The CLI routes requests to these HTTP endpoints.

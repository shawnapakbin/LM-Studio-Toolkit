# Port Registry

Central reference for all LLM Toolkit tool port assignments. Port defaults are defined in `shared/config/src/schema.ts` and registered via `scripts/workspace/mcp-config.js` (9 registered MCP servers).

## HTTP-capable tools

Sorted by port. Each tool exposes an HTTP endpoint and is registered with LM Studio over MCP (stdio), unless noted otherwise.

| Port | Tool (serverName) | Protocol | Status |
|------|-------------------|----------|--------|
| 3003 | Browserless (browserless) | HTTP proxy + MCP (stdio via `schema-proxy.js`) | Active |
| 3013 | 3DTool (3dtool) | HTTP + MCP (stdio) | Active |
| 3333 | Terminal (terminal) | HTTP + MCP (stdio) | Active |
| 3334 | WebBrowser (web-browser) | HTTP + MCP (stdio) | Active |
| 3335 | Calculator (in common) | HTTP + MCP (bundled) | Active |
| 3336 | DocumentScraper (in common) | HTTP + MCP (bundled) | Active |
| 3337 | Clock (in common) | HTTP + MCP (bundled) | Active |
| 3338 | AskUser (in common; UI on 3338) | HTTP + MCP (bundled) | Active |
| 3341 | Skills (skills) | HTTP + MCP (stdio) | Active |
| 3343 | PythonShell (python-shell) | HTTP + MCP (stdio) | Active |
| 9876 | BlenderBridge (blender-bridge) | TCP client to the Blender add-on (not its own HTTP server) | Active |

## Stdio-only registered servers

Registered MCP servers with no dedicated HTTP port of their own.

| Server (serverName) | Interface | Notes |
|---------------------|-----------|-------|
| common | MCP (stdio) | Bundles Calculator + Clock + AskUser + DocumentScraper |
| lan-sub-agent | MCP (stdio) | UDP discovery 41234, local LM Studio 1234, GUI 9847 |

### Unshipped (not provisioned)

These servers exist in the repository and still build, but are not provisioned or registered in this release: `slash-commands`, `sub-agent`, `git`. They can be re-enabled in a future release without reconstruction.

## Libraries / binaries (no MCP registration)

| Component | Type | Notes |
|-----------|------|-------|
| CLI | Terminal binary (`llm`) | Routes requests to tool HTTP endpoints |
| AgentRunner | Library | Discovery `basePort` 3330 (library discovery base) |
| Memory | Library | No server |
| Observability | Library | No server |
| shared & shared/config | Libraries | No server |
| Installer | Tauri v2 desktop app | Stages payload; not an MCP server |

## Notes

- Environment variable `{TOOL}_PORT` can override default ports (e.g., `TERMINAL_PORT=3333`).
- HTTP-capable tools span ports 3003, 3013, 3333–3343, and 9876 (BlenderBridge is a TCP client to the Blender add-on, not its own HTTP server).
- Port 3003 is used by Browserless, which registers via `Browserless/scripts/schema-proxy.js` (a wrapper around `@browserless.io/mcp`).
- The CLI routes requests to these HTTP endpoints.

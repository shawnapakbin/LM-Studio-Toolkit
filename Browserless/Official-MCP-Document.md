# Browserless MCP Server

The Browserless MCP server gives AI assistants full browser automation through the [Model Context Protocol](https://modelcontextprotocol.io/). Connect any MCP-compatible client (Claude Desktop, Cursor, VS Code, Windsurf, and more) to scrape, search, crawl, audit, and run custom browser code with no infrastructure to manage.

Prerequisites

- A Browserless account - either an API token from your account dashboard, or OAuth sign-in
- An MCP-compatible client (Claude Desktop, Cursor, VS Code, Windsurf, etc.)

## Hosted Server​

Browserless provides a hosted MCP server ready to use:

```
https://mcp.browserless.io/mcp
```

No installation or environment variables required. See [Authentication](https://docs.browserless.io/mcp/browserless-mcp-server/setup?userId=cus_TNn0yOdSpEFIT4#authentication) for how to connect.

## Authentication​

The hosted server supports three authentication methods:

| Method | Best for |
| --- | --- |
| OAuth (Browserless account login) | Clients that support OAuth — no token needed |
| Authorization header | Clients that support custom headers |
| token query parameter | URL-only clients (e.g. Claude.ai custom connectors) |

When multiple methods are present, they are evaluated in this order: `Authorization` header (plain API token) → `token` query parameter → OAuth JWT.

### OAuth​

For clients that support OAuth (for example Claude Desktop or Cursor), the hosted server can authenticate you through your Browserless account - no API token required. When you connect, your client will open a browser window to sign in. After authenticating, the server resolves your account automatically.

OAuth is enabled on the hosted server at `https://mcp.browserless.io/mcp` with no extra configuration needed.

### API Token​

Pass your API token as a Bearer header or query parameter:

- Header (recommended): Authorization: Bearer YOUR_API_TOKEN_HERE
- Query parameter: ?token=YOUR_API_TOKEN_HERE

## Client Setup​

tip

Clients that support OAuth can connect without a token - the server will prompt you to sign in with your Browserless account.

- Claude
- Cursor
- VS Code
- Windsurf
- Gemini CLI
- Codex

#### Claude.ai​

Claude.ai supports MCP servers via custom connectors. Since the connector form only accepts a URL, pass your token as a query parameter:

1. Go to Customize > Connectors in Claude.ai.
2. Click Add custom connector.
3. Enter a name (e.g., Browserless) and the following URL:

```
https://mcp.browserless.io/mcp?token=YOUR_API_TOKEN_HERE
```

1. Click Add.

#### Claude Desktop​

Add to your `claude_desktop_config.json`:

```
{  "mcpServers": {    "browserless": {      "type": "http",      "url": "https://mcp.browserless.io/mcp",      "headers": {        "Authorization": "Bearer YOUR_API_TOKEN_HERE"      }    }  }}
```

#### Claude Code​

Run in your terminal:

```
claude mcp add --transport http browserless https://mcp.browserless.io/mcp \  --header "Authorization: Bearer YOUR_API_TOKEN_HERE"
```

For more information, see the [Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp).

Add to your Cursor MCP settings:

```
{  "mcpServers": {    "browserless": {      "type": "http",      "url": "https://mcp.browserless.io/mcp",      "headers": {        "Authorization": "Bearer YOUR_API_TOKEN_HERE"      }    }  }}
```

Add to your VS Code settings (`settings.json`):

```
{  "mcp": {    "servers": {      "browserless": {        "type": "http",        "url": "https://mcp.browserless.io/mcp",        "headers": {          "Authorization": "Bearer YOUR_API_TOKEN_HERE"        }      }    }  }}
```

Add to your Windsurf MCP configuration:

```
{  "mcpServers": {    "browserless": {      "type": "http",      "url": "https://mcp.browserless.io/mcp",      "headers": {        "Authorization": "Bearer YOUR_API_TOKEN_HERE"      }    }  }}
```

Add to your `~/.gemini/settings.json` (or project-scoped `.gemini/settings.json`):

```
{  "mcpServers": {    "browserless": {      "httpUrl": "https://mcp.browserless.io/mcp",      "headers": {        "Authorization": "Bearer YOUR_API_TOKEN_HERE"      }    }  }}
```

For more information, see the [Gemini CLI MCP documentation](https://geminicli.com/docs/cli/tutorials/mcp-setup/).

The Browserless hosted server supports OAuth. Run in your terminal and follow the login prompt:

```
codex mcp add browserless --url https://mcp.browserless.io/mcp
```

To use an API token instead of OAuth, add to your `~/.codex/config.toml`:

```
[mcp_servers.browserless]url = "https://mcp.browserless.io/mcp"bearer_token_env_var = "BROWSERLESS_TOKEN"
```

Set `BROWSERLESS_TOKEN` in your environment before starting Codex.

You can also add it through the UI: **Settings → MCP Servers → + Add Server → Streamable HTTP**, then enter `https://mcp.browserless.io/mcp` as the URL.

For more information, see the [Codex MCP documentation](https://developers.openai.com/codex/mcp).

## Run Locally​

Requirements

[Node.js](https://nodejs.org/) 24 or newer.

Prefer not to use the hosted server? The MCP server is published to npm as [@browserless.io/mcp](https://www.npmjs.com/package/@browserless.io/mcp), so you can run it locally with [npx](https://docs.npmjs.com/cli/commands/npx) — no cloning, building, or Docker required. This is useful for pinning a specific server version or pointing at a [self-hosted Browserless instance](https://docs.browserless.io/baas/start) — including fully air-gapped setups, but only when that self-hosted instance also runs inside the isolated network. On its own, running locally with `npx` still calls the Browserless cloud for browser execution.

Running locally still calls the Browserless cloud (or your self-hosted instance) for the actual browser work. Only the MCP server process runs on your machine.

### stdio (MCP clients)​

For desktop MCP clients, point the server config at `npx` and pass your token as an environment variable. The server starts in **stdio** mode by default, which is what local clients expect:

- Claude
- Cursor
- VS Code
- Gemini CLI
- Codex

#### Claude Desktop​

Add to your `claude_desktop_config.json`:

```
{  "mcpServers": {    "browserless": {      "command": "npx",      "args": ["-y", "@browserless.io/mcp"],      "env": {        "BROWSERLESS_TOKEN": "YOUR_API_TOKEN_HERE"      }    }  }}
```

#### Claude Code​

Run in your terminal:

```
claude mcp add browserless --env BROWSERLESS_TOKEN=YOUR_API_TOKEN_HERE \  -- npx -y @browserless.io/mcp
```

Add to your Cursor MCP settings:

```
{  "mcpServers": {    "browserless": {      "command": "npx",      "args": ["-y", "@browserless.io/mcp"],      "env": {        "BROWSERLESS_TOKEN": "YOUR_API_TOKEN_HERE"      }    }  }}
```

Add to your VS Code settings (`settings.json`):

```
{  "mcp": {    "servers": {      "browserless": {        "command": "npx",        "args": ["-y", "@browserless.io/mcp"],        "env": {          "BROWSERLESS_TOKEN": "YOUR_API_TOKEN_HERE"        }      }    }  }}
```

Add to your `~/.gemini/settings.json` (or project-scoped `.gemini/settings.json`):

```
{  "mcpServers": {    "browserless": {      "command": "npx",      "args": ["-y", "@browserless.io/mcp"],      "env": {        "BROWSERLESS_TOKEN": "YOUR_API_TOKEN_HERE"      }    }  }}
```

Run in your terminal:

```
codex mcp add browserless --env BROWSERLESS_TOKEN=YOUR_API_TOKEN_HERE \  -- npx -y @browserless.io/mcp
```

Or add to your `~/.codex/config.toml`:

```
[mcp_servers.browserless]command = "npx"args = ["-y", "@browserless.io/mcp"][mcp_servers.browserless.env]BROWSERLESS_TOKEN = "YOUR_API_TOKEN_HERE"
```

### HTTP (httpStream)​

To run the server as a long-lived HTTP endpoint (for example to share one instance across clients) set `TRANSPORT=httpStream`:

```
TRANSPORT=httpStream PORT=8080 BROWSERLESS_TOKEN=YOUR_API_TOKEN_HERE \  npx -y @browserless.io/mcp
```

Then point your MCP client at `http://localhost:8080/mcp`, using the same header or query-parameter auth as the hosted server.

### Environment variables​

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| BROWSERLESS_TOKEN | Yes | — | Your Browserless API token |
| BROWSERLESS_API_URL | No | https://production-sfo.browserless.io | API endpoint (set this to point at a self-hosted instance or a different region) |
| TRANSPORT | No | stdio | Transport type: stdio or httpStream |
| PORT | No | 8080 | HTTP server port (only used with httpStream) |
| BROWSERLESS_TIMEOUT | No | 30000 | Request timeout in milliseconds |
| BROWSERLESS_MAX_RETRIES | No | 3 | Max retry attempts for failed requests |
| BROWSERLESS_CACHE_TTL | No | 60000 | Cache TTL in milliseconds (0 to disable) |

## Regional Endpoints​

By default, the hosted MCP server connects to the **US West (San Francisco)** Browserless region. To use a different region, pass the endpoint as a header or query parameter:

| Region | Endpoint |
| --- | --- |
| US West — San Francisco (default) | https://production-sfo.browserless.io |
| Europe — London | https://production-lon.browserless.io |
| Europe — Amsterdam | https://production-ams.browserless.io |

**Using the x-browserless-api-url header** (for clients that support headers):

```
{  "mcpServers": {    "browserless": {      "type": "http",      "url": "https://mcp.browserless.io/mcp",      "headers": {        "Authorization": "Bearer YOUR_API_TOKEN_HERE",        "x-browserless-api-url": "https://production-sfo.browserless.io"      }    }  }}
```

**Using the browserlessUrl query parameter** (for URL-only clients like Claude.ai):

```
https://mcp.browserless.io/mcp?token=YOUR_API_TOKEN_HERE&browserlessUrl=https://production-sfo.browserless.io
```

## Tools​

The MCP server exposes nine tools to your AI assistant, split across two reference pages:

### Browser Agent​

A single **stateful** tool, `browserless_agent`, that drives a browser session across turns. The session persists across tool calls, so the model can navigate, snapshot the page, click, type, fill forms, and react to what it sees — all within one browser context. Ideal for logins, multi-step flows, and anything that needs the browser's state to survive between turns.

### REST API Tools​

Eight **stateless** tools that wrap individual Browserless REST endpoints — one call in, one result out:

| Tool | Purpose |
| --- | --- |
| browserless_smartscraper | Scrape any URL with cascading strategies (HTTP → proxy → headless → CAPTCHA solving) |
| browserless_function | Run custom Puppeteer JavaScript on the Browserless cloud |
| browserless_download | Trigger and retrieve browser-initiated file downloads |
| browserless_export | Export a page as HTML, PDF, image, or full offline ZIP |
| browserless_search | Web/news/image search with optional scraping of each result |
| browserless_map | Discover all URLs on a site via sitemap and link extraction |
| browserless_performance | Run a Lighthouse audit (accessibility, performance, SEO, PWA, best practices) |
| browserless_crawl | Crawl a site from a seed URL and scrape every discovered page |

## FAQ & Troubleshooting​

How much do MCP sessions cost?

Each MCP tool call opens a browser session that consumes units based on session time, plus proxy traffic and CAPTCHA solving if used. See [Unit Consumption](https://docs.browserless.io/overview/unit-consumption#mcp-session-cost) for the full breakdown.

## Next steps​

[REST API Toolsthe eight stateless MCP tools](https://docs.browserless.io/mcp/rest-api-tools)
[Browser Agentthe stateful, multi-turn browserless_agent tool](https://docs.browserless.io/mcp/browser-agent)
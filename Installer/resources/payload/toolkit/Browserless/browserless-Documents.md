Official documents:
# Browserless Docs MCP

Connect to Browserless documentation directly from your IDE or AI tool.

## Setup​

URL: `https://browserless-docs.mcp.kapa.ai`

Setup steps vary depending on which AI assistant you're using.

- Cursor
- VS Code
- Claude Code
- ChatGPT Desktop
- Claude Desktop
- Other

Add the following to your `.cursor/mcp.json` file:

```
{  "mcpServers": {    "browserless": {      "type": "http",      "url": "https://browserless-docs.mcp.kapa.ai"    }  }}
```

For more information, see the [Cursor MCP documentation](https://cursor.com/docs/context/mcp#using-mcpjson).

Prerequisites: VS Code 1.102+ with GitHub Copilot enabled.

Create an `mcp.json` file in your workspace `.vscode` folder:

.vscode/mcp.json

```
{  "servers": {    "browserless": {      "type": "http",      "url": "https://browserless-docs.mcp.kapa.ai"    }  }}
```

For more details, see the [VS Code MCP documentation](https://code.visualstudio.com/docs/copilot/customization/mcp-servers).

Run the following command in your terminal:

```
claude mcp add browserless https://browserless-docs.mcp.kapa.ai
```

For more information, see the [Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp).

ChatGPT Desktop supports MCP servers in developer mode:

1. Open ChatGPT Desktop.
2. Go to Settings > Features.
3. Enable Developer mode.
4. Navigate to Settings > MCP Servers.
5. Click Add Server and enter:

Name: browserless
URL: https://browserless-docs.mcp.kapa.ai

For more information, see the [ChatGPT Desktop MCP documentation](https://platform.openai.com/docs/guides/developer-mode).

Add to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```
{  "mcpServers": {    "browserless": {      "type": "http",      "url": "https://browserless-docs.mcp.kapa.ai"    }  }}
```

Restart Claude Desktop for changes to take effect.

For more details, see the [Claude Desktop documentation](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp).

MCP is an open protocol supported by many clients. Use the server URL `https://browserless-docs.mcp.kapa.ai` and refer to your client's documentation for setup instructions.

Most clients accept the standard MCP JSON configuration format:

```
{  "mcpServers": {    "browserless": {      "url": "https://browserless-docs.mcp.kapa.ai"    }  }}
```

## What you can do​

Once connected, you can ask context-aware questions about Browserless from within your editor. For example:

- "How do I connect to Browserless with Puppeteer?"
- "What are the available stealth options?"
- "How do I solve CAPTCHAs with BrowserQL?"

# Browserless MCP Server

The Browserless MCP server gives AI assistants full browser automation capabilities through the [Model Context Protocol](https://modelcontextprotocol.io/). Connect Claude Desktop, Cursor, VS Code, Windsurf, or any MCP-compatible client to the hosted server and start scraping, searching, mapping, exporting, downloading, and running custom browser code — no infrastructure required.

## Prerequisites​

- A Browserless account — either an API token from your account dashboard, or OAuth sign-in
- An MCP-compatible client (Claude Desktop, Cursor, VS Code, Windsurf, etc.)

## Hosted Server​

Browserless provides a hosted MCP server ready to use:

```
https://mcp.browserless.io/mcp
```

No installation or environment variables required. See [Authentication](https://docs.browserless.io/mcp/browserless-mcp-server#authentication) for how to connect.

## Authentication​

The hosted server supports three authentication methods:

| Method | Best for |
| --- | --- |
| OAuth (Browserless account login) | Clients that support OAuth — no token needed |
| Authorization header | Clients that support custom headers |
| token query parameter | URL-only clients (e.g. Claude.ai custom connectors) |

When multiple methods are present, they are evaluated in this order: `Authorization` header (plain API key) → `token` query parameter → OAuth JWT.

### OAuth​

For clients that support OAuth (e.g. Claude Desktop, Cursor), the hosted server can authenticate you through your Browserless account — no API token required. When you connect, your client will open a browser window to sign in. After authenticating, the server resolves your API key automatically.

OAuth is enabled on the hosted server at `https://mcp.browserless.io/mcp` with no extra configuration needed.

### API Token​

Pass your API token as a Bearer header or query parameter:

- Header (recommended): Authorization: Bearer your-token-here
- Query parameter: ?token=your-token-here

## Client Setup​

- Claude.ai
- Claude Desktop
- Cursor
- VS Code
- Windsurf

Claude.ai supports MCP servers via custom connectors. Since the connector form only accepts a URL, pass your token as a query parameter:

1. Go to Settings > Connectors in Claude.ai.
2. Click Add custom connector.
3. Enter a name (e.g., Browserless) and the following URL:

```
https://mcp.browserless.io/mcp?token=your-token-here
```

1. Click Add.

Add to your `claude_desktop_config.json`:

```
{  "mcpServers": {    "browserless": {      "url": "https://mcp.browserless.io/mcp",      "headers": {        "Authorization": "Bearer your-token-here"      }    }  }}
```

Add to your Cursor MCP settings:

```
{  "mcpServers": {    "browserless": {      "url": "https://mcp.browserless.io/mcp",      "headers": {        "Authorization": "Bearer your-token-here"      }    }  }}
```

Add to your VS Code settings (`settings.json`):

```
{  "mcp": {    "servers": {      "browserless": {        "type": "http",        "url": "https://mcp.browserless.io/mcp",        "headers": {          "Authorization": "Bearer your-token-here"        }      }    }  }}
```

Add to your Windsurf MCP configuration:

```
{  "mcpServers": {    "browserless": {      "url": "https://mcp.browserless.io/mcp",      "headers": {        "Authorization": "Bearer your-token-here"      }    }  }}
```

Replace `your-token-here` with your Browserless API token from the [account dashboard](https://account.browserless.io/).

tip

Clients that support OAuth (like Claude Desktop) can connect without a token — the server will prompt you to sign in with your Browserless account.

## Regional Endpoints​

By default, the hosted MCP server connects to the **US West (San Francisco)** Browserless region. To use a different region, pass the endpoint as a header or query parameter:

| Region | Endpoint |
| --- | --- |
| US West — San Francisco (default) | https://production-sfo.browserless.io |
| Europe — London | https://production-lon.browserless.io |
| Europe — Amsterdam | https://production-ams.browserless.io |

**Using the x-browserless-api-url header** (for clients that support headers):

```
{  "mcpServers": {    "browserless": {      "url": "https://mcp.browserless.io/mcp",      "headers": {        "Authorization": "Bearer your-token-here",        "x-browserless-api-url": "https://production-sfo.browserless.io"      }    }  }}
```

**Using the browserlessUrl query parameter** (for URL-only clients like Claude.ai):

```
https://mcp.browserless.io/mcp?token=your-token-here&browserlessUrl=https://production-sfo.browserless.io
```

## Tools​

The MCP server exposes six tools to your AI assistant:

### browserless_smartscraper​

Scrapes any webpage using cascading strategies — HTTP fetch, proxy, headless browser, and CAPTCHA solving — automatically selecting the best approach.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| url | string | Yes | — | The URL to scrape (http or https) |
| formats | string[] | No | ["markdown"] | Output formats: markdown, html, screenshot, pdf, links |
| timeout | number | No | 30000 | Request timeout in milliseconds |

**Output formats:**

- markdown — Page content converted to clean Markdown (default)
- html — Raw HTML of the page
- screenshot — Full-page screenshot as a PNG image
- pdf — PDF rendering of the page
- links — All links found on the page

### browserless_function​

Executes custom Puppeteer JavaScript code on the Browserless cloud. Your function receives a Puppeteer `page` object and optional `context` data, and returns `{ data, type }` to control the response payload and Content-Type.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| code | string | Yes | JavaScript (ESM) code to execute. The default export receives { page, context } and should return { data, type } |
| context | object | No | Optional context object passed to the function |
| timeout | number | No | Request timeout in milliseconds |

### browserless_download​

Runs custom Puppeteer code and returns the file that Chrome downloads during execution. Useful for downloading CSVs, PDFs, images, or any file from a website.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| code | string | Yes | JavaScript (ESM) code that triggers a file download in the browser |
| context | object | No | Optional context object passed to the function |
| timeout | number | No | Request timeout in milliseconds |

### browserless_export​

Exports a webpage by URL in its native format (HTML, PDF, image, etc.). Set `includeResources` to bundle all page assets into a ZIP archive for offline use.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| url | string | Yes | The URL to export (http or https) |
| gotoOptions | object | No | Puppeteer Page.goto() options (waitUntil, timeout, referer) |
| bestAttempt | boolean | No | When true, proceed even if awaited events fail or timeout |
| includeResources | boolean | No | Bundle all linked resources (CSS, JS, images) into a ZIP file |
| waitForTimeout | number | No | Milliseconds to wait after page load before exporting |
| timeout | number | No | Request timeout in milliseconds |

### browserless_search​

Searches the web using Browserless and optionally scrapes each result. Performs web searches via SearXNG and can return results from web, news, or images. Optionally scrape each result URL to get markdown, HTML, links, or screenshots.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| query | string | Yes | — | The search query string |
| limit | number | No | 10 | Maximum number of results to return (capped by plan limits) |
| lang | string | No | "en" | Language code for search results |
| country | string | No | — | Country code for geo-targeted results |
| location | string | No | — | Location string for geo-targeted results |
| tbs | string | No | — | Time-based filter: day, week, month, year |
| sources | string[] | No | ["web"] | Search sources: web, news, images |
| categories | string[] | No | — | Filter by categories: github, research, pdf |
| scrapeOptions | object | No | — | Options for scraping each search result (see below) |
| timeout | number | No | 30000 | Request timeout in milliseconds |

**Scrape options** (optional sub-object on `scrapeOptions`):

| Parameter | Type | Description |
| --- | --- | --- |
| formats | string[] | Output formats for scraped content: markdown, html, links, screenshot |
| onlyMainContent | boolean | Extract only the main content using Readability |
| includeTags | string[] | Only include content from these HTML tags |
| excludeTags | string[] | Exclude content from these HTML tags |

### browserless_map​

Discovers and maps all URLs on a website using Browserless. Crawls a site via sitemaps and link extraction to find all pages. Returns a list of URLs with optional titles and descriptions. Use the `search` parameter to order results by relevance to a query.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| url | string | Yes | — | The base URL to start mapping from (http or https) |
| search | string | No | — | Search query to order results by relevance |
| limit | number | No | 100 | Maximum number of links to return (max: 5000) |
| sitemap | string | No | "include" | Sitemap handling: include, skip, only |
| includeSubdomains | boolean | No | true | Include URLs from subdomains |
| ignoreQueryParameters | boolean | No | true | Exclude URLs with query parameters |
| timeout | number | No | 30000 | Request timeout in milliseconds |

### Example Usage​

Ask your AI assistant:

> Scrape https://example.com and summarize the content.

> Take a screenshot and extract all links from https://example.com.

> Download the CSV export from https://example.com/report.

> Export https://example.com as a full offline ZIP with all assets.

> Search for "headless browser automation" and summarize the top 5 results.

> Map all the pages on https://example.com and list them.

## Resources​

The MCP server also exposes these resources that your AI assistant can read:

| Resource | Description |
| --- | --- |
| browserless://api-docs | Smart Scraper API documentation and parameter reference |
| browserless://status | Live status of the Browserless API connection |

## Prompt Templates​

Built-in prompt templates help your AI assistant use the tools effectively:

| Prompt | Description |
| --- | --- |
| scrape-url | Scrape a webpage and summarize its content |
| extract-content | Extract specific information from a webpage using custom instructions |

## Further Reading​

- Browserless Account Dashboard — Get your API token
- REST APIs — Direct REST API access
- BrowserQL — GraphQL-based browser automation
- MCP Overview — Compare Browserless MCP servers
- AI Integrations — Other AI platform integrations




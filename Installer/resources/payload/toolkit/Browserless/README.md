# Browserless MCP Tool

Advanced browser automation for LLM agents and workflows, powered by [Browserless.io](https://browserless.io). This package provides Model Context Protocol (MCP) tool integration for web scraping, search, site mapping, export, BrowserQL, and custom Puppeteer code execution.

## Features

- **Smart Scraper**: Cascading strategies (HTTP fetch, proxy, headless browser, CAPTCHA solving)
- **BrowserQL**: GraphQL-based stealth-first extraction — recommended for dynamic/JS-heavy sites
- **Custom Function**: Execute Puppeteer JavaScript code on Browserless cloud
- **Download**: Trigger file downloads via Puppeteer
- **Export**: Export webpages in native format (HTML, PDF, image, ZIP)
- **Search**: Web search via SearXNG with optional result scraping
- **Map**: Discover and map all URLs on a website
- **Stealth Mode**: Bypass bot detection and CAPTCHAs
- **Regional Endpoints**: US West (SFO), Europe London, Europe Amsterdam

## Prerequisites

- Node.js 18+
- [Browserless.io](https://browserless.io) account (free tier available)
- API token from your [dashboard](https://browserless.io/account/)

## Installation

```bash
cd Browserless
npm install
npm run build
```

## LM Studio Configuration

Add to your LM Studio `mcp.json`:

```json
{
  "mcpServers": {
    "browserless": {
      "command": "node",
      "args": ["Browserless/dist/mcp-server.js"],
      "env": {
        "BROWSERLESS_DEFAULT_REGION": "production-sfo",
        "BROWSERLESS_DEFAULT_TIMEOUT_MS": "30000"
      }
    }
  }
}
```

> The `apiKey` parameter is **required** on every tool call. Pass your Browserless API token directly in each tool invocation — the LLM will include it from the MCP configuration.

## MCP Tools

The server exposes **7 tools**:

### browserless_smartscraper

Scrapes any webpage using cascading strategies — HTTP fetch, proxy, headless browser, and CAPTCHA solving.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| url | string | Yes | — | The URL to scrape |
| formats | string[] | No | ["markdown"] | Output formats: markdown, html, screenshot, pdf, links |
| timeout | number | No | 30000 | Request timeout in milliseconds |
| apiKey | string | Yes | — | Browserless API key |

### browserless_bql

Execute BrowserQL GraphQL mutations for robust extraction from dynamic, JS-heavy, or bot-protected sites. **Recommended over smartscraper for modern websites.**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| query | string | Yes | — | BrowserQL mutation string (must use `mutation {}` syntax) |
| timeout | number | No | 30000 | Request timeout in milliseconds |
| apiKey | string | Yes | — | Browserless API key |

**Example BQL mutation:**
```graphql
mutation {
  goto(url: "https://example.com", waitUntil: domContentLoaded) { status }
  text { text }
}
```

### browserless_function

Executes custom Puppeteer JavaScript code on the Browserless cloud.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| code | string | Yes | ESM code; default export receives `{ page, context }`, returns `{ data, type }` |
| context | object | No | Optional context object passed to the function |
| timeout | number | No | Request timeout in milliseconds |
| apiKey | string | Yes | Browserless API key |

### browserless_download

Runs custom Puppeteer code and returns the file Chrome downloads during execution.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| code | string | Yes | ESM code that triggers a file download |
| context | object | No | Optional context object |
| timeout | number | No | Request timeout in milliseconds |
| apiKey | string | Yes | Browserless API key |

### browserless_export

Exports a webpage by URL in its native format. Set `includeResources` to bundle all assets into a ZIP.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| url | string | Yes | The URL to export |
| gotoOptions | object | No | Puppeteer `Page.goto()` options |
| bestAttempt | boolean | No | Proceed even if awaited events fail |
| includeResources | boolean | No | Bundle CSS/JS/images into a ZIP |
| waitForTimeout | number | No | Wait (ms) after page load before exporting |
| timeout | number | No | Request timeout in milliseconds |
| apiKey | string | Yes | Browserless API key |

### browserless_search

Searches the web via SearXNG and optionally scrapes each result.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| query | string | Yes | — | Search query |
| limit | number | No | 10 | Max results |
| lang | string | No | "en" | Language code |
| country | string | No | — | Country code |
| location | string | No | — | Location string |
| tbs | string | No | — | Time filter: day, week, month, year |
| sources | string[] | No | ["web"] | web, news, images |
| categories | string[] | No | — | github, research, pdf |
| scrapeOptions | object | No | — | Per-result scrape options (formats, onlyMainContent, includeTags, excludeTags) |
| timeout | number | No | 30000 | Request timeout in milliseconds |
| apiKey | string | Yes | — | Browserless API key |

### browserless_map

Discovers and maps all URLs on a website via sitemaps and link extraction.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| url | string | Yes | — | Base URL to start mapping from |
| search | string | No | — | Query to order results by relevance |
| limit | number | No | 100 | Max links (up to 5000) |
| sitemap | string | No | "include" | include, skip, only |
| includeSubdomains | boolean | No | true | Include subdomain URLs |
| ignoreQueryParameters | boolean | No | true | Exclude query-parameter URLs |
| timeout | number | No | 30000 | Request timeout in milliseconds |
| apiKey | string | Yes | — | Browserless API key |

## Regional Endpoints

| Region | Endpoint |
|--------|----------|
| US West — San Francisco (default) | `https://production-sfo.browserless.io` |
| Europe — London | `https://production-lon.browserless.io` |
| Europe — Amsterdam | `https://production-ams.browserless.io` |

Set `BROWSERLESS_DEFAULT_REGION` to override. Accepts short names (`production-lon`), full URLs (`https://...`), or any custom region name (auto-prefixed with `https://`).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BROWSERLESS_DEFAULT_REGION` | `production-sfo` | Region name or full base URL |
| `BROWSERLESS_DEFAULT_TIMEOUT_MS` | `30000` | Default request timeout |

## Development

```bash
npm run dev:mcp   # Run MCP server with tsx (no build needed)
npm run build     # Compile TypeScript
npm run preflight # Validate configuration
```

## Testing

```bash
# From workspace root
npx jest Browserless/tests/utils.test.ts   # Unit tests for URL/auth helpers
npx jest Browserless/                       # All Browserless tests
```

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `401` / Invalid token | Wrong or missing API key | Pass a valid `apiKey` in the tool call |
| `Failed to parse URL` | Malformed region URL | Check `BROWSERLESS_DEFAULT_REGION` is a valid region name or full URL |
| Timeout | Page too slow | Increase `timeout` parameter |
| Empty results | Bot detection | Use `browserless_bql` with stealth mode |

## Resources

- [Browserless Docs](https://docs.browserless.io/)
- [BrowserQL Guide](https://docs.browserless.io/browserql/start)
- [REST API Reference](https://docs.browserless.io/rest-apis/intro)
- [MCP Server Docs](https://docs.browserless.io/ai-integrations/mcp)
- [Dashboard](https://browserless.io/account/)

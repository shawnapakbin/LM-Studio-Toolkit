# WebBrowser Tool (v2.1.0 — Headless Chromium)

Full headless Chromium browser powered by Playwright. Handles JavaScript-rendered pages, SPAs, cookie injection, screenshots, and structured markdown output. Backward compatible with v1 callers.

## Features

- **Full JS Rendering** — Playwright Chromium executes JavaScript before extraction (SPAs, React/Vue/Angular)
- **Selector Wait** — Wait for a specific DOM element before extracting content
- **Network Idle Wait** — Wait until all network requests settle
- **Cookie Injection** — Pass session cookies for authenticated pages
- **Screenshot Capture** — Returns a base64 PNG alongside text
- **Markdown Output** — Preserves heading hierarchy, links, lists, bold/italic
- **HTML Entity Decoding** — Handled natively by the browser DOM (no regex)
- **finalUrl** — Reports the post-redirect actual URL
- **JSON API Support** — `application/json` added to allowed content types
- **SSRF Protection** — Blocks private/loopback/link-local addresses before any browser call
- **Browser Pool** — Single Chromium instance reused across requests; pages isolated per request

## Endpoints

- `GET /health` — `{ ok: true, service: "lm-studio-web-browser-tool", version: "2.1.0" }`
- `GET /tool-schema` — Tool schema JSON
- `POST /tools/browse_web` — Fetch and extract content
- MCP: `node dist/mcp-server.js` (stdio)

**Default port**: `3334`

## Tool Schema

### `browse_web`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | `string` | Yes | — | Full URL (http/https only) |
| `timeoutMs` | `number` | No | `20000` | Navigation + wait timeout in ms |
| `maxContentChars` | `number` | No | `12000` | Content truncation limit |
| `waitForSelector` | `string` | No | — | CSS selector to wait for before extracting |
| `waitForNetworkIdle` | `boolean` | No | `false` | Use `networkidle` wait strategy |
| `screenshot` | `boolean` | No | `false` | Capture PNG screenshot |
| `cookies` | `CookieDef[]` | No | `[]` | Cookies to inject before navigation |
| `outputFormat` | `"text"\|"markdown"` | No | `"text"` | Content extraction format |

```typescript
interface CookieDef {
  name: string;
  value: string;
  domain: string; // e.g. ".example.com"
}
```

### Response

```json
{
  "success": true,
  "status": 200,
  "finalUrl": "https://example.com/redirected",
  "title": "Page Title",
  "content": "Extracted text or markdown...",
  "contentLength": 1234,
  "screenshotBase64": "iVBORw0KGgo..."
}
```

`screenshotBase64` is only present when `screenshot: true` and navigation succeeded.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BROWSER_HEADLESS` | `"true"` | Run Chromium headless (`"false"` for headed debug mode) |
| `BROWSER_EXECUTABLE_PATH` | — | Override Chromium binary path |
| `BROWSER_DEFAULT_TIMEOUT_MS` | `"20000"` | Default navigation timeout |
| `BROWSER_MAX_TIMEOUT_MS` | `"60000"` | Maximum allowed timeout |
| `BROWSER_MAX_CONTENT_CHARS` | `"12000"` | Maximum content characters |

## Setup

```bash
cd WebBrowser
npm install
npx playwright install chromium   # install Chromium binary
npm run build
```

## Example Calls

### Basic (backward compatible)
```bash
curl -X POST http://localhost:3334/tools/browse_web \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

### SPA with network idle + markdown
```bash
curl -X POST http://localhost:3334/tools/browse_web \
  -d '{"url":"https://app.example.com","waitForNetworkIdle":true,"waitForSelector":"#main","outputFormat":"markdown"}'
```

### Authenticated page with screenshot
```bash
curl -X POST http://localhost:3334/tools/browse_web \
  -d '{
    "url": "https://example.com/dashboard",
    "cookies": [{"name":"session","value":"abc123","domain":".example.com"}],
    "screenshot": true,
    "outputFormat": "markdown"
  }'
```

### JSON API endpoint
```bash
curl -X POST http://localhost:3334/tools/browse_web \
  -d '{"url":"https://api.example.com/data.json","timeoutMs":10000}'
```

## LM Studio Integration

```json
{
  "mcpServers": {
    "web-browser": {
      "command": "node",
      "args": ["WebBrowser/dist/mcp-server.js"],
      "env": {
        "BROWSER_DEFAULT_TIMEOUT_MS": "20000",
        "BROWSER_MAX_TIMEOUT_MS": "60000",
        "BROWSER_MAX_CONTENT_CHARS": "12000",
        "BROWSER_HEADLESS": "true"
      }
    }
  }
}
```

## Content Extraction

### `text` mode (default)
Whitespace-normalized plain text. Strips `<script>`, `<style>`, `<noscript>`, `<svg>`. HTML entities decoded natively by the browser DOM.

### `markdown` mode
Preserves document structure:
- `<h1>`–`<h6>` → `# ` through `###### `
- `<a href="...">text</a>` → `[text](url)`
- `<li>` → `- item`
- `<strong>`/`<b>` → `**text**`
- `<em>`/`<i>` → `_text_`

## Error Codes

| Code | Meaning |
|------|---------|
| `POLICY_BLOCKED` | SSRF-blocked URL or disallowed content type |
| `TIMEOUT` | Navigation or selector wait exceeded `timeoutMs` |
| `EXECUTION_FAILED` | Network error, browser crash, or unexpected failure |
| `INVALID_INPUT` | Malformed URL or invalid protocol |

## Implementation Notes

- Single Playwright `Browser` instance shared across all requests (lazy-launched, auto-reconnects on crash)
- Fresh `Page` per request — cookies and storage are isolated between calls
- `domcontentloaded` wait strategy by default; opt into `networkidle` explicitly
- SSRF validation runs before any Playwright call — private IPs never reach the browser
- `extractContent` runs inside the browser context via `page.evaluate()` — no regex HTML parsing

## License

Non-Commercial License. See ../LICENSE.
Original Author: Shawna Pakbin

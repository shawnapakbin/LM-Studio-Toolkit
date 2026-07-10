# Browserless MCP Integration

> **⚠️ DEPRECATED:** The custom Browserless MCP server has been deprecated.
> This module now delegates to the official hosted Browserless.io MCP server.
> See: <https://docs.browserless.io/>

## Overview

This module is a configuration wrapper that delegates all browser automation to the official hosted Browserless.io MCP endpoint. It no longer contains a custom MCP server implementation. The previous custom server source is preserved in the `legacy/` directory for reference only.

## Available Tools

The hosted Browserless MCP server provides the following tools:

- **smartscraper** — Intelligent content extraction from web pages
- **function** — Execute custom browser functions
- **download** — Download files from URLs
- **export** — Export page content in various formats
- **search** — Perform web searches
- **map** — Generate site maps
- **performance** — Measure page performance metrics
- **crawl** — Crawl websites and extract content
- **agent** — Autonomous browser agent for complex tasks

## Authentication

Authentication uses a Bearer token passed via the `BROWSERLESS_TOKEN` environment variable.

Set the token in your `.env` file:

```env
BROWSERLESS_TOKEN=your-api-token-here
```

The token is sent as an `Authorization: Bearer <token>` header with all requests to the Browserless API.

For backward compatibility, `BROWSERLESS_API_KEY` is accepted as a fallback if `BROWSERLESS_TOKEN` is not set.

## Regional Endpoints

Browserless.io provides the following regional endpoints:

| Region | Endpoint |
|--------|----------|
| San Francisco (default) | `https://production-sfo.browserless.io` |
| London | `https://production-lon.browserless.io` |
| Amsterdam | `https://production-ams.browserless.io` |

To use a specific region, set the `BROWSERLESS_API_URL` environment variable:

```env
BROWSERLESS_API_URL=https://production-lon.browserless.io
```

If `BROWSERLESS_API_URL` is not set, the San Francisco endpoint (`production-sfo`) is used by default.

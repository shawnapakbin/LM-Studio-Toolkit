# Browserless MCP Integration

This folder provides configuration and preflight validation for the official [`@browserless.io/mcp`](https://www.npmjs.com/package/@browserless.io/mcp) package.

## How It Works

The Browserless MCP server is invoked via `npx -y @browserless.io/mcp` — no local server code is maintained in this repository. The previous custom server implementation has been removed in favor of the official package, which provides upstream bug fixes, new tools, and reduced maintenance burden.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `BROWSERLESS_API_KEY` | Internal canonical env variable stored in `.env` |
| `BROWSERLESS_TOKEN` | Mapped from `BROWSERLESS_API_KEY` at runtime for the official package |
| `BROWSERLESS_API_URL` | Optional regional endpoint override |

The setup scripts automatically map `BROWSERLESS_API_KEY` to `BROWSERLESS_TOKEN` in the bridge config so the official package authenticates correctly.

## Preflight Check

The script at `scripts/preflight-check.js` validates that Node.js 24+ is available before the MCP server is launched. If the version requirement is not met, the setup process skips the Browserless bridge config and logs a warning.

Run it manually:

```bash
node Browserless/scripts/preflight-check.js
```

## Documentation

See [`Official-MCP-Document.md`](./Official-MCP-Document.md) for the full list of tools and capabilities provided by the official `@browserless.io/mcp` package.

## Migration Note

The custom MCP server (`Browserless/dist/mcp-server.js`) was removed as part of the migration to the official package. All browser automation is now handled by `@browserless.io/mcp`.

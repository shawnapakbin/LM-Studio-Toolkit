# Browserless MCP Integration

This folder provides a schema-proxy wrapper and preflight validation for the official [`@browserless.io/mcp`](https://www.npmjs.com/package/@browserless.io/mcp) package.

## How It Works

The Browserless MCP server is invoked via a **schema-proxy** (`scripts/schema-proxy.js`) that wraps the official `@browserless.io/mcp` package. The proxy spawns `npx -y @browserless.io/mcp` as a child process, intercepts the `tools/list` JSON-RPC response, and replaces complex tool schemas with flat, grammar-safe equivalents that LM Studio's llama.cpp GBNF parser can handle.

### Why a Proxy?

The official `@browserless.io/mcp` v1.7.2+ exposes tool schemas with:
- Non-anchored regex `pattern` fields (e.g. `"^https?:\\/\\/"` missing `$`)
- Internal `$ref` JSON pointers that can't be resolved in isolation
- Deeply nested `anyOf` discriminated unions (20+ command variants)

These break LM Studio's structured output grammar generation, causing `"failed to parse grammar"` errors that prevent ALL tools from working — not just browserless. The proxy replaces these with simple, flat schemas while the real server still validates payloads server-side.

### Architecture

```
LM Studio ←→ schema-proxy.js ←→ npx @browserless.io/mcp ←→ Browserless API
              (stdio proxy)       (real MCP server)
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `BROWSERLESS_API_KEY` | Internal canonical env variable stored in `.env` |
| `BROWSERLESS_TOKEN` | Mapped from `BROWSERLESS_API_KEY` at runtime for the official package |
| `BROWSERLESS_API_URL` | Optional regional endpoint override |

The setup scripts automatically map `BROWSERLESS_API_KEY` to `BROWSERLESS_TOKEN` in the bridge config so the official package authenticates correctly.

## Security — Token Handling and Rotation

- Source the token **only** from your user config: `BROWSERLESS_API_KEY` in your local `.env` (or `browserless.apiKey` in `llm-toolkit.config.yaml`). The canonical default is empty, and the value is injected at install/runtime from your config — it is never hardcoded in source and must never be committed to version control.
- If a Browserless token has ever been exposed — shared, committed, or observed in a generated `mcp-bridge-config.json` — treat it as **compromised**. Rotate/revoke it from the [Browserless dashboard](https://browserless.io/account/) and issue a new one, then update your `.env` and re-run setup.
- Rotation/revocation is a **manual operational step** you perform in your Browserless account; the toolkit cannot do it for you.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/schema-proxy.js` | Stdio proxy that wraps `@browserless.io/mcp` with grammar-safe schemas |
| `scripts/preflight-check.js` | Validates Node.js 24+ before the MCP server is launched |

### Running the Proxy Manually

```bash
node Browserless/scripts/schema-proxy.js
```

This is what LM Studio invokes via the bridge config. Environment variables (`BROWSERLESS_TOKEN`, etc.) are passed through to the child process.

### Running the Preflight Check

```bash
node Browserless/scripts/preflight-check.js
```

## LM Studio Bridge Config

The setup script generates this config in `~/.lmstudio/mcp.json`:

```json
{
  "browserless": {
    "command": "node",
    "args": ["C:/path/to/llm-toolkit/Browserless/scripts/schema-proxy.js"],
    "env": {
      "BROWSERLESS_TOKEN": "your-token-here"
    }
  }
}
```

## Documentation

See [`Official-MCP-Document.md`](./Official-MCP-Document.md) for the full list of tools and capabilities provided by the official `@browserless.io/mcp` package.

## Troubleshooting

### "Pattern must start with '^' and end with '$'"

The schema-proxy is not active. Verify the bridge config points to `schema-proxy.js`, not directly to `npx @browserless.io/mcp`.

### "Failed to initialize samplers: failed to parse grammar"

The proxy's simplified schemas may need updating for a newer version of `@browserless.io/mcp`. Check if the package added new tools with complex schemas and add entries to the `SAFE_SCHEMAS` map in `schema-proxy.js`.

### "spawn EINVAL" or "spawn ENOENT"

Node.js can't find `npx`. Ensure Node.js 24+ is installed and on PATH. The proxy uses `shell: true` on Windows to resolve `.cmd` files.

### Browserless tools return 401

`BROWSERLESS_TOKEN` is empty or invalid. Set `BROWSERLESS_API_KEY` in your `.env` file and re-run `node scripts/setup/setup.js`.

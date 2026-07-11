# Frequently Asked Questions

Common issues and solutions encountered when running this toolkit.

---

## Browserless MCP Tool

### Q: After changing my Browserless API key in LM Studio, I get `Cannot find module '...Browserless/dist/mcp-server.js'`. Why?

> **Note:** This FAQ entry applies to the **legacy** internal Browserless MCP server (prior to v2 migration). The current setup uses `npx -y @browserless.io/mcp` and does not require a local `dist/` build. If you're seeing this error, run `npm run sync` to regenerate your LM Studio config.

**Symptom**

LM Studio logs show:

```
Error: Cannot find module 'C:\Users\<you>\.lmstudio\extensions\plugins\mcp\browserless\Browserless\dist\mcp-server.js'
```

**Fix (current architecture)**

Run `npm run sync` from the toolkit root. This regenerates the `mcp-bridge-config.json` to use the official hosted Browserless.io MCP server:

```json
{
  "command": "npx",
  "args": ["-y", "@browserless.io/mcp"],
  "env": {
    "BROWSERLESS_TOKEN": "your-token-here",
    "BROWSERLESS_API_URL": ""
  }
}
```

Restart LM Studio after syncing.

---

### Q: All `browserless_*` tools fail with `Failed to parse URL from production-sfo/smartscraper?token=...`

**Symptom**

Every Browserless tool call returns:

```json
{ "error": "Failed to parse URL from production-sfo/smartscraper?token=..." }
```

**Root cause**

`getRegionUrl("production-sfo")` was returning the bare string `"production-sfo"` instead of the fully-qualified URL `"https://production-sfo.browserless.io"`. The function had no explicit case for the default region name, so it fell through and returned the raw input. Every HTTP request was then sent to `production-sfo/smartscraper?token=...` — a malformed URL the Browserless server could not parse.

**Fix**

This was fixed in the codebase by adding an explicit match for `"production-sfo"` in `getRegionUrl` (`Browserless/src/utils.ts`):

```ts
export function getRegionUrl(region?: string): string {
  if (!region || region === "production-sfo") return "https://production-sfo.browserless.io";
  if (region === "production-lon") return "https://production-lon.browserless.io";
  if (region === "production-ams") return "https://production-ams.browserless.io";
  if (region.startsWith("http")) return region;
  return `https://${region}.browserless.io`;
}
```

If you see this error on an older build, run `npm run build` from the `Browserless/` directory to pick up the fix.

---

### Q: My API key was accidentally committed to the repository. What should I do?

1. **Rotate the key immediately** — go to https://account.browserless.io/ and generate a new token. The old one is compromised regardless of whether you remove it from git history.
2. **Replace the key locally** — update your `.env` file with the new key. The `.env` file is gitignored and safe.
3. **Never store keys in tracked files** — `.vscode/mcp.json` is now gitignored in this project. Use environment variables or LM Studio's `env` block in `mcp-bridge-config.json` instead.

---

### Q: Where should I store my Browserless API key?

| Location | Safe to commit? | Notes |
|----------|----------------|-------|
| `.env` | No (gitignored) | Loaded automatically by `dotenv` at runtime |
| `private.md` | No (gitignored) | Personal notes, never published |
| `mcp-bridge-config.json` | No (LM Studio local config) | Lives in `~/.lmstudio/`, not in the repo |
| `.vscode/mcp.json` | No (gitignored) | IDE config, machine-specific |
| Tool call `apiKey` parameter | Depends on caller | Passed at runtime by the LLM from its config |

Never hardcode a key in any file that is tracked by git.

---

## ECM (Context Memory)

### Q: Why did my session suddenly show a summary segment and fewer old turns?

ECM auto-compaction likely triggered.

Auto-compaction runs when estimated context pressure crosses the configured threshold:

```
estimated_used_tokens / ECM_MODEL_CONTEXT_LIMIT >= ECM_AUTO_COMPACT_THRESHOLD
```

By default, the threshold is `0.70`. ECM then summarizes older segments, keeps the newest `N` segments, and purges compacted history.

Controls:
1. Disable threshold auto-compaction globally:
   - Set `ECM_AUTO_COMPACT_ENABLED=false`
2. Tune when it triggers:
   - `ECM_AUTO_COMPACT_THRESHOLD`
   - `ECM_MODEL_CONTEXT_LIMIT`
3. Force compaction manually for a session:
   - Call ECM action `auto_compact_now` with `sessionId` and optional `keepNewest`

You can also inspect `retrieve_context` response telemetry (`autoCompaction`) to confirm whether compaction ran and which strategy was used.

### Q: My hardware is slow and prompts keep getting longer. How do I keep context small?

Enable **continuous compact** mode. When active, ECM compacts after every stored response — keeping only the highlights of everything before the most recent turn(s).

Enable per-session (recommended):
```json
{ "action": "set_continuous_compact", "sessionId": "my-session", "enabled": true, "keepNewest": 1 }
```

Enable globally via environment variable:
```
ECM_CONTINUOUS_COMPACT_ENABLED=true
ECM_CONTINUOUS_COMPACT_KEEP_NEWEST=1
```

`keepNewest: 1` means only the very latest turn is kept in full; everything older becomes a rolling summary. This minimises active context size and keeps generation time consistent even across long conversations. Increase `keepNewest` if you need more recent context preserved verbatim.

### Q: What is the difference between threshold auto-compaction and continuous compact?

| | Threshold mode | Continuous compact mode |
|---|---|---|
| When it fires | When token pressure reaches a ratio threshold | After every single stored response |
| Best for | Normal hardware, balanced context size | Slow/older hardware with limited VRAM |
| Trigger | `used_tokens / model_context_limit >= threshold` | Always (after `store_segment`) |
| Configure | `ECM_AUTO_COMPACT_ENABLED` / `ECM_AUTO_COMPACT_THRESHOLD` | `ECM_CONTINUOUS_COMPACT_ENABLED` or `set_continuous_compact` |
| Scope | Global (all sessions) | Global env default **or** per-session override |

Both modes use the same hybrid extractive + LLM highlights compaction pipeline.

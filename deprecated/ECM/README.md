# ECM — Enhanced Context Memory

ECM has **one job**: when the active context window approaches its limit,
compact older conversation segments into a single LLM-generated highlights
summary so the chat can keep going without hitting the cap.

It is intentionally minimal. There is no retrieval, no embeddings, no
continuous-mode background loop, no policy table. Just compaction.

## How it works

The chat client (or the model itself, via the MCP tool) is expected to call
`ecm.on_user_turn` at the start of every user message. ECM looks at the
session's current usage ratio:

```
ratio = currentUsedTokens / contextLimit
```

- `ratio < threshold` (default `0.5`) → no-op, returns a friendly status.
- `ratio >= threshold` → ECM picks the oldest non-summary segments past
  `keepNewest` (default `4`), asks the configured LLM to produce a
  highlights/decisions/unresolved/next-actions summary, persists that
  summary as a `summary`-typed segment, and deletes the originals.
- If the LLM call fails the conversation is **left untouched** and ECM
  returns `compacted: false, reason: "llm_error"`.

The response always carries a natural-language `message` and an
`etaSeconds` hint so the client can let the user know what's happening
before the round-trip finishes.

## MCP tool surface

Tool name: `ecm`. Four actions:

### `on_user_turn`

Compaction trigger. Should be called every user turn.

| field               | type     | required | default  | description                                                              |
| ------------------- | -------- | -------- | -------- | ------------------------------------------------------------------------ |
| `sessionId`         | string   | yes      |          | Session namespace.                                                       |
| `currentUsedTokens` | number   | no       |          | Authoritative usage from the chat client. Falls back to internal count.  |
| `contextLimit`      | number   | no       | env      | Authoritative model limit. Falls back to `ECM_MODEL_CONTEXT_LIMIT`.      |
| `threshold`         | number   | no       | `0.5`    | Trigger ratio in (0, 1].                                                 |
| `keepNewest`        | integer  | no       | `4`      | Newest segments preserved verbatim.                                      |

Result fields:

```ts
{
  compacted: boolean;
  reason: "below_threshold" | "not_enough_segments" | "compacted" | "in_progress" | "llm_error";
  ratio: number;
  estimatedUsedTokens: number;
  contextLimit: number;
  threshold: number;
  keepNewest: number;
  message: string;       // natural-language status, show this to the user
  etaSeconds: number;    // rough ETA pre-compaction; 0 once complete
  summarySegmentId?: string;
  segmentsRemoved?: number;
  summaryTokenCount?: number;
  error?: string;        // present iff reason === "llm_error"
}
```

### `store_segment`

Persist one conversation turn / tool output / document fragment.

| field        | type                                                                                               | required | default              |
| ------------ | -------------------------------------------------------------------------------------------------- | -------- | -------------------- |
| `sessionId`  | string                                                                                             | yes      |                      |
| `type`       | `"conversation_turn"` \| `"tool_output"` \| `"document"` \| `"reasoning"` \| `"summary"`           | no       | `conversation_turn`  |
| `content`    | string                                                                                             | yes      |                      |
| `importance` | number 0–1                                                                                         | no       | `0.5`                |
| `metadata`   | object                                                                                             | no       |                      |

### `clear_session`

Drop every segment for the given session.

### `get_status`

Returns `{ segmentCount, nonSummarySegmentCount, estimatedUsedTokens }`.

## HTTP surface

Same four actions over `POST /tools/ecm`. Default port `3342`
(`ECM_PORT` to override). Health: `GET /health`. Schema: `GET /tool-schema`.

## Environment variables

| name                       | default              | description                                                            |
| -------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `ECM_DB_PATH`              | `../ecm.db`          | SQLite path. `:memory:` for ephemeral. Absolute paths supported.       |
| `ECM_PORT`                 | `3342`               | HTTP port.                                                             |
| `ECM_MODEL_CONTEXT_LIMIT`  | `8192`               | Fallback context-window size when the caller omits `contextLimit`.     |
| `ECM_COMPACTOR_MODE`       | `lmstudio`           | `lmstudio` or `mock` (deterministic fallback for tests / offline use). |
| `ECM_COMPACTOR_MODEL`      | `qwen2.5-7b-instruct`| LM Studio model id used when mode = `lmstudio`.                        |

## Database migration

ECM v3 dropped the `embedding_json` column and the `ecm_session_policy`
table. On startup, if either of those is detected the existing DB file is
renamed to `ecm.db.bak-<ISO timestamp>` and a fresh schema is created. No
manual migration is needed.

## Scripts

```bash
npm run dev:mcp     # stdio MCP server
npm run dev         # HTTP server on :3342
npm run build       # compile to dist/
npm test            # jest
```

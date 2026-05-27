# SlashCommands (v2.1.0)

MCP server that exposes the executable `slash_command` tool and discovery helpers. When you type `/command` in LM Studio chat, the LLM calls `slash_command` automatically and routes the request to the appropriate tool via HTTP.

## How It Works

- `parser.ts` — tokenizes the raw input, extracts `--flag <value>` and `--flag` boolean flags, handles quoted strings
- `router.ts` — maps the parsed `DispatchDescriptor` to tool HTTP endpoints; `/compact` and `/ecm compact` forward to ECM `on_user_turn`; `/tools health` runs parallel health checks
- `mcp-server.ts` — registers `slash_command` (execution) plus discovery helpers: `slash_commands_help` (canonical) and `slash_commands_list` (compatibility alias with the same output)

## Setup

### Build

```bash
npm run build:slash
```

### LM Studio `mcp.json`

```json
{
  "mcpServers": {
    "slash-commands": {
      "command": "node",
      "args": ["SlashCommands/dist/mcp-server.js"],
      "env": {
        "SLASH_DEFAULT_SESSION": "default"
      }
    }
  }
}
```

Run `npm run mcp:print-config` to get the full generated config with correct absolute paths.

## Supported Commands

| Command | Routes to |
|---|---|
| `/compact` | ECM `on_user_turn` (manual compaction trigger) |
| `/ecm store\|status\|clear\|compact` | ECM tool (port 3342) |
| `/calc <expr>` | Calculator tool (port 3335) |
| `/browse <url>` | WebBrowser tool (port 3334) |
| `/clock` | Clock tool (port 3337) |
| `/run <cmd>` | Terminal tool (port 3333) |
| `/python run\|repl\|idle` | PythonShell tool (port 3343) |
| `/skills list\|run\|get` | Skills tool (port 3341) |
| `/rag query\|ingest\|list` | RAG tool (port 3339) |
| `/ask <prompt>` | AskUser tool (port 3338) |
| `/tools list\|health\|schema` | All tool endpoints |
| `/memory stats\|history\|patterns` | AgentRunner SQLite (direct query) |
| `/config show` | CLI config |
| `/workflow run <file>` | AgentRunner (port 3330) |

See [docs/SLASH-COMMANDS.md](../docs/SLASH-COMMANDS.md) for the full command reference with flags and examples.

Python command behavior:
- `/python repl` opens the plain terminal Python REPL.
- `/python idle` launches the Python IDLE GUI shell/editor.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SLASH_DEFAULT_SESSION` | `default` | Default ECM session ID for `/compact` and `/ecm` commands |
| `TERMINAL_PORT` | `3333` | Terminal tool port |
| `WEBBROWSER_PORT` | `3334` | WebBrowser tool port |
| `CALCULATOR_PORT` | `3335` | Calculator tool port |
| `CLOCK_PORT` | `3337` | Clock tool port |
| `ASKUSER_PORT` | `3338` | AskUser tool port |
| `RAG_PORT` | `3339` | RAG tool port |
| `SKILLS_PORT` | `3341` | Skills tool port |
| `ECM_PORT` | `3342` | ECM tool port |

## Development

```bash
npm run dev:mcp   # Run MCP server with tsx (no build needed)
npm run build     # Compile TypeScript to dist/
npm test          # Run tests
```

## License

Non-Commercial License (Commercial use requires a separate negotiated agreement with royalties). See ../LICENSE.
Original Author: Shawna Pakbin

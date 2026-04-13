# LLM Toolkit CLI

Two ways to invoke the toolkit:

1. **Terminal CLI** — `llm <command>` from your shell (this document)
2. **LM Studio chat** — type `/command` in the chat window and the LLM executes it via MCP (see [docs/SLASH-COMMANDS.md](../docs/SLASH-COMMANDS.md))

Both interfaces cover the same tools. The CLI is for scripting and automation; slash commands are for interactive use inside LM Studio.

## Install & Build

```bash
npm install
npm run build:cli
```

Then link the binary globally (optional):

```bash
npm link --workspace=CLI
```

Or run directly with tsx during development:

```bash
npx tsx CLI/src/index.ts <command>
```

---

## Commands

### Tool Management

| Command | Description |
|---|---|
| `llm tools list` | List all registered tools and their endpoints |
| `llm tools health` | Health-check all tools (or `--tool <name>` for one) |
| `llm tools schema <tool>` | Print the input schema for a tool |

### Calculator

| Command | Description |
|---|---|
| `llm calc "<expr>"` | Evaluate a math expression |
| `llm calc "<expr>" -p <digits>` | With custom precision |

### Web Browser

| Command | Description |
|---|---|
| `llm browse <url>` | Fetch and render a URL (markdown output by default) |
| `llm browse <url> -f text` | Plain text output |
| `llm browse <url> -s` | Capture a screenshot |
| `llm browse <url> --wait-selector <css>` | Wait for element before extracting |

### Clock

| Command | Description |
|---|---|
| `llm clock` | Get current date/time |
| `llm clock -z America/New_York` | With timezone |
| `llm clock -f iso` | Specific format: iso \| locale \| unix |

### Terminal

| Command | Description |
|---|---|
| `llm terminal "<cmd>"` | Execute a shell command via the Terminal tool |
| `llm run "<cmd>"` | Alias for `terminal` |
| `llm terminal "<cmd>" -d <dir>` | With working directory |
| `llm terminal "<cmd>" --timeout <ms>` | With timeout |

### PythonShell

| Command | Description |
|---|---|
| `llm python run "<code>"` | Execute non-interactive Python code via PythonShell |
| `llm python run "<code>" -d <dir>` | Run in a specific working directory |
| `llm python run "<code>" --timeout <ms>` | Set execution timeout |
| `llm python repl` | Open Python REPL in a visible shell |
| `llm python idle` | Launch Python IDLE shell |

### Skills

| Command | Description |
|---|---|
| `llm skills list` | List all defined skills |
| `llm skills get <name>` | Get details of a skill |
| `llm skills run <name>` | Execute a skill |
| `llm skills run <name> -p '{"key":"val"}'` | With params |
| `llm skills define <file.json>` | Define a skill from a JSON file |
| `llm skills delete <name>` | Delete a skill |

### Memory (AgentRunner history)

| Command | Description |
|---|---|
| `llm memory stats` | Show run success rates and average durations |
| `llm memory history` | List recent workflow runs (default: 20) |
| `llm memory history -n 50` | Show last 50 runs |
| `llm memory patterns` | List successful tool sequences |
| `llm memory clear` | Wipe all run history (prompts for confirmation) |
| `llm memory clear --confirm` | Skip confirmation |

### ECM (Extended Context Memory)

| Command | Description |
|---|---|
| `llm ecm store -c "<text>"` | Store a memory segment |
| `llm ecm retrieve -q "<query>"` | Retrieve relevant segments by query |
| `llm ecm list` | List all segments in a session |
| `llm ecm delete <segmentId>` | Delete a segment by ID |
| `llm ecm summarize` | Summarize session and collapse old segments |
| `llm ecm clear` | Clear all segments in a session |
| `llm ecm compact` | **Compact context** — summarize + drop old segments |

### /compact (top-level shortcut)

```bash
llm compact
llm compact --session my-session
llm compact --keep-newest 10
```

Runs `summarize_session` on the ECM session, then reports remaining segment count. Use this to free up context memory when a session grows large.

### RAG

| Command | Description |
|---|---|
| `llm rag query "<text>"` | Query the knowledge base |
| `llm rag query "<text>" -k 5` | Limit to top-5 results |
| `llm rag ingest "<text>"` | Ingest text into the knowledge base |
| `llm rag ingest "<text>" --source label` | With source label |
| `llm rag list` | List all ingested sources |
| `llm rag delete <sourceId>` | Delete a source |

### AskUser

| Command | Description |
|---|---|
| `llm ask "<prompt>"` | Trigger a clarification interview |
| `llm ask "<prompt>" --title "My Interview"` | With title |
| `llm ask "<prompt>" --expires 300` | Expires in 300 seconds |

### Workflow

| Command | Description |
|---|---|
| `llm workflow run <file.json>` | Execute a workflow from a JSON file |
| `llm workflow run <file.json> -s <id>` | With a session ID |
| `llm workflow run <file.json> --auto-approve` | Auto-approve blocked write steps |
| `llm workflow run <file.json> --timeout <ms>` | Override global workflow timeout |

---

## Optional / Planned Commands

These are identified as useful additions for future implementation:

- `llm workflow status <run-id>` — check status of a running workflow
- `llm workflow list` — list all workflow definitions
- `llm doc scrape <url-or-path>` — extract structured content via DocumentScraper
- `llm git status` — run git status via the Git tool
- `llm git commit -m "<msg>"` — commit via the Git tool
- `llm git diff` — show current diff via the Git tool
- `llm git log` — show recent commits via the Git tool
- `llm file read <path>` — read a file via the FileEditor tool
- `llm file write <path> <content>` — write a file via the FileEditor tool
- `llm file patch <path>` — apply a patch via the FileEditor tool
- `llm pkg install <package>` — install a package via PackageManager tool
- `llm pkg list` — list installed packages
- `llm build run` — trigger a build via the BuildRunner tool
- `llm build status` — check build status
- `llm observe logs` — tail Observability logs
- `llm observe metrics` — dump current metrics snapshot
- `llm observe trace <traceId>` — look up a trace by ID
- `llm session new` — create a new named ECM session
- `llm session list` — list active ECM sessions
- `llm session switch <id>` — set the default session for subsequent commands
- `llm config show` — print current CLI config (ports, session, etc.)
- `llm config set <key> <value>` — override a config value

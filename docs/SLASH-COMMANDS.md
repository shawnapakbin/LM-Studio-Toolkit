# Slash Commands

Slash commands let you control the LLM Toolkit directly from the LM Studio chat window. Type a `/command` as your message and the LLM will recognize it and invoke the corresponding tool automatically — no terminal required.

This works because the system prompt instructs the model to intercept messages that begin with `/` and route them to the appropriate MCP tool call before responding.

---

## Setup

Add the `slash-commands` MCP server to your LM Studio `mcp.json`. The server registers a single `slash_command` tool — the LLM sees it in its tool list and calls it automatically whenever you type a `/command` in chat. No system prompt required.

```json
"slash-commands": {
  "command": "node",
  "args": ["SlashCommands/dist/mcp-server.js"]
}
```

Run `npm run mcp:print-config` to get the full generated config with correct paths.

---

## Available Commands

### Help

| Command | What it does |
|---|---|
| `/help` | Show all available slash commands with usage |

### Context Memory

| Command | What it does |
|---|---|
| `/compact` | Summarize the current ECM session and drop old segments to free context memory |
| `/compact --keep-newest <n>` | Compact but keep the N most recent segments intact |
| `/ecm store <text>` | Store a memory segment in the current session |
| `/ecm retrieve <query>` | Retrieve relevant memory segments by semantic query |
| `/ecm list` | List all segments in the current session |
| `/ecm summarize` | Summarize the session without clearing it |
| `/ecm clear` | Clear all segments in the current session |

### Calculator

| Command | What it does |
|---|---|
| `/calc <expression>` | Evaluate a math expression — e.g. `/calc sin(30°)` |
| `/calc <expression> --precision <n>` | With custom significant digits |

### Web Browser

| Command | What it does |
|---|---|
| `/browse <url>` | Fetch and render a URL (markdown output) |
| `/browse <url> --format text` | Plain text output |
| `/browse <url> --screenshot` | Capture a screenshot of the page |

### Clock

| Command | What it does |
|---|---|
| `/clock` | Get the current date and time |
| `/clock --timezone <tz>` | With a specific IANA timezone — e.g. `America/New_York` |

### Terminal

| Command | What it does |
|---|---|
| `/run <command>` | Execute a shell command — e.g. `/run ls -la` |
| `/run <command> --cwd <dir>` | Run in a specific working directory |

### PythonShell

| Command | What it does |
|---|---|
| `/python run <code>` | Execute non-interactive Python code via PythonShell |
| `/python run <code> --cwd <dir>` | Run Python code in a specific working directory |
| `/python run <code> --timeout <ms>` | Set execution timeout |
| `/python repl` | Open Python REPL in a visible shell |
| `/python idle` | Launch Python IDLE shell |

### Skills

| Command | What it does |
|---|---|
| `/skills list` | List all defined skills |
| `/skills run <name>` | Execute a skill by name |
| `/skills run <name> --params <json>` | Execute with parameters |
| `/skills get <name>` | Show details of a skill |

### RAG (Knowledge Base)

| Command | What it does |
|---|---|
| `/rag query <text>` | Query the RAG knowledge base |
| `/rag ingest <text>` | Ingest text into the knowledge base |
| `/rag list` | List all ingested sources |

### Memory (Workflow History)

| Command | What it does |
|---|---|
| `/memory stats` | Show workflow run success rates and durations |
| `/memory history` | List recent workflow runs |
| `/memory patterns` | Show successful tool sequences learned from history |

### Tools

| Command | What it does |
|---|---|
| `/tools list` | List all registered tools and their endpoints |
| `/tools health` | Health-check all tools |
| `/tools schema <tool>` | Show the input schema for a specific tool |

### AskUser

| Command | What it does |
|---|---|
| `/ask <prompt>` | Trigger a clarification interview workflow |

---

## How It Works

The `slash_command` MCP tool is registered in LM Studio alongside the other tools. When you type `/compact` or `/calc sin(30°)` in chat, the LLM recognizes the `/` prefix from the tool's description and calls `slash_command` with your raw input. The MCP server parses the command, dispatches it to the right tool via HTTP, and returns the result — all without touching the system prompt.

For this to work:
1. The relevant tool servers must be running (see [INSTALL.md](../INSTALL.md))
2. `SlashCommands/dist/mcp-server.js` must be registered in your LM Studio `mcp.json`
3. Run `npm run build:slash` to build the server

---

## Optional / Planned Commands

These are identified for future implementation:

- `/workflow run <file>` — execute a full multi-step workflow
- `/workflow status <run-id>` — check a running workflow
- `/doc scrape <url>` — extract structured content via DocumentScraper
- `/git status` — git status via the Git tool
- `/git commit -m "<msg>"` — commit via the Git tool
- `/git diff` — show current diff
- `/git log` — show recent commits
- `/file read <path>` — read a file via FileEditor
- `/file write <path>` — write a file via FileEditor
- `/pkg install <package>` — install a package via PackageManager
- `/build run` — trigger a build via BuildRunner
- `/observe logs` — tail Observability logs
- `/observe metrics` — dump current metrics
- `/session new` — create a new named ECM session
- `/session list` — list active ECM sessions
- `/session switch <id>` — switch the active session
- `/config show` — show current tool configuration

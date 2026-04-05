# LM Studio Tools - Terminal

Local HTTP tool server that lets an LM Studio local model execute terminal commands.

## What this provides
- `GET /tool-schema` returns a tool definition for `run_terminal_command` (includes OS detection)
- `POST /tools/run_terminal_command` executes a command and returns output
- `GET /health` health check endpoint
- MCP stdio server: `dist/mcp-server.js`

## How LM Studio Uses This Tool

**This tool is accessed via HTTP/MCP by LM Studio.** When you are an LLM running in LM Studio:

1. **Do NOT try to determine the OS yourself** — the tool provides it for you
2. **Do NOT try to directly call shell commands** — use the Tool API
3. **Instead:**
   - Read the tool schema (provided by LM Studio or call `/tool-schema`)
   - Look at `operating_system` field to see which OS is running
   - Look at `os_specific_commands` to see the right syntax for each task
   - Call the tool with the OS-appropriate command

### Example Flow for LLMs

1. **LM Studio provides tool schema** → Contains `operating_system: "Windows"` and `os_specific_commands`
2. **You decide to list files** → Look up `os_specific_commands.list_files` → See it's `"dir"` on Windows
3. **You call the tool**: `run_terminal_command(command="dir")`
4. **LM Studio invokes** `POST http://localhost:3333/tools/run_terminal_command` with `{"command": "dir"}`
5. **You get back:** `{"success": true, "code": 0, "stdout": "...", "stderr": "", "timeoutMs": 60000}`

**You do not need to manually check the environment, determine the OS, or make HTTP calls yourself. Just use the Tool interface.**

## Setup
1. Install dependencies:
   - `npm install`
2. Copy env file:
   - `copy .env.example .env`
3. Start in dev mode:
   - `npm run dev`
4. Build (required for MCP `mcp.json` path to `dist`):
   - `npm run build`

Server default URL: `http://localhost:3333`

## Operating System Detection

The Terminal tool **automatically detects the operating system** (Windows, macOS, or Linux) and includes this information in the tool schema. LLMs can read the `operating_system` field to determine which commands to use:

- **Windows**: Use `dir`, `type`, `del`, `copy`, `findstr`, etc.
- **macOS/Linux**: Use `ls`, `cat`, `rm`, `cp`, `grep`, `find`, etc.

The tool also provides OS-specific command examples in the `os_specific_commands` field so LLMs know the exact syntax for each task.

**See [USAGE_FOR_LLMS.md](USAGE_FOR_LLMS.md) for detailed usage guidance.**

### OS-Specific Command Examples

| Task | Windows | macOS/Linux |
|------|---------|-------------|
| List files | `dir` | `ls -la` |
| List detailed | `dir /s` | `find . -type f` |
| Check current dir | `cd` | `pwd` |
| Change directory | `cd project\subdir` | `cd project/subdir` |
| Copy file | `copy source dest` | `cp source dest` |
| Delete file | `del file` | `rm file` |
| Find files | `findstr /S pattern .` | `find . -name '*.ts'` |
| View file | `type file.txt` | `cat file.txt` |

### Example tool call

```bash
curl -X POST http://localhost:3333/tools/run_terminal_command ^
  -H "Content-Type: application/json" ^
  -d "{\"command\":\"Get-Location\",\"timeoutMs\":15000}"
```

Response:
```json
{
  "success": true,
  "code": 0,
  "stdout": "C:\\Users\\spakb\\Development\\",
  "stderr": "",
  "timeoutMs": 15000
}
```

## LM Studio `mcp.json`

```json
{
  "mcpServers": {
    "terminal": {
      "command": "node",
      "args": ["Terminal/dist/mcp-server.js"],
      "env": {
        "TERMINAL_DEFAULT_TIMEOUT_MS": "60000",
        "TERMINAL_MAX_TIMEOUT_MS": "120000"
      }
    }
  }
}
```

**Tip**: From repo root, run `npm run mcp:print-config` to print a ready-to-paste config with absolute paths for your current folder.

You can run MCP mode directly for testing with (from `Terminal` folder):
- `npm run dev:mcp`
- or built output: `npm run start:mcp`

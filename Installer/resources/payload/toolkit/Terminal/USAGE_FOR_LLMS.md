# Terminal Tool Usage Guide for LLMs

**⚠️ CRITICAL: You are an LLM. Do NOT try to determine the OS or access the filesystem yourself. Use the Terminal tool provided to you.**

This document explains how to effectively use the Terminal tool in conversations and agent workflows.

## Quick Reference

| Property | Value |
|----------|-------|
| **Tool Name** | `run_terminal_command` |
| **What It Does** | Executes shell commands and returns stdout/stderr |
| **Best Uses** | Building, testing, file operations, Git commands, script execution |
| **Never Use For** | Interactive shells (vim, node REPL, python shell), commands expecting input |
| **Default Timeout** | 60 seconds |
| **Max Timeout** | 120 seconds |
| **OS Detection** | ✅ The tool auto-detects Windows, macOS, or Linux |

## 🚫 Do NOT (Critical Rules for LLMs)

**You cannot directly access system resources.** Instead, use the Terminal tool. Here's what you CANNOT do:

| Do NOT | Why | What to Do Instead |
|--------|-----|-------------------|
| `require('os')` or `import os` | You don't have access to full Node.js/Python in the agent context | The tool provides `operating_system` in the schema |
| `fs.readFile()` or `fs.writeFile()` | No filesystem access | Use `cat`/`type` to read; the tool executes commands |
| `process.env.VARIABLE` | No direct environment variable access | Use `set`/`env` commands or set `cwd` parameter |
| `uname`, `systeminfo`, `ver` | Don't try to detect OS yourself | Read `operating_system` from the tool schema (provided for you) |
| Interactive commands (`vim`, `node` REPL, `python` shell) | They wait for input that you cannot provide | Use non-interactive equivalents (cat/type for viewing, python script.py for running) |

## Operating System Detection (CRITICAL)

**The Terminal tool automatically detects the operating system and includes it in the tool schema.**

When you read the tool definition, you will find:
- `operating_system`: The detected OS name ("Windows", "macOS", or "Linux")
- `os_specific_commands`: A map of commands appropriate for that OS

**CRITICAL RULE**: Use ONLY commands appropriate for the detected OS:
- On **Windows**: Use `dir` (not `ls`), `type` (not `cat`), `del` (not `rm`), `findstr` (not `grep`)
- On **macOS/Linux**: Use `ls` (not `dir`), `cat` (not `type`), `rm` (not `del`), `grep` (not `findstr`)

### OS-Specific Command Map

The tool provides `os_specific_commands` with these keys:

| Key | Windows | macOS/Linux |
|-----|---------|-------------|
| `list_files` | `dir` | `ls -la` |
| `list_files_detailed` | `dir /s` | `find . -type f` |
| `current_dir` | `cd` | `pwd` |
| `change_dir` | `cd project\subdir` | `cd project/subdir` |
| `copy_file` | `copy source dest` | `cp source dest` |
| `delete_file` | `del file` | `rm file` |
| `find_files` | `findstr /S pattern .` | `find . -name '*.ts'` |
| `view_file` | `type file.txt` | `cat file.txt` |

**Always refer to `os_specific_commands` when you need to know the correct syntax for a task.**

## Workflow

### 1. Read the Operating System
- Check the `operating_system` field in the tool schema (e.g., "Windows", "macOS", "Linux")
- Refer to `os_specific_commands` for the correct command syntax
- Plan your command using ONLY commands appropriate for that OS

### 2. Plan the Command
- Decide exactly what you want to do (list files, run tests, compile, etc.)
- Look up the correct command in `os_specific_commands` for your OS
- If unsure, use the exploration command: `cd` (Windows) or `pwd` (macOS/Linux)

### 3. Call the Tool
- Required: `command` (string, must be appropriate for the detected OS)
- Optional: `timeoutMs` (number, 1–120000, default 60000)
- Optional: `cwd` (string, absolute path recommended)

### 4. Check the Response
- Always inspect `success` (true/false)
- Always read both `stdout` and `stderr`
- Note the `code` (exit code: 0=success, non-zero=error)

### 5. Interpret Results
- **success=true, code=0**: Command worked. Use stdout for results.
- **success=false, code≠0**: Command failed. Read stderr for error.
- **signal set**: Process was killed (SIGTERM, SIGKILL, etc.)

### 6. Follow Up (if needed)
- If a command fails, diagnose from stderr
- Use the OS-specific command to confirm working directory: `cd` (Windows) or `pwd` (macOS/Linux)
- Break complex chains into separate commands
- Always use the correct OS-specific command syntax for the next attempt

## Example Scenarios

### Scenario 1: Run Tests (OS-agnostic)
```json
{
  "command": "npm test",
  "timeoutMs": 30000
}
```

### Scenario 2: List Files (Windows)
```json
{
  "command": "dir src\\",
  "cwd": "C:\\Users\\spakb\\Development\\project"
}
```

### Scenario 2b: List Files (macOS/Linux)
```json
{
  "command": "ls -la src/",
  "cwd": "./"
}
```

### Scenario 3: Find TypeScript Files
```json
{
  "command": "find . -name '*.ts' -type f | head -50"
}
```

### Scenario 4: Check Git Status
```json
{
  "command": "git status"
}
```

## Anti-Patterns (❌ What NOT to Do)

| Anti-Pattern | Why It Fails | Fix |
|--------------|-------------|-----|
| **OS Mismatch** | Using `ls` on Windows or `dir` on Linux | Check `operating_system` field and use `os_specific_commands` |
| `ls -la` on Windows | Command not found error | Use `dir` on Windows |
| `dir` on macOS/Linux | Command not found error | Use `ls -la` on macOS/Linux |
| `cat` on Windows | Command may not exist | Use `type` on Windows |
| `vim file.txt` | Interactive editor; will hang | Use `cat` (Unix) or `type` (Windows) |
| `node` (alone) | Starts REPL; expects input | Use `node script.js` to run a file |
| `python` (alone) | Starts Python shell; expects input | Use `python script.py` to run a file |
| Assume command works | May fail silently | Always check `success` and `stderr` |
| Guess working directory | May run in wrong folder | Use `cd` (Windows) or `pwd` (macOS/Linux) to check |
| Huge unpiped output | May truncate or timeout | Use `grep` or `findstr` to filter output |

## Response Structure

Every call returns this JSON:

```json
{
  "success": true|false,
  "code": 0|non-zero,
  "signal": "SIGTERM|SIGKILL|null",
  "stdout": "command output text",
  "stderr": "error output text or empty",
  "timeoutMs": 60000
}
```

### Key Fields Explained

- **success**: `true` if exit code was 0; `false` otherwise
- **code**: The Unix exit code (0 = success)
- **signal**: Signal name if process was forcefully terminated
- **stdout**: Standard output from the command
- **stderr**: Error messages or warnings; **check this first if success=false**
- **timeoutMs**: Actual timeout applied (capped at 120s)

## Common Tasks & Commands

| Task | Windows | Mac/Linux |
|------|---------|----------|
| List files | `dir` | `ls -la` |
| Current directory | `cd` (shows path) | `pwd` |
| Change directory | `cd project\subdir` | `cd project/subdir` |
| Copy file | `copy file1 file2` | `cp file1 file2` |
| Delete file | `del file` | `rm file` |
| Run tests | `npm test` | `npm test` |
| Build project | `npm run build` | `npm run build` |
| Check git | `git status` | `git status` |
| View file | `type file.txt` | `cat file.txt` |
| Search in file | `findstr pattern file` | `grep pattern file` |

## Timeout Guidance

- **Quick operations** (ls, pwd, git status): default 60s is fine
- **Tests**: usually 30–60s, increase if slow
- **Builds**: use `timeoutMs: 120000` (full max)
- **Scripts**: depends on script; start with 30s, increase if needed

## Troubleshooting

| Problem | Diagnosis | Solution |
|---------|-----------|----------|
| Command not found | stderr says "command not found" | Check spelling or install tool |
| Permission denied | stderr says "permission denied" | Use appropriate permissions |
| Wrong directory | stdout shows unexpected results | Check `pwd` first; set explicit `cwd` |
| Timeout | `success=false`, no output | Increase `timeoutMs` or break into smaller commands |
| No output | `stdout` empty, `success=true` | Command may succeed silently; check stderr |

## Integration with LM Studio

When LM Studio provides this tool to a local model:

1. The model reads the tool definition (from `/tool-schema` endpoint)
2. The model fills in `command` and optional parameters
3. LM Studio calls `POST /tools/run_terminal_command` with the parameters
4. The tool executes the command and returns the JSON response
5. LM Studio shows the result to the model
6. The model interprets the result and decides next steps

Make sure you understand:
- ✅ Always check `success` flag
- ✅ Always read `stderr` when `success=false`
- ✅ Use piping to limit large output
- ✅ Never use interactive commands
- ✅ Set reasonable timeouts for slow operations

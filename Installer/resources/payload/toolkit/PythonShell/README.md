# PythonShell MCP Tool

MCP tool that gives LLMs access to Python 3 execution, Python REPL launch, and Python IDLE launch.

## Tools

- `python_run_code`: run non-interactive Python code using `-c`.
- `python_open_repl`: open the plain Python terminal REPL in a visible shell window.
- `python_open_idle`: launch Python IDLE GUI shell/editor (`python -m idlelib`).

## REPL vs IDLE

- Use `python_open_repl` for terminal-based stdin/stdout interactive Python.
- Use `python_open_idle` when you want the IDLE GUI shell/editor instead of the terminal REPL.

If Python 3 is missing, all tools return install guidance with the official download URL:
https://www.python.org/downloads/

## Build

```bash
npm run -w PythonShell build
```

## Run MCP server

```bash
npm run -w PythonShell start:mcp
```

# PythonShell MCP Tool

MCP tool that gives LLMs access to Python 3 execution, Python REPL launch, and Python IDLE launch.

## Tools

- `python_run_code`: run non-interactive Python code using `-c`.
- `python_open_repl`: open Python REPL in a visible terminal window.
- `python_open_idle`: launch Python IDLE (`python -m idlelib`).

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

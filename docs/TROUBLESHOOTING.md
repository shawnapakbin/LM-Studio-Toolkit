# MCP Toolkit Troubleshooting

## Browser Tools

### Browser fetch fails

Symptoms:
- fetch failed
- empty content from websites

Checks:

```bash
node -e "fetch('https://example.com').then(()=>console.log('ok')).catch(e=>console.error(e.message))"
```

Fixes:
- ensure MCP_USE_PLAYWRIGHT=1 for modern JS-heavy sites
- repair host CA trust
- temporary workaround: MCP_INSECURE_TLS=1
- if environment is sandboxed, start proxy gateway with npm run proxy

### Proxy-specific errors

Symptoms:
- connection refused to 127.0.0.1:8765

Fixes:
- start proxy gateway: npm run proxy
- verify: curl http://127.0.0.1:8765
- restart LM Studio/client after proxy starts

## Terminal Tools

### Command rejected

Symptom:
- Command not allowed

Fix:
- add command to ALLOWED_TERMINAL_COMMANDS or set ALLOWED_TERMINAL_COMMANDS=* if you want unrestricted mode

### No output returned

Cause:
- TERMINAL_PUNCHOUT=1 without capture enabled

Fix options:
- capture-only: remove TERMINAL_PUNCHOUT
- hybrid: set both TERMINAL_PUNCHOUT=1 and TERMINAL_CAPTURE_WITH_PUNCHOUT=1
- interactive capture (for sudo): set all three — TERMINAL_PUNCHOUT=1, TERMINAL_CAPTURE_WITH_PUNCHOUT=1, TERMINAL_PUNCHOUT_WAIT_FOR_EXIT=1

### Punchout launcher not found

Fix:
- install a launcher (x-terminal-emulator, gnome-terminal, konsole, xfce4-terminal, xterm)
- or set TERMINAL_PUNCHOUT_CMD to a valid launcher path

### Punchout wait timed out

Symptom:
- timed out waiting for punchout completion

Cause:
- TERMINAL_PUNCHOUT_WAIT_FOR_EXIT=1 is enabled and the command did not finish before timeout

Fix options:
- increase TERMINAL_PUNCHOUT_WAIT_TIMEOUT_MS (default: 180000)
- set TERMINAL_PUNCHOUT_WAIT_KEEP_OPEN=1 to keep the terminal open after completion
- for captured output without interactive requirement, use hybrid mode (TERMINAL_CAPTURE_WITH_PUNCHOUT=1, no TERMINAL_PUNCHOUT_WAIT_FOR_EXIT)

### Sudo askpass helper not configured

Symptom:
- sudo command requires askpass, but no helper was configured

Cause:
- TERMINAL_REQUIRE_ASKPASS_FOR_SUDO=1 is enabled without TERMINAL_SUDO_ASKPASS or SUDO_ASKPASS

Fix:
- set TERMINAL_SUDO_ASKPASS to an absolute helper path
- or export SUDO_ASKPASS before starting the terminal MCP server

## Filesystem Tools

### Path outside allowed root

Cause:
- FS_ROOT sandbox restriction

Fix:
- set FS_ROOT to the intended workspace path in MCP server env

## RAG Tools

### Embeddings fail

Cause:
- LM Studio embeddings endpoint unavailable

Fix:
- ensure LM_STUDIO_URL is correct
- verify endpoint availability

```bash
curl http://localhost:1234/v1/embeddings
```

### No search results

Cause:
- no documents ingested yet

Fix:
- use ingest_webpage or store_document first
- confirm with list_documents

## Client Configuration

Use one of these as source of truth:
- .generated/lmstudio-mcp.json (created by install scripts)
- mcp-json.md (manual template)

After edits, restart LM Studio/client to reload MCP servers.

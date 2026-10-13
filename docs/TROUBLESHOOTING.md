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

## Terminal Tools

### Command rejected

Symptom:
- Command not allowed

Fix:
- add command to ALLOWED_TERMINAL_COMMANDS or set ALLOWED_TERMINAL_COMMANDS=* if you want unrestricted mode

### Punchout & sudo/askpass

Full setup and configuration is documented in [QUICKSTART-SUDO.md](QUICKSTART-SUDO.md). Quick symptom → fix:

| Symptom | Fix |
|---------|-----|
| No output returned (`TERMINAL_PUNCHOUT=1` without capture) | Use hybrid mode: set `TERMINAL_CAPTURE_WITH_PUNCHOUT=1` (add `TERMINAL_PUNCHOUT_WAIT_FOR_EXIT=1` for interactive sudo) |
| Punchout launcher not found | Install a launcher (gnome-terminal, konsole, xterm) or set `TERMINAL_PUNCHOUT_CMD` |
| Punchout wait timed out | Increase `TERMINAL_PUNCHOUT_WAIT_TIMEOUT_MS` or set `TERMINAL_PUNCHOUT_WAIT_KEEP_OPEN=1` |
| Sudo askpass helper not configured | Set `TERMINAL_SUDO_ASKPASS` (absolute path) or export `SUDO_ASKPASS` |

See [QUICKSTART-SUDO.md](QUICKSTART-SUDO.md) for the complete walkthrough.

## Client Configuration

The toolkit uses a plugin-only configuration model — the sole supported method. All 9 servers are provisioned automatically as LM Studio plugins; there is no config file to edit by hand.

```bash
npm run mcp:sync-lmstudio   # (re)provision all toolkit plugins
```

After syncing, restart LM Studio to reload MCP servers. See [mcp-json.md](mcp-json.md) for how registration works.

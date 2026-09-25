# Quick Start: Internet Access

## Default Mode (Direct Access)

Browser tools use direct network access by default.

```bash
npm run build
```

If you run through LM Studio, provision the toolkit plugins with `npm run mcp:sync-lmstudio` and restart LM Studio. See [mcp-json.md](mcp-json.md) for the plugin-only registration model.

## Useful Checks

```bash
# direct fetch check
node -e "fetch('https://example.com').then(()=>console.log('ok')).catch(e=>console.error(e.message))"
```

## Security Notes

- For TLS issues, prefer fixing host CA trust
- MCP_INSECURE_TLS=1 is a temporary workaround only

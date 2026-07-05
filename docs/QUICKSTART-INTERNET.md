# Quick Start: Internet Access

## Default Mode (Direct Access)

Browser tools use direct network access by default.

```bash
npm run build
npm run start:browser
```

If you run through LM Studio, configure servers using mcp-json.md (or .generated/lmstudio-mcp.json) and restart LM Studio.

## Optional Proxy Mode

Use the proxy gateway only if your host/client sandbox blocks direct outbound access.

```bash
npm run proxy
```

Then restart your client and retry browser tools.

## When to Use Proxy

Use proxy mode if you see network errors such as fetch failed, connection blocked, or sandbox restrictions.

## Useful Checks

```bash
# direct fetch check
node -e "fetch('https://example.com').then(()=>console.log('ok')).catch(e=>console.error(e.message))"

# proxy check
curl http://127.0.0.1:8765
```

## Security Notes

- Proxy listens on localhost only (127.0.0.1)
- For TLS issues, prefer fixing host CA trust
- MCP_INSECURE_TLS=1 is a temporary workaround only

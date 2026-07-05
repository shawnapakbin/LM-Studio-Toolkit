# MCP Proxy Gateway - Systemd Service (Optional)

If you want the proxy to start automatically on boot:

## Create User Service

```bash
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/mcp-proxy.service << 'EOF'
[Unit]
Description=MCP Proxy Gateway for LM Studio
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/spakbin/MCP
ExecStart=/usr/bin/node /home/spakbin/MCP/dist/servers/proxy-gateway.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
```

## Enable and Start

```bash
# Reload systemd user daemon
systemctl --user daemon-reload

# Enable to start on boot
systemctl --user enable mcp-proxy.service

# Start now
systemctl --user start mcp-proxy.service

# Check status
systemctl --user status mcp-proxy.service
```

## View Logs

```bash
journalctl --user -u mcp-proxy.service -f
```

## Stop and Disable

```bash
systemctl --user stop mcp-proxy.service
systemctl --user disable mcp-proxy.service
```

---

This is **optional** - only use if you want the proxy always available.

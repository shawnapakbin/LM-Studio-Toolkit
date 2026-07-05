#!/bin/bash
# Install MCP Proxy Gateway as a systemd user service
# This enables automatic startup on boot

set -e

echo "🔧 Installing MCP Proxy Gateway as systemd service..."

# Ensure build is up-to-date
echo "Building project..."
npm run build

# Create systemd user directory
mkdir -p ~/.config/systemd/user

# Create service file
cat > ~/.config/systemd/user/mcp-proxy.service << EOF
[Unit]
Description=MCP Proxy Gateway for LM Studio Internet Access
Documentation=file://$PWD/QUICKSTART-INTERNET.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$PWD
ExecStart=/usr/bin/node $PWD/dist/servers/proxy-gateway.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
EOF

# Reload systemd
systemctl --user daemon-reload

# Enable and start service
systemctl --user enable mcp-proxy.service
systemctl --user start mcp-proxy.service

echo ""
echo "✅ MCP Proxy Gateway installed and started!"
echo ""
echo "📊 Service Status:"
systemctl --user status mcp-proxy.service --no-pager || true
echo ""
echo "🔍 Check logs with: journalctl --user -u mcp-proxy.service -f"
echo "🛑 Stop service with: systemctl --user stop mcp-proxy.service"
echo "🔄 Restart service with: systemctl --user restart mcp-proxy.service"
echo ""
echo "🎉 Browser tools will now work in LM Studio automatically!"
echo "   Just restart LM Studio and the proxy will be ready."

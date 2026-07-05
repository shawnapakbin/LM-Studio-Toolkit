#!/bin/bash
# Uninstall MCP Proxy Gateway systemd service

set -e

echo "🗑️  Uninstalling MCP Proxy Gateway service..."

# Stop and disable service
systemctl --user stop mcp-proxy.service 2>/dev/null || true
systemctl --user disable mcp-proxy.service 2>/dev/null || true

# Remove service file
rm -f ~/.config/systemd/user/mcp-proxy.service

# Reload systemd
systemctl --user daemon-reload

echo ""
echo "✅ MCP Proxy Gateway service uninstalled!"
echo ""
echo "To manually run proxy when needed:"
echo "  npm run proxy"

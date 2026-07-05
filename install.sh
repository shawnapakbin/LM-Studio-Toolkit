#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "MCP Toolkit installer"
echo "====================="

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is not installed. Install Node.js 20+ and retry."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is not installed. Install npm and retry."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "ERROR: Node.js 20+ is required. Current version: $(node -v)"
  exit 1
fi

echo "Node: $(node -v)"
echo "npm: $(npm -v)"

echo "Installing dependencies..."
if [[ -f package-lock.json ]]; then
  if ! npm ci; then
    echo "npm ci failed, falling back to npm install"
    npm install
  fi
else
  npm install
fi

echo "Building project..."
npm run build

if [[ "${SKIP_TYPECHECK:-0}" != "1" ]]; then
  echo "Running typecheck..."
  npm run typecheck
else
  echo "Skipping typecheck because SKIP_TYPECHECK=1"
fi

mkdir -p .generated

NODE_BIN="$(command -v node)"

cat > .generated/lmstudio-mcp.json <<EOF
{
  "mcpServers": {
    "browser-tools": {
      "command": "${NODE_BIN}",
      "args": ["${SCRIPT_DIR}/dist/servers/browser.js"],
      "env": {
        "MCP_USE_PLAYWRIGHT": "1",
        "MCP_INSECURE_TLS": "1"
      }
    },
    "terminal-tools": {
      "command": "${NODE_BIN}",
      "args": ["${SCRIPT_DIR}/dist/servers/terminal.js"],
      "env": {
        "ALLOWED_TERMINAL_COMMANDS": "*",
        "TERMINAL_PUNCHOUT": "1",
        "TERMINAL_CAPTURE_WITH_PUNCHOUT": "1",
        "TERMINAL_PUNCHOUT_WAIT_FOR_EXIT": "1"
      }
    },
    "filesystem-tools": {
      "command": "${NODE_BIN}",
      "args": ["${SCRIPT_DIR}/dist/servers/filesystem.js"],
      "env": {
        "FS_ROOT": "${SCRIPT_DIR}"
      }
    },
    "calculator-tools": {
      "command": "${NODE_BIN}",
      "args": ["${SCRIPT_DIR}/dist/servers/calculator.js"]
    },
    "calendar-tools": {
      "command": "${NODE_BIN}",
      "args": ["${SCRIPT_DIR}/dist/servers/calendar.js"]
    },
    "rag-tools": {
      "command": "${NODE_BIN}",
      "args": ["${SCRIPT_DIR}/dist/servers/rag.js"],
      "env": {
        "LM_STUDIO_URL": "http://localhost:1234",
        "RAG_DATA_DIR": "${SCRIPT_DIR}/rag-data",
        "MCP_INSECURE_TLS": "1"
      }
    }
  }
}
EOF

# Copy bundled askpass helper
cp "${SCRIPT_DIR}/scripts/mcp-askpass.sh" "${SCRIPT_DIR}/.generated/mcp-askpass.sh"
chmod +x "${SCRIPT_DIR}/.generated/mcp-askpass.sh"

echo
echo "Install complete."
echo "Generated LM Studio config: .generated/lmstudio-mcp.json"
echo "Askpass helper:             .generated/mcp-askpass.sh"
echo "Next steps:"
echo "1) Open LM Studio > Settings > MCP Servers"
echo "2) Paste JSON from .generated/lmstudio-mcp.json"
echo "3) Restart LM Studio"
echo
echo "Sudo support: sudo commands open an interactive terminal window by default."
echo "For a GUI password dialog instead, see QUICKSTART-SUDO.md"

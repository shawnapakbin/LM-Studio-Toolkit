$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $PSCommandPath
Set-Location $scriptDir

Write-Host "MCP Toolkit installer"
Write-Host "====================="

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "ERROR: node is not installed. Install Node.js 20+ and retry."
  exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "ERROR: npm is not installed. Install npm and retry."
  exit 1
}

$nodeVersionRaw = node -v
$nodeMajor = [int]($nodeVersionRaw.TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) {
  Write-Host "ERROR: Node.js 20+ is required. Current version: $nodeVersionRaw"
  exit 1
}

Write-Host "Node: $nodeVersionRaw"
Write-Host "npm: $(npm -v)"

Write-Host "Installing dependencies..."
if (Test-Path "package-lock.json") {
  npm ci
  if ($LASTEXITCODE -ne 0) {
    Write-Host "npm ci failed, falling back to npm install"
    npm install
  }
} else {
  npm install
}

Write-Host "Building project..."
npm run build

if ($env:SKIP_TYPECHECK -ne "1") {
  Write-Host "Running typecheck..."
  npm run typecheck
} else {
  Write-Host "Skipping typecheck because SKIP_TYPECHECK=1"
}

New-Item -ItemType Directory -Path ".generated" -Force | Out-Null

$nodeBin = (Get-Command node).Source
$config = @{
  mcpServers = @{
    "browser-tools" = @{
      command = $nodeBin
      args = @("$scriptDir\dist\servers\browser.js")
      env = @{
        MCP_USE_PLAYWRIGHT = "1"
        MCP_INSECURE_TLS = "1"
      }
    }
    "terminal-tools" = @{
      command = $nodeBin
      args = @("$scriptDir\dist\servers\terminal.js")
      env = @{
        ALLOWED_TERMINAL_COMMANDS = "*"
        TERMINAL_PUNCHOUT = "1"
        TERMINAL_CAPTURE_WITH_PUNCHOUT = "1"
        TERMINAL_PUNCHOUT_WAIT_FOR_EXIT = "1"
      }
    }
    "filesystem-tools" = @{
      command = $nodeBin
      args = @("$scriptDir\dist\servers\filesystem.js")
      env = @{
        FS_ROOT = $scriptDir
      }
    }
    "calculator-tools" = @{
      command = $nodeBin
      args = @("$scriptDir\dist\servers\calculator.js")
    }
    "calendar-tools" = @{
      command = $nodeBin
      args = @("$scriptDir\dist\servers\calendar.js")
    }
    "rag-tools" = @{
      command = $nodeBin
      args = @("$scriptDir\dist\servers\rag.js")
      env = @{
        LM_STUDIO_URL = "http://localhost:1234"
        RAG_DATA_DIR = "$scriptDir\rag-data"
        MCP_INSECURE_TLS = "1"
      }
    }
  }
}

$config | ConvertTo-Json -Depth 10 | Set-Content -Path ".generated\lmstudio-mcp.json" -Encoding UTF8

Write-Host ""
Write-Host "Install complete."
Write-Host "Generated LM Studio config: .generated\lmstudio-mcp.json"
Write-Host "Next steps:"
Write-Host "1) Open LM Studio > Settings > MCP Servers"
Write-Host "2) Paste JSON from .generated\lmstudio-mcp.json"
Write-Host "3) Restart LM Studio"

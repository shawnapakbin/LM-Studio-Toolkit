#requires -Version 5.1
<#
.SYNOPSIS
  Build the LLM Toolkit Windows installer (MSI + NSIS).

.DESCRIPTION
  Compiles the shared UI, then runs `tauri build` from the windows/src-tauri
  crate. Output bundles land under Installer/target/release/bundle/.

.EXAMPLE
  ./build.ps1
  ./build.ps1 -Profile dev
#>
[CmdletBinding()]
param(
    [ValidateSet('dev','release')] [string]$Profile = 'release'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$installerRoot = Join-Path $repoRoot 'Installer'
$uiRoot = Join-Path $installerRoot 'shared\ui'
$winRoot = Join-Path $installerRoot 'windows\src-tauri'

# Ensure cargo is on PATH for this session.
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path $cargoBin) { $env:Path = "$env:Path;$cargoBin" }

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Error "cargo not found. Install Rust via 'winget install Rustlang.Rustup' first."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error "npm not found. Install Node.js LTS first."
}

Write-Host "==> Installing UI dependencies" -ForegroundColor Cyan
Push-Location $uiRoot
try {
    if (-not (Test-Path 'node_modules')) {
        npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    }
    Write-Host "==> Building UI" -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "UI build failed" }
} finally {
    Pop-Location
}

Write-Host "==> Building Tauri installer ($Profile)" -ForegroundColor Cyan
Push-Location $winRoot
try {
    $tauriArgs = @('build')
    if ($Profile -eq 'dev') { $tauriArgs += '--debug' }
    # @tauri-apps/cli is the supported way to produce bundles. `cargo run`
    # would launch the app window, not build it.
    npx --yes @tauri-apps/cli@2 @tauriArgs
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

$bundleDir = Join-Path $installerRoot 'target\release\bundle'
if (Test-Path $bundleDir) {
    Write-Host "==> Build artifacts:" -ForegroundColor Green
    Get-ChildItem -Path $bundleDir -Recurse -Include *.msi,*.exe | ForEach-Object {
        Write-Host "  $($_.FullName) ($([math]::Round($_.Length/1MB,2)) MB)"
    }
} else {
    Write-Warning "Bundle directory not found at $bundleDir"
}

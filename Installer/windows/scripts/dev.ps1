#requires -Version 5.1
<#
.SYNOPSIS
  Run the Windows installer in dev mode (live-reload UI + Tauri).
#>
$ErrorActionPreference = 'Stop'
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path $cargoBin) { $env:Path = "$env:Path;$cargoBin" }

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
Push-Location (Join-Path $repoRoot 'Installer\windows\src-tauri')
try {
    npx --yes @tauri-apps/cli@2 dev
} finally {
    Pop-Location
}

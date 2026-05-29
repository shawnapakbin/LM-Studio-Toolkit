# LLM Toolkit Installer — Windows

Lightweight Tauri-based installer for Windows.

## Prerequisites

- **Rust** (stable, ≥ 1.96): `winget install Rustlang.Rustup`
- **Node.js LTS** (≥ 20)
- **WebView2 runtime** — preinstalled on Windows 10 21H2+ / 11. Older
  systems install it automatically via the WiX/NSIS bootstrapper.

## Build

```powershell
./scripts/build.ps1                   # release MSI + NSIS portable
./scripts/build.ps1 -Profile dev      # debug build
```

Output bundles land under `Installer/target/release/bundle/{msi,nsis}/`.

## Dev loop

```powershell
./scripts/dev.ps1
```

This starts the Vite dev server on http://localhost:5173 and launches the
Tauri shell pointing at it.

## Install paths

| Mode      | Path                                                                |
|-----------|---------------------------------------------------------------------|
| System    | `C:\Program Files\expDigit Studio\LLM Toolkit\`                     |
| Per-user  | `%LOCALAPPDATA%\Programs\expDigit Studio\LLM Toolkit\`              |
| App data  | `%APPDATA%\expDigit Studio\LLM Toolkit\`                            |
| Logs      | `%APPDATA%\expDigit Studio\LLM Toolkit\logs\`                       |
| Diagnostics | `%APPDATA%\expDigit Studio\LLM Toolkit\diagnostics\`              |

The installer detects elevation at launch. If you choose **System** while
running without elevation, the wizard surfaces a warning and disables the
Continue button until you switch to Per-user or relaunch as admin.

## Code signing

The MSI/NSIS builds are unsigned by default. To sign, set these env vars
before running `build.ps1`:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY     = "<path-to-pfx>"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password>"
```

(See `tauri.conf.json` `bundle.windows.signCommand` for full options.)

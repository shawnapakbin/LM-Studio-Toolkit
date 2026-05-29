# LLM Toolkit Installer

Lightweight, per-platform installer for the LLM Toolkit MCP server suite.

## Architecture

```
Installer/
├── shared/              # Cross-platform building blocks
│   ├── core/            #   Rust crate: install orchestration, runtime, payload,
│   │                    #     LM Studio sync, diagnostics, license, GitHub issue URL
│   ├── ui/              #   React + Vite + Tailwind renderer (Tauri webview)
│   ├── assets/          #   LICENSE copy embedded into the binary
│   └── tools.json       #   MCP tool registry (ported from legacy mcp-config.ts)
├── windows/             # Windows Tauri app — implemented (MSI + NSIS)
│   ├── src-tauri/
│   └── scripts/         #   build.ps1, dev.ps1
├── macos/               # macOS skeleton + plan (DMG)
├── linux/               # Linux skeleton + plan (AppImage + .deb)
├── _legacy-electron/    # Archived Electron implementation (reference only)
├── Cargo.toml           # Rust workspace root
└── README.md
```

## Design goals

1. **Lightweight.** The installer ships with zero bundled runtimes. Node.js,
   the toolkit sources, and Playwright browsers are all downloaded on demand
   from `nodejs.org` (with SHA256 verification) and GitHub.
2. **Cross-platform.** All install logic lives in `shared/core` (Rust). The
   per-platform Tauri apps are thin wrappers that surface OS-specific concerns
   (elevation, install path, bundle target).
3. **Trustable.** Mandatory license agreement gated on scroll-to-bottom +
   explicit checkbox. Every install failure produces a redacted diagnostic
   report and a one-click "Report on GitHub" button.
4. **Recoverable.** Phases emit structured `InstallError` values with
   `recoverable: bool`; the error screen offers Retry / Cancel.

## Install paths

| Platform | System scope                                            | Per-user scope                                                    |
|----------|---------------------------------------------------------|-------------------------------------------------------------------|
| Windows  | `C:\Program Files\expDigit Studio\LLM Toolkit\`         | `%LOCALAPPDATA%\Programs\expDigit Studio\LLM Toolkit\`            |
| macOS    | `/Applications/expDigit Studio/LLM Toolkit.app`         | `~/Applications/expDigit Studio/LLM Toolkit.app`                  |
| Linux    | `/opt/expdigit-studio/llm-toolkit/`                     | `~/.local/share/expdigit-studio/llm-toolkit/`                     |

App data (logs, diagnostics) lives in the OS-standard per-user directory in
all cases, even for system-scope installs.

## Build (Windows)

```powershell
cd Installer/windows/scripts
./build.ps1
```

See [windows/README.md](windows/README.md) for prerequisites and dev mode.

## Diagnostic reports

On any uncaught install failure, the installer:

1. Writes a redacted JSON report to
   `%APPDATA%\expDigit Studio\LLM Toolkit\diagnostics\report-<timestamp>.json`.
2. Surfaces an error screen with the message, recent log tail, and three
   actions: Retry (for recoverable errors), Open report, Report on GitHub.
3. The GitHub button opens a prefilled issue at
   `https://github.com/shawnapakbin/llm-toolkit-by-shawna/issues/new` with the
   phase, error message, OS info, and a pointer to the report file.

Environment variable keys matching `(?i)(key|secret|token|password|auth|credential|bearer)`
are replaced with `[REDACTED]` before serialization.

## Tests

```powershell
cd Installer
cargo test -p llmtk-core
```

Renderer tests will live next to `shared/ui/src/` once Vitest is wired in.

## Roadmap

- [x] Round 1: Windows Tauri installer end-to-end
- [ ] Round 2: macOS DMG with notarization
- [ ] Round 3: Linux AppImage + .deb
- [ ] Round 4: code signing, auto-update channel

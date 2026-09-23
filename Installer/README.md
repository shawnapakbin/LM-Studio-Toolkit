# LLM Toolkit Installer

The Windows installer for the LLM Toolkit. It is a [Tauri v2](https://tauri.app)
desktop app that produces a single unsigned NSIS `setup.exe`. The `setup.exe`
bundles the prebuilt `dist/` output of all 16 MCP tools and provisions them on
the end user's machine (no clone or build at install time).

## Build the `setup.exe`

Run one command from this `Installer/` directory:

```sh
npm run build:installer
```

(`npm run dist` is an alias for the same command.)

This is the single documented, end-to-end build. It runs two stages in order,
fail-fast (the second stage never runs if the first fails):

1. **`npm run stage:payload`** — builds all 16 MCP tools (`npm run build` at the
   repo root) and stages each tool's `dist/` tree into
   `src-tauri/payload/<serverName>/`. If any tool's `dist/` is **absent or
   empty**, staging **aborts with a non-zero exit and prints every missing tool
   by name** — no payload is staged and `tauri build` never runs (Req 3.2, 3.3).
2. **`tauri build`** — Tauri runs its configured `beforeBuildCommand`
   (`npm run build`, the Vite frontend build → `dist/`, consumed as
   `frontendDist`), embeds the staged `payload/` directory as a bundle resource,
   and produces the NSIS installer (Req 1.6, 2.1, 3.1).

### Output

On success, exactly one NSIS installer is written to:

```
Installer/src-tauri/target/release/bundle/nsis/*.exe
```

This is the path the release workflow (`.github/workflows/installer-release.yml`)
publishes. The installer is built `perMachine` and unsigned.

### Failure behavior

The build is fail-fast and produces no partial artifact (Req 1.8, 2.5):

- If payload staging fails (a missing/empty tool `dist/`), the command exits
  non-zero, names each missing tool, and `tauri build` never runs — so no
  `setup.exe` is produced.
- If `tauri build` fails, it returns a non-zero exit status and does not write a
  `.exe` to the `nsis/` output directory.

## Prerequisites

`tauri build` requires the Rust toolchain (`cargo`) and the platform's native
build dependencies. This is a Windows-only target (macOS/Linux are deferred).
The frontend and staging tooling need Node.js (>= 20) and the installer's npm
dependencies (`npm ci` in this directory).

## Useful sub-commands

| Command | Purpose |
| --- | --- |
| `npm run build:installer` / `npm run dist` | Full end-to-end build → `setup.exe`. |
| `npm run stage:payload` | Build + stage the 16 tool `dist/` trees only. |
| `npm run stage:payload -- --dry-run` | Report payload completeness without staging or building. |
| `npm run stage:payload -- --no-build` | Stage existing `dist/` trees without rebuilding the tools. |
| `npm run build` | Vite frontend build only (→ `dist/`). |
| `npm run tauri:build` | `tauri build` only (assumes payload already staged). |
| `npm run check:versions` | Verify the installer version is aligned across the three manifests. |

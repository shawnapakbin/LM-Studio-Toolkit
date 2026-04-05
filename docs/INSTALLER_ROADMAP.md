# Installer Roadmap — Multi-Platform Strategy

Derived from the working `Installer/` (Windows portable `install-0019.exe`).

---

## What Was Built (v1 — Windows Portable)

**Stack**: Electron 35 + electron-vite + electron-builder + React + Tailwind CSS  
**Output**: Single portable `.exe`, no installation required

### Architecture Snapshot

```
Installer/
  src/
    main/
      index.ts              — Electron app entry
      ipc-handlers.ts       — IPC bridge (main ↔ renderer)
      bootstrap.ts          — Payload extraction to install root
      runtime-manager.ts    — Detect/download portable Node.js
      setup-runner.ts       — Orchestrate all setup phases
      lmstudio-sync.ts      — Write ~/.lmstudio/mcp.json
      mcp-config.ts         — Tool descriptors + bridge config builder
      script-path.ts        — Resolve tool binary with nested-dist fallback
      tool-status.ts        — Verify built binaries exist
      env-manager.ts        — .env file setup
      types.ts              — Shared types
    preload/                — Context bridge (security boundary)
    renderer/               — React wizard + dashboard UI
  scripts/
    stage-payload.mjs       — Copy workspace source into resources/payload/toolkit
    stage-runtime.mjs       — Write runtime manifest (download-on-demand)
    compile-counter.mjs     — Stamp each build as install-000N.exe
    dist-win.mjs            — Orchestrate full Windows build
    select-icon.mjs         — Generate platform icons from SVG
    prepare-resources.mjs   — Run both staging scripts
    electron-vite-build.mjs — Invoke vite build
  resources/
    payload/toolkit/        — Staged source (written by stage-payload.mjs)
    runtime/manifest.json   — Node version declaration
```

### Setup Phases (in order)

| Phase | Step | What Happens |
|-------|------|-------------|
| 1 | bootstrap | Extract payload to install root; detect/download Node runtime |
| 2 | env | Write `.env` from `.env.example` |
| 3 | install | `npm install` in install root; optionally install Playwright browsers |
| 4 | build | `npm run build` — TypeScript compile all workspaces |
| 5 | verify | Check every tool binary exists (with nested-dist fallback paths) |
| 6 | lmstudio | Write `~/.lmstudio/mcp.json` with absolute Node path + tool args |
| 7 | done | Report complete |

---

## Regression Checklist — Run Before Every Release

These are the failure patterns discovered across install-0001–0019. Catch them before shipping.

### 1. Payload Completeness
- [ ] Every workspace listed in `PAYLOAD_ITEMS` (stage-payload.mjs) actually exists at `repoRoot/<name>`
- [ ] `Observability` is included — it is a shared dependency despite having no MCP server
- [ ] `CLI` and `Installer` are **not** in `PAYLOAD_ITEMS` (they have no place in install root)
- [ ] After staging, root `package.json` workspaces list matches only what was staged

### 2. TypeScript Build Integrity
- [ ] No tool `tsconfig.json` has `"../shared"` in its `include` array — causes TS6059 rootDir violation
- [ ] `Terminal`, `Calculator`, `Clock`, `Browserless` do not have `rootDir` set — blocks workspace module resolution from outside `src/`
- [ ] `Browserless` uses `"include": ["src"]` not `["src/**/*"]` (latter conflicts with path mapping)
- [ ] All tools build cleanly with `npm run build` from the install root (not just the dev workspace)

### 3. Tool Binary Paths
- [ ] After `npm run build`, each tool emits `dist/mcp-server.js` relative to its own directory
- [ ] If emission is nested (e.g. `dist/Terminal/src/mcp-server.js`), the script-path.ts fallback candidates cover it
- [ ] `mcp-config.ts` `TOOL_DESCRIPTORS` `relativeScript` values match at least one candidate in `script-path.ts`

### 4. LM Studio mcp.json
- [ ] `~/.lmstudio/mcp.json` is written with top-level `{ "mcpServers": { ... } }` structure
- [ ] Each server entry has: `command` (absolute Node path), `args` (absolute script path), `cwd`, `env`
- [ ] `command` is the **absolute** path to node.exe — never the bare string `"node"` (clean VMs have no global Node in PATH)
- [ ] Existing `mcp.json` keys are preserved (merged, not overwritten)
- [ ] Test: after install on a VM with no global Node, LM Studio shows all servers as "running"

### 5. Runtime Resolution
- [ ] Node detection order is: bundled → downloaded portable → system → `"node"` fallback
- [ ] The active node path written into `mcp.json` matches the executable actually used to run `npm install` and `npm run build`
- [ ] If portable download is needed, it succeeds before reaching the build phase

### 6. Build Artifact
- [ ] Compile counter advances (`install-000N.exe` name stamped in release/)
- [ ] `dist:win` script re-stages payload fresh on every run (no stale artifacts from prior build)
- [ ] Artifact size is reasonable (check: dist not accidentally including `node_modules` from workspace tools)

---

## Planned Installers (Execution Order)

### Installer 2 — macOS DMG

**Target**: `install.dmg` (electron-builder dmg target, already declared in package.json)  
**New work**:
- Cross-compile from Windows (`electron-builder --mac` needs macOS or a macOS-capable CI agent)
- Node candidate paths: `/Applications/LM Studio.app`, `~/Applications/LM Studio.app`
- `resolveActiveNodePath()` already handles darwin — verify bundled/downloaded path resolves
- Icon: generate `.icns` from `icon.png` via `electron-builder`'s built-in icon set or `iconutil`
- Test: run on a clean macOS VM with LM Studio installed; verify `mcp.json` at `~/.lmstudio/mcp.json`

**Regression notes**:
- macOS Gatekeeper will block unsigned binaries — document with `xattr -cr install.dmg` workaround or add notarization step
- Playwright `chromium` download path differs on macOS — test `WebBrowser` after install

**Acceptance criteria**:
- All 11 servers appear and start in LM Studio on macOS
- No `node is not recognized` — absolute node exe path used

---

### Installer 3 — Linux AppImage

**Target**: `install.AppImage` (already declared in package.json)  
**New work**:
- `resolveActiveNodePath()` linux branch: spawnSync `which lmstudio`, then fallback candidates in `~/Applications`
- LM Studio on Linux may store config at `~/.lmstudio/mcp.json` (same as Windows/macOS — verify)
- AppImage requires `FUSE` on the target system — document dependency
- Node portable archive name: `node-v20.17.0-linux-x64.tar.xz` — `resolvePortableArchiveName()` already handles it

**Regression notes**:
- Test on Ubuntu 22.04 LTS with LM Studio AppImage release
- Verify `chmod +x` is not needed (AppImages set it themselves)
- Desktop file and icon association handled by electron-builder `linux.category = Development`

**Acceptance criteria**:
- All servers listed and running in LM Studio on Ubuntu
- AppImage launches without FUSE warning (or warning documented)

---

### Installer 4 — Repair / Re-sync Mode (All Platforms)

**Target**: The existing installer already has a `context.repair` flag — surface it in the UI  
**New work**:
- Add a `Repair` button to the dashboard that re-runs phases 3–6 (skip payload extraction, preserve `.env`)
- Add a `Re-sync LM Studio` button that runs only phase 6 (lmstudio-sync) without rebuilding
- Add a `Reinstall Playwright` button that runs only the Playwright postinstall step

**Why**: After LM Studio updates change their `mcp.json` format, users can re-sync without full reinstall

**Acceptance criteria**:
- Full repair completes in <2 min on a machine where toolkit is already built
- Re-sync updates `mcp.json` with current absolute Node path (handles Node runtime migration)

---

### Installer 5 — Web-Based Installer (Tauri / No Electron)

**When**: If binary size becomes a constraint (current .exe is ~80 MB)  
**Approach**: Replace Electron with Tauri (Rust shell + WebView2), keeps the same React UI  
**Savings**: ~50 MB reduction (no bundled Chromium)  
**Risk**:
- Tauri IPC is different from Electron IPC — all `ipc-handlers.ts` would need porting
- electron-builder config replaced by `tauri.conf.json`

**Defer until**: Current .exe size causes user friction or CI storage cost

---

## Adding a New Tool — Installer Update Checklist

When a new MCP tool workspace is added to the repo:

1. **stage-payload.mjs** — Add the workspace name to `PAYLOAD_ITEMS`
2. **mcp-config.ts** — Add a new entry to `TOOL_DESCRIPTORS` with `id`, `displayName`, `relativeScript`, and `env` defaults
3. **Verify tsconfig** — Ensure the new tool's `tsconfig.json` does NOT have `"../shared"` in `include` and does NOT set `rootDir`
4. **Verify binary path** — After `npm run build`, confirm `<Tool>/dist/mcp-server.js` exists; if nested, add a candidate to `script-path.ts`
5. **Run regression checklist** and rebuild with `npm run -w Installer dist:win`
6. **Smoke test** — install on a clean VM and confirm the new tool appears in LM Studio

---

## Known Limitations (v1)

| Limitation | Impact | Planned Fix |
|-----------|--------|-------------|
| Tool `dist/` emission paths are inconsistent (some nest under `dist/<Tool>/src/`) | `relativeScript` in mcp-config doesn't match actual output; relies on fallback candidates | Fix `rootDir`/`outDir` in those tool tsconfigs so all emit flat `dist/mcp-server.js` |
| No code-signing | macOS Gatekeeper blocks .dmg; Windows SmartScreen warns on .exe | Add signing certs to CI pipeline |
| Portable Node download requires internet during first install | Offline install fails if no bundled runtime | Bundle a minimal Node binary in `resources/runtime/` for offline support |
| `mcp.json` uses forward-slash paths on all platforms | Harmless on Windows/macOS; verify on Linux | Confirmed OK — Node.js accepts forward slashes cross-platform |
| No auto-update mechanism | Users must re-run installer for new toolkit versions | Phase 4: Add `electron-updater` or a `llm update` CLI command |

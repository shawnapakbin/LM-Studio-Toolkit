# LLM Toolkit Installer — macOS (skeleton)

**Status:** not yet implemented. Targeted for the next round.

## Plan

- **Bundle target:** `.dmg` produced by `tauri build --bundles dmg`.
- **Install path (system):** `/Applications/expDigit Studio/LLM Toolkit.app`
- **Install path (per-user):** `~/Applications/expDigit Studio/LLM Toolkit.app`
- **App data:** `~/Library/Application Support/expDigitStudio/LLMToolkit/`
- **Logs:** `~/Library/Logs/expDigitStudio/LLMToolkit/`
- **Notarization:** required for distribution outside the Mac App Store.
  - Apple Developer ID Application certificate in keychain.
  - `tauri build` with `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` env vars,
    or `notarytool` post-build step.
- **WebKit:** uses system WKWebView (no download).

## Open work

1. Move `macos/src-tauri` out of `Installer/Cargo.toml` `exclude` once a macOS
   host can compile it (currently excluded so Windows CI works).
2. Port `windows/scripts/build.ps1` to `macos/scripts/build.sh`.
3. Add Apple notarization step.
4. Verify LM Studio detection covers Mac App Store + direct downloads.

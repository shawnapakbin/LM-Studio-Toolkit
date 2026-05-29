# LLM Toolkit Installer — Linux (skeleton)

**Status:** not yet implemented.

## Plan

- **Bundle targets:** `.AppImage` (universal) and `.deb` (Debian/Ubuntu).
- **Install path (system):** `/opt/expdigit-studio/llm-toolkit/`
- **Install path (per-user):** `~/.local/share/expdigit-studio/llm-toolkit/`
- **App data:** `~/.config/expdigit-studio/llm-toolkit/`
- **Runtime dep:** `libwebkit2gtk-4.1`, `libgtk-3`, FUSE (for AppImage).
- **Desktop entry:** `/usr/share/applications/llm-toolkit.desktop` (system)
  or `~/.local/share/applications/llm-toolkit.desktop` (per-user).

## Open work

1. Move `linux/src-tauri` out of `Installer/Cargo.toml` `exclude` once a Linux
   host can compile it.
2. Write `linux/scripts/build.sh` producing AppImage + .deb.
3. Document polkit prompt for system-scope installs.

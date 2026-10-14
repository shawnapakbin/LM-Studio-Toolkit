# LLM Toolkit 5.4.4 — Release 1

## Overview

This is the first published release of the LLM Toolkit under the
`installer-vX.Y.Z` release scheme. The LLM Toolkit is a monorepo of
Model Context Protocol (MCP) tool servers for LM Studio, bundled into a single
Windows desktop installer built with Tauri v2 and Rust and packaged as an NSIS
`setup.exe`.

Release 5.4.4 focuses on making the installer reliably provision the toolkit's
workspace-internal packages. The headline change packages the
`llm-toolkit-*` and `@shared/*` package closure as local `file:` tarballs so
the bundled MCP servers resolve their shared dependencies at install time. This
release also retires and gates a set of in-repo MCP servers so only the
supported servers are provisioned.

## What's included

The installer provisions nine MCP tool servers as LM Studio plugins:

- **Terminal** — OS-aware shell command execution (Windows/macOS/Linux)
- **WebBrowser** — headless Chromium browsing with JS rendering, cookies,
  screenshots, and markdown output
- **common** — a bundled plugin combining Calculator, Clock, AskUser, and
  DocumentScraper
- **Browserless** — advanced browser automation via a schema-proxy wrapper
- **PythonShell** — Python code execution and REPL launch
- **Skills** — a persistent, parameterized playbook/skill system
- **BlenderBridge** — a bridge to a running Blender instance for scene
  inspection and edits
- **3DTool** — a 3D model viewer/editor with multi-format support (OBJ,
  glTF/GLB), scene management, materials, and undo/redo
- **LanSubAgent** — a LAN-aware multi-endpoint inference dispatcher

### Highlights in this release

- Installer provisions the `llm-toolkit-*` and `@shared/*` workspace package
  closure through local `file:` tarballs, so bundled servers resolve their
  shared modules correctly after installation.
- The in-repo `slash-commands`, `sub-agent`, and `git` servers are gated off
  for this release. They remain in the repository and still build, but are not
  provisioned or installed, and can be re-enabled in a future release.

## Installation (Windows)

1. Open the GitHub Release for tag `installer-v5.4.4`.
2. Download the Windows installer asset:
   `LLM Toolkit Installer_5.4.4_x64-setup.exe`.
3. Run the NSIS setup executable and follow the prompts.

This installer targets 64-bit Windows (x64).

## Verifying the download

A SHA-256 checksum may accompany the installer asset on the GitHub Release. If
present, verify the download before running it:

```powershell
Get-FileHash -Algorithm SHA256 ".\LLM Toolkit Installer_5.4.4_x64-setup.exe"
```

Compare the printed hash against the published checksum and only run the
installer if they match.

## Platform support

This is a Windows-only release. macOS and Linux installers are deferred to a
future release.

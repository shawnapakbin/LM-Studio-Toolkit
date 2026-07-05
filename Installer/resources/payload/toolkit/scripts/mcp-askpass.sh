#!/usr/bin/env bash
# MCP Toolkit — sudo askpass helper
#
# Called by sudo -A (via SUDO_ASKPASS) when TERMINAL_REQUIRE_ASKPASS_FOR_SUDO=1.
# Displays a GUI password dialog and prints the password to stdout.
# Exits 0 on success, non-zero on cancel or failure.
#
# Supported backends (tried in order):
#   zenity   — GNOME / any GTK desktop       (apt: gnome-utils or zenity)
#   kdialog  — KDE                            (usually pre-installed)
#   yad      — any GTK desktop               (apt: yad)
#   ssh-askpass — generic X11 helper         (apt: ssh-askpass)
#   terminal fallback — used when no GUI is available

set -euo pipefail

PROMPT="${1:-[sudo] MCP Toolkit needs your password:}"

if command -v zenity >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  zenity --password \
    --title="Administrator password required" \
    --text="$PROMPT" 2>/dev/null
  exit $?
fi

if command -v kdialog >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  kdialog --password "$PROMPT" 2>/dev/null
  exit $?
fi

if command -v yad >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  yad --entry --hide-text \
    --title="Administrator password required" \
    --text="$PROMPT" 2>/dev/null
  exit $?
fi

if command -v ssh-askpass >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  ssh-askpass "$PROMPT" 2>/dev/null
  exit $?
fi

# Terminal fallback — only when a TTY is reachable
if [[ -t 0 ]] || [[ -e /dev/tty ]]; then
  IFS= read -rs -p "$PROMPT " password </dev/tty
  echo >&2
  printf '%s\n' "$password"
  exit 0
fi

echo "mcp-askpass: no GUI helper available and no TTY attached. Install zenity (sudo apt install zenity) and retry." >&2
exit 1

# Running Sudo Commands — How-To Guide

This guide explains how to use the LLM to run commands that require administrator (`sudo`) privileges on Linux, without giving the LLM your password.

---

## How It Works

When the LLM needs to run a `sudo` command:

1. A terminal window opens on your desktop.
2. The terminal shows the normal `sudo` password prompt.
3. You type your password — the LLM **never sees it**.
4. The command runs inside the terminal.
5. The terminal closes and the output is returned to the LLM automatically.

The LLM only knows **what command to run** and **what output it produced**. Your password stays entirely on your side.

---

## Step 1: Confirm Your Setup

Interactive capture mode is enabled by default after running the installer. Check that your `terminal-tools` config in LM Studio contains these three settings:

```json
"TERMINAL_PUNCHOUT": "1",
"TERMINAL_CAPTURE_WITH_PUNCHOUT": "1",
"TERMINAL_PUNCHOUT_WAIT_FOR_EXIT": "1"
```

If you used `install.sh`, these are already in `.generated/lmstudio-mcp.json`. Open LM Studio → Settings → MCP Servers → terminal-tools to verify.

---

## Step 2: Install a Desktop Terminal (if needed)

A desktop terminal emulator must be installed for the terminal window to open.

Check if one is already available:

```bash
which gnome-terminal konsole xfce4-terminal xterm x-terminal-emulator
```

If nothing is found, install one:

```bash
# Ubuntu / Debian (GNOME)
sudo apt install gnome-terminal

# Xubuntu / XFCE
sudo apt install xfce4-terminal

# Minimal / headless
sudo apt install xterm
```

Or tell the server which launcher to use by adding this to `terminal-tools` env in LM Studio:

```json
"TERMINAL_PUNCHOUT_CMD": "/usr/bin/xterm"
```

---

## Step 3: Test It

1. Open LM Studio with a loaded model.
2. Ask: `"Run sudo whoami and tell me the result."`
3. A terminal window opens and shows a password prompt.
4. Type your password and press Enter.
5. The terminal closes and the LLM reports what `whoami` printed.

---

## Step 4 (Optional): Adjust the Timeout

The LLM waits up to **180 seconds** for you to enter the password. To change this, add to `terminal-tools` env:

```json
"TERMINAL_PUNCHOUT_WAIT_TIMEOUT_MS": "300000"
```

This example sets the timeout to 5 minutes (300 000 ms).

---

## Step 5 (Optional): Keep the Terminal Open

To keep the terminal window open after the command finishes (useful to review output yourself before it closes), add:

```json
"TERMINAL_PUNCHOUT_WAIT_KEEP_OPEN": "1"
```

---

## Optional: Desktop GUI Password Dialog (Askpass)

As an alternative to typing in a terminal window, you can use a **graphical password dialog** — similar to the one your desktop shows when installing software.

### When to Use Askpass

- You want a cleaner pop-up dialog instead of a full terminal window.
- You are on GNOME, KDE, or any desktop with `zenity` or `kdialog`.
- You prefer to keep the terminal window solely for output, not for typing.

### Requirements

Install one of the following:

Desktop: GNOME / Ubuntu
- Package: `zenity`
- Install command: `sudo apt install zenity`

Desktop: KDE
- Package: `kdialog`
- Install command: usually pre-installed

Desktop: Any GTK
- Package: `yad`
- Install command: `sudo apt install yad`

Desktop: Generic
- Package: `ssh-askpass`
- Install command: `sudo apt install ssh-askpass`

### Step-by-Step Askpass Setup

**1. Install a dialog helper** (example for GNOME/Ubuntu):

```bash
sudo apt install zenity
```

**2. Locate the bundled askpass helper**

The installer placed it at `.generated/mcp-askpass.sh`. Verify:

```bash
ls -la .generated/mcp-askpass.sh
```

If the file is missing, copy it manually:

```bash
cp scripts/mcp-askpass.sh .generated/mcp-askpass.sh
chmod +x .generated/mcp-askpass.sh
```

**3. Test the helper directly**

```bash
.generated/mcp-askpass.sh "Test prompt:"
```

A dialog should appear. Cancel it — this confirms the helper is working.

**4. Add environment variables in LM Studio**

Open LM Studio → Settings → MCP Servers → terminal-tools and add to the `env` block:

```json
"TERMINAL_REQUIRE_ASKPASS_FOR_SUDO": "1",
"TERMINAL_SUDO_ASKPASS": "/absolute/path/to/.generated/mcp-askpass.sh"
```

Replace `/absolute/path/to/` with your actual install path. Your full install path is shown in `.generated/lmstudio-mcp.json` next to the `args` value.

Example:

```json
"env": {
  "ALLOWED_TERMINAL_COMMANDS": "*",
  "TERMINAL_PUNCHOUT": "1",
  "TERMINAL_CAPTURE_WITH_PUNCHOUT": "1",
  "TERMINAL_PUNCHOUT_WAIT_FOR_EXIT": "1",
  "TERMINAL_REQUIRE_ASKPASS_FOR_SUDO": "1",
  "TERMINAL_SUDO_ASKPASS": "/home/yourname/MCP/.generated/mcp-askpass.sh"
}
```

**5. Restart LM Studio**

Save the config and fully restart LM Studio.

**6. Test the GUI dialog**

Ask the LLM: `"Run sudo whoami and tell me the result."`

A graphical password dialog should appear on your desktop. Enter your password and click OK. The LLM will receive the output.

---

## Troubleshooting

### Terminal window did not open

- No supported terminal emulator is installed. Install `gnome-terminal` or `xterm`.
- Set a specific launcher: `"TERMINAL_PUNCHOUT_CMD": "/usr/bin/xterm"`
- See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) → *Punchout launcher not found*.

### Password prompt did not appear in the terminal

- Confirm the command used `sudo` (e.g., `sudo apt ...`).
- Confirm `TERMINAL_PUNCHOUT=1`, `TERMINAL_CAPTURE_WITH_PUNCHOUT=1`, and `TERMINAL_PUNCHOUT_WAIT_FOR_EXIT=1` are all set.

### The LLM timed out before you entered the password

- Increase the wait: `"TERMINAL_PUNCHOUT_WAIT_TIMEOUT_MS": "300000"`

### The GUI dialog (askpass) did not appear

- Confirm a helper is installed: `which zenity kdialog yad ssh-askpass`
- Confirm `TERMINAL_SUDO_ASKPASS` points to the correct absolute path.
- Confirm the file is executable: `chmod +x .generated/mcp-askpass.sh`

### Askpass dialog appeared but sudo rejected the password

- Re-enter the password carefully; the dialog hides all characters.
- Confirm your user account has sudo access: `sudo -l`

### Output was empty even though the command succeeded

- The command may print to a TTY directly instead of stdout/stderr (rare).
- Try running the same command without sudo first to confirm it produces output.

---

## Security Notes

- The LLM **never receives your password** — it only sees command output (stdout/stderr) and exit code.
- The terminal window runs under your local user session on your desktop.
- To restrict which commands can use elevated privileges, narrow the `ALLOWED_TERMINAL_COMMANDS` list instead of using `*`.
- The askpass helper prints passwords only to the local sudo process via a pipe to stdin — they do not appear in any log or tool response.

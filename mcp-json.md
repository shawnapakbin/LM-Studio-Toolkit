# LM Studio Compatible `mcp.json`

LM Studio expects `mcpServers` at the top level.

If you ran `install.sh` or `install.ps1`, use the generated file `.generated/lmstudio-mcp.json` directly in LM Studio.

## Full Configuration (6 Servers)

Use this full JSON in LM Studio:

```json
{
  "mcpServers": {
    "browser-tools": {
      "command": "/usr/bin/node",
      "args": ["/home/spakbin/MCP/dist/servers/browser.js"],
      "env": {
        "MCP_USE_PLAYWRIGHT": "1",
        "MCP_INSECURE_TLS": "1"
      }
    },
    "terminal-tools": {
      "command": "/usr/bin/node",
      "args": ["/home/spakbin/MCP/dist/servers/terminal.js"],
      "env": {
        "ALLOWED_TERMINAL_COMMANDS": "*",
        "TERMINAL_PUNCHOUT": "1",
        "TERMINAL_CAPTURE_WITH_PUNCHOUT": "1",
        "TERMINAL_PUNCHOUT_WAIT_FOR_EXIT": "1"
      }
    },
    "filesystem-tools": {
      "command": "/usr/bin/node",
      "args": ["/home/spakbin/MCP/dist/servers/filesystem.js"],
      "env": {
        "FS_ROOT": "/home/spakbin/MCP"
      }
    },
    "calculator-tools": {
      "command": "/usr/bin/node",
      "args": ["/home/spakbin/MCP/dist/servers/calculator.js"]
    },
    "calendar-tools": {
      "command": "/usr/bin/node",
      "args": ["/home/spakbin/MCP/dist/servers/calendar.js"]
    },
    "rag-tools": {
      "command": "/usr/bin/node",
      "args": ["/home/spakbin/MCP/dist/servers/rag.js"],
      "env": {
        "LM_STUDIO_URL": "http://localhost:1234",
        "RAG_DATA_DIR": "/home/spakbin/MCP/rag-data",
        "MCP_INSECURE_TLS": "1"
      }
    }
  }
}
```

If LM Studio editor already shows `"mcpServers": { ... }`, paste only this inner block:

```json
{
  "browser-tools": {
    "command": "/usr/bin/node",
    "args": ["/home/spakbin/MCP/dist/servers/browser.js"],
    "env": {
      "MCP_USE_PLAYWRIGHT": "1",
      "MCP_INSECURE_TLS": "1"
    }
  },
  "terminal-tools": {
    "command": "/usr/bin/node",
    "args": ["/home/spakbin/MCP/dist/servers/terminal.js"],
    "env": {
      "ALLOWED_TERMINAL_COMMANDS": "*",
      "TERMINAL_PUNCHOUT": "1",
      "TERMINAL_CAPTURE_WITH_PUNCHOUT": "1",
      "TERMINAL_PUNCHOUT_WAIT_FOR_EXIT": "1"
    }
  },
  "filesystem-tools": {
    "command": "/usr/bin/node",
    "args": ["/home/spakbin/MCP/dist/servers/filesystem.js"],
    "env": {
      "FS_ROOT": "/home/spakbin/MCP"
    }
  },
  "calculator-tools": {
    "command": "/usr/bin/node",
    "args": ["/home/spakbin/MCP/dist/servers/calculator.js"]
  },
  "calendar-tools": {
    "command": "/usr/bin/node",
    "args": ["/home/spakbin/MCP/dist/servers/calendar.js"]
  },
  "rag-tools": {
    "command": "/usr/bin/node",
    "args": ["/home/spakbin/MCP/dist/servers/rag.js"],
    "env": {
      "LM_STUDIO_URL": "http://localhost:1234",
      "RAG_DATA_DIR": "/home/spakbin/MCP/rag-data",
      "MCP_INSECURE_TLS": "1"
    }
  }
}
```

## Important Notes

- **Run `npm run build` first** so `dist/servers/*.js` exists
- Browser tools run in direct mode (no proxy required)
- Do not paste markdown headings or code fences into LM Studio, only raw JSON
- This file already uses your real local paths and node binary

## Server Capabilities

### 🌐 browser-tools (Enhanced!)
**7 tools for modern web scraping with JavaScript rendering:**

**Tier 1 (Rendering & Metadata):**
- `fetch_page_rendered` — Full JS execution (React, Vue, Angular, etc.)
- `extract_page_metadata` — Title, description, headings, schema.org data
- `extract_table_data` — HTML tables to markdown format

**Tier 2 (Dynamic Content):**
- `extract_dynamic_links` — All links after JS execution
- `fetch_with_pagination` — Multi-page scraping with selector support

**Tier 3 (Content Extraction):**
- `extract_main_content` — Auto-strip ads, navigation, sidebars
- `fetch_page_text` (classic) — Basic text extraction

**Requirements:**
- Browser server running with `MCP_USE_PLAYWRIGHT=1`
- Automatically handles both static and JS-heavy websites

### 🧠 rag-tools (NEW!)
**11 tools for document ingestion and semantic search:**

**Document Ingestion:**
- `ingest_webpage` — One-call: fetch → render → chunk → embed → store
- `store_document` — Manual document storage with chunking
- `extract_pdf_text` — Extract text from PDF files
- `extract_docx_text` — Extract text from Word documents
- `extract_markdown` — Extract and clean markdown files

**Vector Search:**
- `search_knowledge` — Semantic similarity search with top-k results
- `list_documents` — View all stored documents
- `delete_document` — Remove documents from knowledge base

**Utilities:**
- `chunk_text` — Text chunking (fixed/sentence/semantic)
- `generate_embeddings` — Call LM Studio embeddings API

**Features:**
- Uses LM Studio's `/v1/embeddings` endpoint
- In-memory vector store with file persistence
- Automatic index loading on startup
- Storage location: `rag-data/index.json`

### 💻 terminal-tools
**Command execution:**
- Set `ALLOWED_TERMINAL_COMMANDS="*"` for unrestricted commands
- Or provide a comma-separated allow-list like `ls,pwd,cat`

**Punchout modes (higher priority flags listed first):**

Mode: capture-only
- Flags required: none
- Interactive: no
- Captured: yes

Mode: punchout-only
- Flags required: `TERMINAL_PUNCHOUT=1`
- Interactive: yes
- Captured: no

Mode: hybrid capture
- Flags required: `TERMINAL_PUNCHOUT=1` + `TERMINAL_CAPTURE_WITH_PUNCHOUT=1`
- Interactive: no
- Captured: yes

Mode: tracked wait
- Flags required: `TERMINAL_PUNCHOUT=1` + `TERMINAL_PUNCHOUT_WAIT_FOR_EXIT=1`
- Interactive: yes
- Captured: no

Mode: interactive capture (default)
- Flags required: all three flags
- Interactive: yes
- Captured: yes

- Set `TERMINAL_PUNCHOUT_WAIT_TIMEOUT_MS="180000"` to control tracked wait timeout (default 180s, max 600s)
- Set `TERMINAL_PUNCHOUT_WAIT_KEEP_OPEN="1"` to keep the terminal open after tracked completion
- Set `TERMINAL_REQUIRE_ASKPASS_FOR_SUDO="1"` to force `sudo` calls into askpass mode
- Set `TERMINAL_SUDO_ASKPASS="/absolute/path/to/askpass-helper"` (or `SUDO_ASKPASS`) for the helper binary/script
- Optionally set `TERMINAL_PUNCHOUT_CMD` to force a specific launcher (for example `x-terminal-emulator`)

### 📁 filesystem-tools
**Sandboxed file access:**
- Read, write, list files within `FS_ROOT`
- Default sandbox: `/home/spakbin/MCP`
- Cannot access paths outside root

### 🧮 calculator-tools
**Scientific calculations:**
- Arithmetic, trigonometry, logarithms
- Variables and expressions
- Uses `expr-eval` library

### 📅 calendar-tools
**Date/time operations:**
- Current date/time
- Date arithmetic (add/subtract days)
- Timezone-aware calculations

## Network Access

The **browser-tools** server uses direct HTTPS/network access:

If TLS trust fails on your host, configure trust or temporarily set `MCP_INSECURE_TLS=1` in `browser-tools` env.

## Quick Start Workflow

### 1. Build the Project
```bash
cd /home/spakbin/MCP
npm run build
```

### 2. Configure LM Studio
- Open LM Studio → Settings → MCP Servers
- Paste the JSON configuration above
- Restart LM Studio

### 3. Basic Usage Examples

**Example 1: Fetch a modern JS website**
```
LLM Prompt: "Fetch the React documentation homepage and extract the main navigation links"

Tool Calls:
1. fetch_page_rendered(url="https://react.dev")
2. extract_dynamic_links(url="https://react.dev", maxLinks=20)
```

**Example 2: Build a searchable knowledge base**
```
LLM Prompt: "Ingest the Anthropic API docs and then search for information about token limits"

Tool Calls:
1. ingest_webpage(
     url="https://docs.anthropic.com/en/api/getting-started",
     documentId="anthropic-docs",
     title="Anthropic API Documentation"
   )
   → Returns: Successfully stored 42 chunks

2. search_knowledge(
     query="What are the token limits for Claude models?",
     topK=5
   )
   → Returns: Top 5 relevant chunks with similarity scores
```

**Example 3: Extract structured data from tables**
```
LLM Prompt: "Extract the pricing table from the OpenAI pricing page"

Tool Call:
extract_table_data(url="https://openai.com/api/pricing", tableIndex=0)
→ Returns: Markdown-formatted table
```

## Environment Variables Reference

### browser-tools
- `MCP_USE_PLAYWRIGHT=1` — Enable JavaScript rendering (required for modern sites)
- `MCP_INSECURE_TLS=1` — Disable TLS verification (use only if needed)

### rag-tools
- `LM_STUDIO_URL=http://localhost:1234` — LM Studio API endpoint
- `RAG_DATA_DIR=/path/to/rag-data` — Vector index storage location

### terminal-tools
- `ALLOWED_TERMINAL_COMMANDS=*` — Allow all commands (no restrictions)
- `ALLOWED_TERMINAL_COMMANDS=ls,pwd,cat,head,tail` — Comma-separated whitelist
- `TERMINAL_PUNCHOUT=1` — Open a terminal window for each command request (disables capture unless hybrid is enabled)
- `TERMINAL_CAPTURE_WITH_PUNCHOUT=1` — Hybrid mode: punch out and also return captured stdout/stderr after completion
- `TERMINAL_PUNCHOUT_WAIT_FOR_EXIT=1` — Tracked punchout mode: wait for terminal command completion before returning
- `TERMINAL_PUNCHOUT_WAIT_TIMEOUT_MS=180000` — Tracked punchout wait timeout in milliseconds (default 180000, max 600000)
- `TERMINAL_PUNCHOUT_WAIT_KEEP_OPEN=1` — Keep terminal window open after tracked command completion
- `TERMINAL_REQUIRE_ASKPASS_FOR_SUDO=1` — For `sudo` commands, require askpass helper and force `sudo -A`
- `TERMINAL_SUDO_ASKPASS=/absolute/path/to/helper` — Askpass helper path used when sudo enforcement is enabled
- `TERMINAL_PUNCHOUT_CMD=x-terminal-emulator` — Override detected launcher

### filesystem-tools
- `FS_ROOT=/home/spakbin/MCP` — Sandbox root directory (cannot access outside)

## Troubleshooting

### Browser tools return empty content
- **Cause:** Host TLS trust issue or Playwright not enabled
- **Fix:** Set `MCP_USE_PLAYWRIGHT=1`, then repair host CA trust (preferred) or set `MCP_INSECURE_TLS=1` temporarily
- **Verify:** `node -e "fetch('https://example.com').then(()=>console.log('ok')).catch(e=>console.error(e.message))"`

### RAG embeddings fail
- **Cause:** LM Studio not running or wrong endpoint
- **Fix:** Ensure LM Studio is running and `LM_STUDIO_URL` is correct
- **Verify:** `curl http://localhost:1234/v1/embeddings` returns valid response

### "No documents in knowledge base"
- **Cause:** Haven't ingested any documents yet
- **Fix:** Use `ingest_webpage()` or `store_document()` first
- **Verify:** `list_documents()` returns items

### Terminal commands rejected
- **Cause:** Command not in whitelist
- **Fix:** Set `"ALLOWED_TERMINAL_COMMANDS": "*"` for no restriction, or add needed commands to allow-list
- **Example:** `"ALLOWED_TERMINAL_COMMANDS": "*"`

### Terminal punchout fails
- **Cause:** No supported desktop terminal launcher found on host
- **Fix:** Install a launcher (`x-terminal-emulator`, `gnome-terminal`, `konsole`, `xfce4-terminal`, or `xterm`) or set `"TERMINAL_PUNCHOUT_CMD"` to a valid binary
- **Example:** `"TERMINAL_PUNCHOUT_CMD": "x-terminal-emulator"`

### Terminal output missing in LLM responses
- **Cause:** `TERMINAL_PUNCHOUT=1` without hybrid capture enabled
- **Fix:** Remove `TERMINAL_PUNCHOUT` for capture-first mode, or set both `TERMINAL_PUNCHOUT=1` and `TERMINAL_CAPTURE_WITH_PUNCHOUT=1`
- **Example:**
  ```json
  "env": {
    "ALLOWED_TERMINAL_COMMANDS": "*",
    "TERMINAL_PUNCHOUT": "1",
    "TERMINAL_CAPTURE_WITH_PUNCHOUT": "1"
  }
  ```

### Tracked punchout timed out
- **Cause:** `TERMINAL_PUNCHOUT_WAIT_FOR_EXIT=1` enabled and command did not finish before timeout
- **Fix:** Increase `TERMINAL_PUNCHOUT_WAIT_TIMEOUT_MS` (default 180000)
- **Optional:** Set `TERMINAL_PUNCHOUT_WAIT_KEEP_OPEN=1` to keep the terminal open after completion

### Sudo password prompt not appearing in terminal
- **Cause:** Using hybrid capture mode (`TERMINAL_CAPTURE_WITH_PUNCHOUT=1`) without `TERMINAL_PUNCHOUT_WAIT_FOR_EXIT=1` — the command runs in a non-interactive subprocess so sudo can't prompt
- **Fix:** Enable all three flags together: `TERMINAL_PUNCHOUT=1`, `TERMINAL_CAPTURE_WITH_PUNCHOUT=1`, `TERMINAL_PUNCHOUT_WAIT_FOR_EXIT=1`
- **Effect:** The terminal window stays interactive (sudo prompts work normally), output is captured via shell redirection, and the LLM receives stdout/stderr after you complete the command

### Sudo askpass helper missing
- **Cause:** `TERMINAL_REQUIRE_ASKPASS_FOR_SUDO=1` is enabled without `TERMINAL_SUDO_ASKPASS` or `SUDO_ASKPASS`
- **Fix:** Configure an askpass helper path and restart the MCP server

## Additional Resources

- **Full documentation:** [README.md](README.md)
- **RAG workflows:** [QUICKSTART-RAG.md](QUICKSTART-RAG.md)
- **Sudo / privileged commands:** [QUICKSTART-SUDO.md](QUICKSTART-SUDO.md)
- **Troubleshooting guide:** [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

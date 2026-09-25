# Golden baseline: `shipped-servers-baseline.json`

Feature: `retire-and-gate-mcp-servers` — supports **Property 4** (generated config
for each Shipped server is unchanged).

## Purpose

This fixture is the pre-change golden snapshot of the generated LM Studio bridge
config for the **nine Shipped servers**. It was captured **before** any
source-of-truth mirror was edited (Retired/Unshipped removal), so it doubles as
the **post-change expected set**: after the retire/unship edits land, the config
generated for the nine Shipped servers must equal this fixture exactly, and the
only whole-set difference from the old 16-server output is the removal of the
four Retired and three Unshipped entries.

- **Requirements:** 6.1, 6.3
- **Property:** Property 4 — _for all_ nine Shipped servers, the generated bridge
  command, argument entry-path layout, and environment map are identical to what
  was generated before the change.

## Sources of truth captured

| Field | Source |
| --- | --- |
| `command`, `entry`, `entryPathTemplate` | `Installer/src-tauri/src/lmstudio.rs` → `default_bridge_configs` (via the shared `entry` / `entry_script_path` seam) |
| `env` | `scripts/workspace/mcp-config.js` → `servers[<name>].env` (emitted verbatim by `buildMcpServers()`) |
| `distRoot` | `Installer/src-tauri/src/tool_payload.rs` → `CANONICAL_TOOL_PAYLOADS` |

## Shape

```jsonc
{
  "expectedServerCount": 9,
  "argsLayout": { "entryPathTemplate": "{installDir}/<serverName>/<entry>" },
  "servers": {
    "<serverName>": {
      "command": "node",
      "entry": "mcp-server.js" | "schema-proxy.js",
      "entryPathTemplate": "{installDir}/<serverName>/<entry>",
      "distRoot": "<repo-relative dist root>",
      "env": { "<KEY>": "<value>", ... }
    }
  }
}
```

## Args entry-path layout

`default_bridge_configs(install_dir)` emits, for each server:

- `command = "node"`
- `args = [ normalize(install_dir / <serverName> / <entry>) ]`
  where `normalize` replaces backslashes with forward slashes and
  `<entry>` is `schema-proxy.js` for `browserless`, else `mcp-server.js`.

To reconstruct the concrete expected `args[0]` in a test, substitute the test's
resolved install root for the `{installDir}` placeholder in `entryPathTemplate`
and apply the same forward-slash normalization.

## The nine Shipped servers (and what is intentionally absent)

Present (9): `terminal`, `web-browser`, `common`, `browserless`, `python-shell`,
`skills`, `blender-bridge`, `3dtool`, `lan-sub-agent`.

Absent by design — Retired (4): `rag`, `csv-exporter`, `file-editor`,
`package-manager`. Unshipped (3): `slash-commands`, `sub-agent`, `git`.

## Note on `env` in `default_bridge_configs`

`default_bridge_configs` itself constructs configs with an **empty** env map —
per-tool env derivation is the `config_gen.rs` step's job. The `env` values in
this fixture are the authoritative per-server env taken from `mcp-config.js`,
which is what ultimately reaches each server's `mcp-bridge-config.json`. A
Property 4 test may assert the command/args-layout half against
`default_bridge_configs` and the env half against the `mcp-config.js`-derived
env, both compared to this single baseline.

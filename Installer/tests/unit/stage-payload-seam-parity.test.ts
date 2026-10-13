/**
 * Bugfix: installer-plugin-path-and-browserless-secret
 * Task 3.3 — Mirror the layout and add a staging parity check (Concern 1).
 *
 * Property 1 (Bug Condition — Entry-Script Path) / Property 4 (Preservation).
 *
 * The bug (`isBugCondition_pathMismatch`) is that the two layouts diverge: the
 * bridge-config generator derives `args[0]` from one key while staging copies
 * to another, so `install_dir/<...>/<entry>` does not exist at launch
 * (MODULE_NOT_FOUND). The fix single-sources BOTH sides on `<serverName>/`:
 *
 *   - Rust `installed_entry_relpath(tool)` -> `<server_name>/<entry>` drives the
 *     generated `args[0]` (`entry_script_path` in `lmstudio.rs`).
 *   - `stagePayload` copies each tool's dist tree into `payload/<serverName>/`
 *     via `stagingDestDirName(tool)`.
 *
 * This suite is the PARITY GUARD requested by task 3.3: it asserts, for all nine
 * canonical tools, that the seam's leading relative dir
 * (`leadingDir(installedEntryRelpath(tool))`) equals the staging destination dir
 * name (`stagingDestDirName(tool)`). A future rename that touches only one side
 * would desync the two layouts and this test would fail — catching the drift
 * before it ships as another MODULE_NOT_FOUND.
 *
 * Validates: Requirements 2.2, 2.3, 3.4
 */

import {
  CANONICAL_TOOL_COUNT,
  CANONICAL_TOOL_PAYLOADS,
  installedEntryFilename,
  installedEntryRelpath,
  leadingDir,
  stagingDestDirName,
} from "../../scripts/payload-manifest";

describe("Task 3.3: seam / staging layout parity (Concern 1)", () => {
  it("has exactly the 9 canonical tools to check", () => {
    expect(CANONICAL_TOOL_PAYLOADS).toHaveLength(CANONICAL_TOOL_COUNT);
  });

  it("leading dir of installedEntryRelpath equals the staging dest dir for all 9 tools", () => {
    for (const tool of CANONICAL_TOOL_PAYLOADS) {
      const seamLeadingDir = leadingDir(installedEntryRelpath(tool));
      const stagingDir = stagingDestDirName(tool);

      // The bridge-config seam and the staging destination must agree on the
      // SAME leading `<serverName>/` directory. If they ever diverge, the
      // generated args[0] points where nothing was staged (MODULE_NOT_FOUND).
      expect(seamLeadingDir).toBe(stagingDir);
      // And both equal the tool's serverName — the single key the two layouts
      // are single-sourced on.
      expect(seamLeadingDir).toBe(tool.serverName);
    }
  });

  it("installedEntryRelpath is exactly <serverName>/<entry> for all 9 tools", () => {
    for (const tool of CANONICAL_TOOL_PAYLOADS) {
      const relpath = installedEntryRelpath(tool);
      const entry = installedEntryFilename(tool.serverName);
      expect(relpath).toBe(`${tool.serverName}/${entry}`);
      // No dist_root sub-structure leaks into the installed relpath.
      expect(relpath.split("/")).toHaveLength(2);
    }
  });

  it("uses schema-proxy.js only for browserless and mcp-server.js for the rest", () => {
    for (const tool of CANONICAL_TOOL_PAYLOADS) {
      const entry = installedEntryFilename(tool.serverName);
      if (tool.serverName === "browserless") {
        expect(entry).toBe("schema-proxy.js");
      } else {
        expect(entry).toBe("mcp-server.js");
      }
    }
  });

  it("leadingDir handles both / and \\ separators", () => {
    // Robustness: the parity holds regardless of the separator a caller uses.
    expect(leadingDir("browserless/schema-proxy.js")).toBe("browserless");
    expect(leadingDir("python-shell\\mcp-server.js")).toBe("python-shell");
    expect(leadingDir("common")).toBe("common");
  });
});

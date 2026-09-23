/**
 * Unit tests for the pure payload-staging planner.
 *
 * Feature: windows-installer-setup-exe (Requirements 3.2, 3.3)
 *
 * Covers the pure `planPayloadStaging` core: the completeness decision and the
 * exactness of the `missing` set (Req 3.3 — absent OR empty dist roots are
 * named). The full property-based coverage lives in the Rust `bundle.rs`
 * planner (tasks 3.2/3.3); these examples lock the TS build-step logic that
 * `stage-payload.ts` drives.
 */

import {
  CANONICAL_TOOL_COUNT,
  CANONICAL_TOOL_PAYLOADS,
  type DistPresence,
  canonicalPayloads,
  isComplete,
  planPayloadStaging,
} from "../../scripts/payload-manifest";

/** All 16 tools present and non-empty. */
function allPresent(): DistPresence[] {
  return canonicalPayloads().map((t) => ({
    serverName: t.serverName,
    exists: true,
    nonEmpty: true,
  }));
}

describe("canonical payload list", () => {
  it("has exactly 16 tools with unique names and dist roots", () => {
    expect(CANONICAL_TOOL_PAYLOADS.length).toBe(CANONICAL_TOOL_COUNT);
    const names = new Set(CANONICAL_TOOL_PAYLOADS.map((t) => t.serverName));
    const roots = new Set(CANONICAL_TOOL_PAYLOADS.map((t) => t.distRoot));
    expect(names.size).toBe(CANONICAL_TOOL_COUNT);
    expect(roots.size).toBe(CANONICAL_TOOL_COUNT);
  });

  it("mirrors the Rust tool_payload.rs server names", () => {
    // The exact 16 server names from tool_payload.rs / mcp-config.js.
    const expected = [
      "terminal",
      "web-browser",
      "common",
      "browserless",
      "rag",
      "python-shell",
      "skills",
      "slash-commands",
      "blender-bridge",
      "3dtool",
      "sub-agent",
      "lan-sub-agent",
      "git",
      "package-manager",
      "csv-exporter",
      "file-editor",
    ].sort();
    const actual = CANONICAL_TOOL_PAYLOADS.map((t) => t.serverName).sort();
    expect(actual).toEqual(expected);
  });
});

describe("planPayloadStaging", () => {
  it("reports complete when all 16 dist roots are present and non-empty", () => {
    const plan = planPayloadStaging(allPresent());
    expect(isComplete(plan)).toBe(true);
    expect(plan.missing).toEqual([]);
    expect(plan.present.length).toBe(CANONICAL_TOOL_COUNT);
    expect(plan.required.length).toBe(CANONICAL_TOOL_COUNT);
  });

  it("treats an ABSENT dist root as missing (Req 3.3)", () => {
    const presence = allPresent().map((p) =>
      p.serverName === "terminal" ? { ...p, exists: false, nonEmpty: false } : p,
    );
    const plan = planPayloadStaging(presence);
    expect(isComplete(plan)).toBe(false);
    expect(plan.missing).toEqual(["terminal"]);
  });

  it("treats an EMPTY dist root as missing (Req 3.3)", () => {
    const presence = allPresent().map((p) =>
      p.serverName === "git" ? { ...p, exists: true, nonEmpty: false } : p,
    );
    const plan = planPayloadStaging(presence);
    expect(isComplete(plan)).toBe(false);
    expect(plan.missing).toEqual(["git"]);
  });

  it("names every missing/empty tool, sorted, and omits no present tool", () => {
    const presence = allPresent().map((p) => {
      if (p.serverName === "file-editor") return { ...p, exists: false, nonEmpty: false };
      if (p.serverName === "3dtool") return { ...p, exists: true, nonEmpty: false };
      if (p.serverName === "rag") return { ...p, exists: false, nonEmpty: false };
      return p;
    });
    const plan = planPayloadStaging(presence);
    expect(plan.missing).toEqual(["3dtool", "file-editor", "rag"]);
    // No present tool is reported missing.
    for (const name of plan.present) {
      expect(plan.missing).not.toContain(name);
    }
    // present and missing partition the 16 canonical tools exactly.
    expect(plan.present.length + plan.missing.length).toBe(CANONICAL_TOOL_COUNT);
  });

  it("treats a canonical tool with no presence entry as missing", () => {
    // Drop the 'common' entry entirely.
    const presence = allPresent().filter((p) => p.serverName !== "common");
    const plan = planPayloadStaging(presence);
    expect(plan.missing).toContain("common");
    expect(isComplete(plan)).toBe(false);
  });

  it("reports all 16 missing when nothing is built", () => {
    const plan = planPayloadStaging([]);
    expect(isComplete(plan)).toBe(false);
    expect(plan.missing.length).toBe(CANONICAL_TOOL_COUNT);
    expect(plan.present).toEqual([]);
  });
});

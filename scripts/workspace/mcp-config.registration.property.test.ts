// Feature: codebase-cleanup-plugin-registration, Property 1: Registration bijection

/**
 * Feature: codebase-cleanup-plugin-registration
 * Property 1: Registration bijection
 *
 * For all workspaces `w`, `w` is present in the registered server set produced
 * by `buildMcpServers()` if and only if `w` is classified as a
 * Runtime_Server_Workspace in the `mcp-config.js` source of truth; no
 * Library_Workspace (CLI, Installer, AgentRunner, Memory, Observability, shared)
 * appears in the registered set.
 *
 * Validates: Requirements 1.1, 1.5, 8.3
 * Design: Property 1
 */

import * as fc from "fast-check";

// The registration source of truth. `buildMcpServers()` resolves each
// `relativeScript` against repoRoot and returns `{ mcpServers, missingBuilds }`.
// A missing build artifact still emits the server entry (Req 1.8), so the set of
// keys in `mcpServers` is exactly the registered runtime-server set regardless of
// whether the workspaces have been built.
const { buildMcpServers } = require("./mcp-config");

/**
 * The 16 registered Runtime_Server_Workspaces, keyed by their kebab-case server
 * name as it appears in the `servers` map of `mcp-config.js` (Req 1.1, 1.2, and
 * the seven additions from task 3.1). This is the authoritative registered set:
 * 9 existing + 7 added = 16 (Req 1.5, 8.3).
 */
const RUNTIME_SERVER_KEYS = [
  // 9 existing
  "terminal",
  "web-browser",
  "common",
  "browserless",
  "rag",
  "python-shell",
  "skills",
  "slash-commands",
  "blender-bridge",
  // 7 added (task 3.1)
  "3dtool",
  "sub-agent",
  "lan-sub-agent",
  "git",
  "package-manager",
  "csv-exporter",
  "file-editor",
] as const;

/**
 * Library_Workspaces that are NOT standalone MCP servers and therefore MUST NOT
 * appear in the registered set (Req 1.3, glossary Library_Workspace). These are
 * the workspace directory names as they exist in the monorepo.
 */
const LIBRARY_WORKSPACES = [
  "CLI",
  "Installer",
  "AgentRunner",
  "Memory",
  "Observability",
  "shared",
] as const;

describe("mcp-config registration property tests", () => {
  // Compute the actual registered set once — buildMcpServers() is a pure read of
  // the servers map (external servers gated by binary presence emit a warning).
  let registeredKeys: string[];
  let warnSpy: jest.SpyInstance;

  beforeAll(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { mcpServers } = buildMcpServers();
    registeredKeys = Object.keys(mcpServers);
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });

  /**
   * Feature: codebase-cleanup-plugin-registration, Property 1: Registration bijection
   *
   * For every workspace `w` drawn from the union of the classified
   * Runtime_Server_Workspaces and Library_Workspaces, `w` is in the registered
   * set produced by `buildMcpServers()` if and only if `w` is a
   * Runtime_Server_Workspace.
   *
   * Validates: Requirements 1.1, 1.5, 8.3
   * Design: Property 1
   */
  describe("Property 1: Registration bijection", () => {
    it("a workspace is registered iff it is a Runtime_Server_Workspace (never a Library_Workspace)", () => {
      const runtimeSet = new Set<string>(RUNTIME_SERVER_KEYS);
      const registeredSet = new Set(registeredKeys);

      // Generator over the classified universe of workspaces, tagged with the
      // classification the source of truth assigns them.
      const runtimeArb = fc
        .constantFrom(...RUNTIME_SERVER_KEYS)
        .map((name) => ({ name, isRuntime: true }));
      const libraryArb = fc
        .constantFrom(...LIBRARY_WORKSPACES)
        .map((name) => ({ name, isRuntime: false }));
      const workspaceArb = fc.oneof(runtimeArb, libraryArb);

      fc.assert(
        fc.property(workspaceArb, ({ name, isRuntime }) => {
          const isRegistered = registeredSet.has(name);
          // Biconditional: registered iff classified as a Runtime_Server_Workspace.
          expect(isRegistered).toBe(isRuntime && runtimeSet.has(name));
          expect(isRegistered).toBe(isRuntime);
        }),
        { numRuns: 100 },
      );
    });

    it("the registered set equals exactly the 16 Runtime_Server_Workspaces (Req 1.5, 8.3)", () => {
      const runtimeSet = new Set<string>(RUNTIME_SERVER_KEYS);
      const registeredSet = new Set(registeredKeys);

      // Forward inclusion: every registered key is a classified runtime server.
      for (const key of registeredSet) {
        expect(runtimeSet.has(key)).toBe(true);
      }
      // Reverse inclusion: every classified runtime server is registered.
      for (const key of runtimeSet) {
        expect(registeredSet.has(key)).toBe(true);
      }
      // Count reconciliation: exactly 16 registered plugin entries.
      expect(registeredKeys.length).toBe(16);
      expect(RUNTIME_SERVER_KEYS.length).toBe(16);
    });

    it("no Library_Workspace ever appears in the registered set (Req 1.3)", () => {
      const registeredSet = new Set(registeredKeys);

      fc.assert(
        fc.property(fc.constantFrom(...LIBRARY_WORKSPACES), (library) => {
          expect(registeredSet.has(library)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });
});

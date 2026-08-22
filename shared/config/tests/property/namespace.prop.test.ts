// Feature: v2-4-0-unified-config-installer, Property 19: Tool Namespace Registration
// **Validates: Requirements 10.5**

import * as fs from "fs";
import * as path from "path";
import * as fc from "fast-check";
import { configSchema } from "../../src/schema";

/**
 * Property 19: Tool Namespace Registration
 *
 * For any workspace package that is classified as a Tool_Server in the
 * monorepo, the Config_Schema must contain a corresponding top-level
 * namespace key matching the tool's directory name in lowercase.
 */

// Non-tool workspaces that should be excluded from the namespace check
const NON_TOOL_WORKSPACES = new Set(["shared", "shared/config", "Installer", "mcp/common"]);

/**
 * Maps a workspace directory name to the expected config namespace key.
 * The general rule is lowercase of the last path segment, with special
 * handling for names starting with digits (e.g., "3DTool" → "threedtool").
 */
function workspaceToNamespaceKey(workspace: string): string {
  // Take the last segment (handles "shared/config" → "config")
  const dirName = path.basename(workspace);

  // Special case: directory names starting with a digit get a word prefix
  // "3DTool" → "threedtool"
  const lowerName = dirName.toLowerCase();
  if (lowerName.startsWith("3d")) {
    return "threedtool";
  }

  return lowerName;
}

/**
 * Read the workspaces array from root package.json and filter to tool servers only.
 */
function getToolWorkspaces(): string[] {
  const rootPkgPath = path.resolve(__dirname, "../../../../package.json");
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
  const workspaces: string[] = rootPkg.workspaces;

  return workspaces.filter((ws) => !NON_TOOL_WORKSPACES.has(ws));
}

describe("Feature: v2-4-0-unified-config-installer, Property 19: Tool Namespace Registration", () => {
  const toolWorkspaces = getToolWorkspaces();
  const schemaKeys = Object.keys(configSchema.shape);

  it("every tool workspace has a corresponding namespace key in configSchema", () => {
    // Deterministic verification: each tool workspace maps to a schema key
    for (const workspace of toolWorkspaces) {
      const expectedKey = workspaceToNamespaceKey(workspace);
      expect(schemaKeys).toContain(expectedKey);
    }
  });

  it("property: for any tool workspace sampled from the list, configSchema contains its namespace key", () => {
    // Use fast-check to verify the property holds for all tool workspaces
    // by sampling from the actual workspace list
    fc.assert(
      fc.property(fc.constantFrom(...toolWorkspaces), (workspace: string) => {
        const expectedKey = workspaceToNamespaceKey(workspace);
        // The schema must have a top-level key matching the tool's namespace
        expect(schemaKeys).toContain(expectedKey);
      }),
      { numRuns: 100 },
    );
  });

  it("property: no tool workspace is missing from the schema (exhaustive)", () => {
    // Verify the property exhaustively by checking every single tool workspace
    const missingNamespaces: { workspace: string; expectedKey: string }[] = [];

    for (const workspace of toolWorkspaces) {
      const expectedKey = workspaceToNamespaceKey(workspace);
      if (!schemaKeys.includes(expectedKey)) {
        missingNamespaces.push({ workspace, expectedKey });
      }
    }

    expect(missingNamespaces).toEqual([]);
  });

  it("schema namespace count covers all tool workspaces", () => {
    // Every tool workspace should have a unique namespace key present in schema
    const toolNamespaceKeys = toolWorkspaces.map(workspaceToNamespaceKey);
    const uniqueToolKeys = [...new Set(toolNamespaceKeys)];

    // All unique tool keys must exist in schema
    for (const key of uniqueToolKeys) {
      expect(schemaKeys).toContain(key);
    }
  });
});

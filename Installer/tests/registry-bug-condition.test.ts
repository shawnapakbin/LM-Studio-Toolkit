/**
 * Bug Condition Exploration Test
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**
 *
 * Property 1: Bug Condition — ECM Registered and BlenderBridge Missing Across Registry and Scripts
 *
 * These tests encode the EXPECTED (correct) behavior. They are designed to
 * FAIL on unfixed code, which confirms the bug exists. Once the fix is applied,
 * these same tests will PASS, confirming the fix is correct.
 *
 * Counterexamples surfaced by failures:
 * - TOOL_DESCRIPTORS contains { id: "ecm" } when it should not
 * - TOOL_DESCRIPTORS does not contain { id: "blender-bridge" } when it should
 * - PAYLOAD_ITEMS contains "ECM" when it should not
 * - Stale Installer/resources/payload/toolkit/ECM/ directory persists
 * - smoke-test-mcp.js tools array contains { name: "ECM" } when it should not
 * - smoke-test-mcp.js tools array does not contain { name: "BlenderBridge" } when it should
 * - verify-tools.js tools array does not contain { name: "BlenderBridge" } when it should
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TOOL_DESCRIPTORS } from "../src/main/mcp-config";

const installerRoot = join(__dirname, "..");
const repoRoot = resolve(installerRoot, "..");

describe("Bug Condition: ECM Registered and BlenderBridge Missing Across Registry and Scripts", () => {
  // --- TOOL_DESCRIPTORS checks ---
  describe("TOOL_DESCRIPTORS (mcp-config.ts)", () => {
    const registeredIds = TOOL_DESCRIPTORS.map((t) => t.id);

    test("TOOL_DESCRIPTORS does NOT contain a descriptor with id 'ecm'", () => {
      // Expected behavior: ECM has been deprecated and should not be registered
      expect(registeredIds).not.toContain("ecm");
    });

    test("TOOL_DESCRIPTORS contains a descriptor with id 'blender-bridge'", () => {
      // Expected behavior: BlenderBridge should be registered
      expect(registeredIds).toContain("blender-bridge");
    });

    test("'blender-bridge' descriptor has relativeScript 'BlenderBridge/dist/mcp-server.js'", () => {
      const descriptor = TOOL_DESCRIPTORS.find((t) => t.id === "blender-bridge");
      expect(descriptor).toBeDefined();
      expect(descriptor!.relativeScript).toBe("BlenderBridge/dist/mcp-server.js");
    });

    test("'blender-bridge' descriptor has correct environment variables", () => {
      const descriptor = TOOL_DESCRIPTORS.find((t) => t.id === "blender-bridge");
      expect(descriptor).toBeDefined();
      expect(descriptor!.env).toEqual({
        BLENDER_MCP_HOST: "127.0.0.1",
        BLENDER_MCP_PORT: "9876",
        BLENDER_MCP_COMMAND: "blender-mcp",
        BLENDER_MCP_ARGS: "",
      });
    });
  });

  // --- stage-payload.mjs checks ---
  describe("stage-payload.mjs", () => {
    test("PAYLOAD_ITEMS does NOT contain 'ECM'", () => {
      const stagePayloadPath = join(installerRoot, "scripts", "stage-payload.mjs");
      const content = readFileSync(stagePayloadPath, "utf8");
      // Extract the PAYLOAD_ITEMS array from the file content
      const match = content.match(/const PAYLOAD_ITEMS\s*=\s*\[([\s\S]*?)\];/);
      expect(match).not.toBeNull();
      const arrayContent = match![1];
      // Check that "ECM" is not in the array (as a standalone quoted string)
      expect(arrayContent).not.toMatch(/["']ECM["']/);
    });
  });

  // --- Stale ECM payload directory check ---
  describe("Stale ECM payload directory", () => {
    test("Installer/resources/payload/toolkit/ECM/ does not exist", () => {
      const ecmPayloadDir = join(installerRoot, "resources", "payload", "toolkit", "ECM");
      expect(existsSync(ecmPayloadDir)).toBe(false);
    });
  });

  // --- smoke-test-mcp.js checks ---
  describe("smoke-test-mcp.js", () => {
    const smokeTestPath = join(repoRoot, "scripts", "workspace", "smoke-test-mcp.js");
    const content = readFileSync(smokeTestPath, "utf8");
    // Extract the tools array from the file
    const toolsMatch = content.match(/const tools\s*=\s*\[([\s\S]*?)\];/);

    test("tools array does NOT contain an entry with name 'ECM'", () => {
      expect(toolsMatch).not.toBeNull();
      const toolsContent = toolsMatch![1];
      // Check that there is no entry with name: "ECM"
      expect(toolsContent).not.toMatch(/name:\s*["']ECM["']/);
    });

    test("tools array contains an entry { name: 'BlenderBridge', dist: 'BlenderBridge/dist/mcp-server.js' }", () => {
      expect(toolsMatch).not.toBeNull();
      const toolsContent = toolsMatch![1];
      // Check that BlenderBridge is present with the correct dist path
      expect(toolsContent).toMatch(/name:\s*["']BlenderBridge["']/);
      expect(toolsContent).toMatch(/dist:\s*["']BlenderBridge\/dist\/mcp-server\.js["']/);
    });
  });

  // --- verify-tools.js checks ---
  describe("verify-tools.js", () => {
    const verifyToolsPath = join(repoRoot, "scripts", "workspace", "verify-tools.js");
    const content = readFileSync(verifyToolsPath, "utf8");
    // Extract the tools array from the file
    const toolsMatch = content.match(/const tools\s*=\s*\[([\s\S]*?)\];/);

    test("tools array contains an entry { name: 'BlenderBridge', dist: 'BlenderBridge/dist/mcp-server.js', src: 'BlenderBridge/src/mcp-server.ts' }", () => {
      expect(toolsMatch).not.toBeNull();
      const toolsContent = toolsMatch![1];
      // Check that BlenderBridge is present with the correct dist and src paths
      expect(toolsContent).toMatch(/name:\s*["']BlenderBridge["']/);
      expect(toolsContent).toMatch(/dist:\s*["']BlenderBridge\/dist\/mcp-server\.js["']/);
      expect(toolsContent).toMatch(/src:\s*["']BlenderBridge\/src\/mcp-server\.ts["']/);
    });
  });
});

/**
 * Regression tests for mcp-config.ts
 *
 * Key failure patterns caught:
 * - command must never be the bare string "node" — clean VMs have no global Node in PATH
 * - every tool descriptor must have a matching relativeScript entry
 * - buildBridgeConfig must forward-slash all paths for cross-platform compatibility
 */

import { join } from "node:path";
import { buildBridgeConfig, TOOL_DESCRIPTORS } from "../src/main/mcp-config";

const INSTALL_ROOT = join("C:", "Users", "Demo User", "AppData", "Roaming", "llm-toolkit");
const FAKE_NODE_PATH = join("C:", "Users", "Demo User", "AppData", "Roaming", "llm-toolkit-installer", "runtime-cache", "node-v20.17.0-win32-x64", "node.exe");

describe("TOOL_DESCRIPTORS completeness", () => {
  const EXPECTED_TOOL_IDS = [
    "terminal",
    "web-browser",
    "calculator",
    "document-scraper",
    "clock",
    "browserless",
    "ask-user",
    "rag",
    "skills",
    "ecm",
    "slash-commands",
  ];

  test("all expected tools are registered", () => {
    const registeredIds = TOOL_DESCRIPTORS.map((t) => t.id);
    for (const id of EXPECTED_TOOL_IDS) {
      expect(registeredIds).toContain(id);
    }
  });

  test("each descriptor has a non-empty relativeScript", () => {
    for (const tool of TOOL_DESCRIPTORS) {
      expect(tool.relativeScript.length).toBeGreaterThan(0);
      expect(tool.relativeScript).toMatch(/\.js$/);
    }
  });

  test("relativeScript ends with mcp-server.js", () => {
    for (const tool of TOOL_DESCRIPTORS) {
      expect(tool.relativeScript).toMatch(/mcp-server\.js$/);
    }
  });

  test("no two tools share the same id", () => {
    const ids = TOOL_DESCRIPTORS.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

describe("buildBridgeConfig — node path regression", () => {
  test("command is the absolute node path, not bare 'node'", () => {
    const config = buildBridgeConfig(INSTALL_ROOT, TOOL_DESCRIPTORS[0], FAKE_NODE_PATH);
    expect(config.command).not.toBe("node");
    expect(config.command).toContain("node");
    expect(config.command.length).toBeGreaterThan(4); // more than just "node"
  });

  test("command uses forward slashes on all platforms", () => {
    const config = buildBridgeConfig(INSTALL_ROOT, TOOL_DESCRIPTORS[0], FAKE_NODE_PATH);
    expect(config.command).not.toContain("\\");
  });

  test("args[0] uses forward slashes", () => {
    const config = buildBridgeConfig(INSTALL_ROOT, TOOL_DESCRIPTORS[0], FAKE_NODE_PATH);
    expect(config.args[0]).not.toContain("\\");
  });

  test("cwd uses forward slashes", () => {
    const config = buildBridgeConfig(INSTALL_ROOT, TOOL_DESCRIPTORS[0], FAKE_NODE_PATH);
    expect(config.cwd).not.toContain("\\");
  });

  test("args[0] is under install root", () => {
    const config = buildBridgeConfig(INSTALL_ROOT, TOOL_DESCRIPTORS[0], FAKE_NODE_PATH);
    const normalizedArg = config.args[0].toLowerCase();
    const normalizedInstallRoot = INSTALL_ROOT.replace(/\\/g, "/").toLowerCase();
    expect(normalizedArg).toContain(normalizedInstallRoot);
  });

  test("env object is present and is a plain object", () => {
    const config = buildBridgeConfig(INSTALL_ROOT, TOOL_DESCRIPTORS[0], FAKE_NODE_PATH);
    expect(typeof config.env).toBe("object");
    expect(config.env).not.toBeNull();
  });

  test("all tools produce a config with command, args, cwd, env", () => {
    for (const tool of TOOL_DESCRIPTORS) {
      const config = buildBridgeConfig(INSTALL_ROOT, tool, FAKE_NODE_PATH);
      expect(config).toHaveProperty("command");
      expect(config).toHaveProperty("args");
      expect(config).toHaveProperty("cwd");
      expect(config).toHaveProperty("env");
      expect(Array.isArray(config.args)).toBe(true);
      expect(config.args.length).toBeGreaterThan(0);
    }
  });

  test("fallback to 'node' when no absolute path given still works", () => {
    // Ensure the function signature is backward-compatible
    const config = buildBridgeConfig(INSTALL_ROOT, TOOL_DESCRIPTORS[0]);
    expect(config.command).toBe("node");
  });
});

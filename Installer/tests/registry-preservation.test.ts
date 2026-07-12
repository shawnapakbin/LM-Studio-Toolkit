/**
 * Preservation Property Tests — Registry Tool Configurations
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 *
 * These tests observe and lock in the existing behavior of:
 * 1. All non-ECM, non-BlenderBridge tool descriptors (exact id, displayName, relativeScript, env)
 * 2. buildBridgeConfig producing forward-slash paths for all preserved tools across varied installRoots
 * 3. PAYLOAD_ITEMS containing all expected non-ECM entries
 * 4. smoke-test-mcp.js containing all non-ECM tool entries with unchanged configurations
 * 5. verify-tools.js containing all existing tool entries with unchanged configurations
 *
 * Tests MUST PASS on unfixed code — they confirm baseline behavior to preserve.
 */

import { TOOL_DESCRIPTORS, buildBridgeConfig } from "../src/main/mcp-config";
import type { ToolDescriptor } from "../src/main/types";

// ─── Observation: Exact configurations of preserved (non-ECM, non-BlenderBridge) descriptors ───

const PRESERVED_DESCRIPTORS: Array<{
  id: string;
  displayName: string;
  relativeScript?: string;
  command?: string;
  args?: string[];
  env: Record<string, string>;
}> = [
  {
    id: "terminal",
    displayName: "Terminal",
    relativeScript: "Terminal/dist/mcp-server.js",
    env: {
      TERMINAL_DEFAULT_TIMEOUT_MS: "60000",
      TERMINAL_MAX_TIMEOUT_MS: "120000",
    },
  },
  {
    id: "web-browser",
    displayName: "WebBrowser",
    relativeScript: "WebBrowser/dist/mcp-server.js",
    env: {
      BROWSER_DEFAULT_TIMEOUT_MS: "20000",
      BROWSER_MAX_TIMEOUT_MS: "60000",
      BROWSER_MAX_CONTENT_CHARS: "12000",
      BROWSER_HEADLESS: "true",
    },
  },
  {
    id: "calculator",
    displayName: "Calculator",
    relativeScript: "Calculator/dist/mcp-server.js",
    env: {
      CALCULATOR_DEFAULT_PRECISION: "12",
      CALCULATOR_MAX_PRECISION: "20",
    },
  },
  {
    id: "document-scraper",
    displayName: "DocumentScraper",
    relativeScript: "DocumentScraper/dist/mcp-server.js",
    env: {
      DOC_SCRAPER_DEFAULT_TIMEOUT_MS: "20000",
      DOC_SCRAPER_MAX_TIMEOUT_MS: "60000",
      DOC_SCRAPER_MAX_CONTENT_BYTES: "52428800",
      DOC_SCRAPER_MAX_CONTENT_CHARS: "50000",
      DOC_SCRAPER_WORKSPACE_ROOT: "",
    },
  },
  {
    id: "clock",
    displayName: "Clock",
    relativeScript: "Clock/dist/mcp-server.js",
    env: {
      CLOCK_DEFAULT_TIMEZONE: "",
      CLOCK_DEFAULT_LOCALE: "en-US",
    },
  },
  {
    id: "browserless",
    displayName: "Browserless",
    relativeScript: "Browserless/scripts/schema-proxy.js",
    env: {
      BROWSERLESS_TOKEN: "",
      BROWSERLESS_API_URL: "",
    },
  },
  {
    id: "ask-user",
    displayName: "AskUser",
    relativeScript: "AskUser/dist/mcp-server.js",
    env: {
      ASK_USER_DB_PATH: "./memory.db",
      ASK_USER_DEFAULT_EXPIRES_SECONDS: "1800",
      ASK_USER_MAX_EXPIRES_SECONDS: "86400",
      ASK_USER_MAX_QUESTIONS: "20",
    },
  },
  {
    id: "rag",
    displayName: "RAG",
    relativeScript: "RAG/dist/mcp-server.js",
    env: {
      RAG_DB_PATH: "./rag.db",
      RAG_EMBEDDINGS_MODE: "lmstudio",
      RAG_EMBEDDING_MODEL: "nomic-ai/nomic-embed-text-v1.5",
      RAG_DOC_SCRAPER_ENDPOINT: "http://localhost:3336/tools/read_document",
      RAG_ASK_USER_ENDPOINT: "http://localhost:3338/tools/ask_user_interview",
      RAG_BYPASS_APPROVAL: "true",
      RAG_CHUNK_SIZE_TOKENS: "384",
      RAG_CHUNK_OVERLAP_TOKENS: "75",
    },
  },
  {
    id: "python-shell",
    displayName: "PythonShell",
    relativeScript: "PythonShell/dist/mcp-server.js",
    env: {
      PYTHON_SHELL_DEFAULT_TIMEOUT_MS: "60000",
      PYTHON_SHELL_MAX_TIMEOUT_MS: "120000",
      PYTHON_SHELL_MAX_OUTPUT_CHARS: "50000",
      PYTHON_SHELL_WORKSPACE_ROOT: "",
    },
  },
  {
    id: "skills",
    displayName: "Skills",
    relativeScript: "Skills/dist/mcp-server.js",
    env: {
      SKILLS_DB_PATH: "./skills.db",
    },
  },
  {
    id: "slash-commands",
    displayName: "SlashCommands",
    relativeScript: "SlashCommands/dist/mcp-server.js",
    env: {
      SLASH_DEFAULT_SESSION: "default",
    },
  },
];

// ─── Observation: Expected PAYLOAD_ITEMS (non-ECM entries) ───

const EXPECTED_NON_ECM_PAYLOAD_ITEMS = [
  "shared",
  "Terminal",
  "WebBrowser",
  "Calculator",
  "DocumentScraper",
  "Clock",
  "Browserless",
  "AskUser",
  "RAG",
  "PythonShell",
  "Memory",
  "Observability",
  "Skills",
  "SlashCommands",
  "BlenderBridge",
  "scripts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "README.md",
  "INSTALL.md",
  ".env.example",
];

// ─── Observation: Varied installRoot paths for property-based testing ───

const VARIED_INSTALL_ROOTS = [
  "C:\\Users\\Demo User\\AppData\\Roaming\\llm-toolkit",
  "C:\\Program Files\\llm-toolkit",
  "C:\\Users\\user with spaces\\toolkit",
  "/home/user/llm-toolkit",
  "/opt/llm-toolkit/",
  "D:\\Dev Tools\\my toolkit\\",
  "C:\\Users\\日本語ユーザー\\toolkit",
  "/home/user/path with spaces/toolkit",
  "C:\\a",
  "/usr/local/lib/llm-toolkit",
];

const FAKE_NODE_PATH = "C:\\Users\\Demo User\\AppData\\Roaming\\llm-toolkit-installer\\runtime-cache\\node-v20.17.0-win32-x64\\node.exe";

// ─── Property Test: Descriptor Identity Preservation ───

describe("Property 2: Preservation — Descriptor Identity", () => {
  const preservedFromRegistry = TOOL_DESCRIPTORS.filter(
    (t) => t.id !== "ecm" && t.id !== "blender-bridge",
  );

  test("all 11 preserved descriptors are present in TOOL_DESCRIPTORS", () => {
    const registeredIds = TOOL_DESCRIPTORS.map((t) => t.id);
    for (const expected of PRESERVED_DESCRIPTORS) {
      expect(registeredIds).toContain(expected.id);
    }
  });

  test.each(PRESERVED_DESCRIPTORS)(
    "descriptor '$id' retains exact id, displayName, script/command, and env",
    (expected) => {
      const actual = TOOL_DESCRIPTORS.find((t) => t.id === expected.id);
      expect(actual).toBeDefined();
      expect(actual!.id).toBe(expected.id);
      expect(actual!.displayName).toBe(expected.displayName);
      if (expected.command) {
        // Command-based descriptor
        expect(actual!.command).toBe(expected.command);
        expect(actual!.args).toEqual(expected.args);
      } else {
        // Node-based descriptor
        expect(actual!.relativeScript).toBe(expected.relativeScript);
      }
      expect(actual!.env).toEqual(expected.env);
    },
  );

  test("no preserved descriptor has been mutated (deep equality check)", () => {
    for (const expected of PRESERVED_DESCRIPTORS) {
      const actual = TOOL_DESCRIPTORS.find((t) => t.id === expected.id);
      expect(actual).toEqual(expected);
    }
  });
});

// ─── Property Test: buildBridgeConfig Forward-Slash Output ───

describe("Property 2: Preservation — buildBridgeConfig forward slashes", () => {
  const preservedTools = TOOL_DESCRIPTORS.filter(
    (t) => t.id !== "ecm" && t.id !== "blender-bridge",
  );

  const nodeBasedTools = preservedTools.filter((t) => t.relativeScript);
  const commandBasedTools = preservedTools.filter((t) => t.command && !t.relativeScript);

  describe.each(VARIED_INSTALL_ROOTS)("installRoot = %s", (installRoot) => {
    test.each(nodeBasedTools.map((t) => [t.id, t] as [string, ToolDescriptor]))(
      "node-based tool '%s' → command, args[0], cwd have no backslashes",
      (_id, tool) => {
        const config = buildBridgeConfig(installRoot, tool, FAKE_NODE_PATH);

        // command uses forward slashes
        expect(config.command).not.toContain("\\");
        // args[0] uses forward slashes
        expect(config.args[0]).not.toContain("\\");
        // cwd uses forward slashes
        expect(config.cwd).not.toContain("\\");
      },
    );

    if (commandBasedTools.length > 0) {
      test.each(commandBasedTools.map((t) => [t.id, t] as [string, ToolDescriptor]))(
        "command-based tool '%s' → returns command, args, env without cwd",
        (_id, tool) => {
          const config = buildBridgeConfig(installRoot, tool, FAKE_NODE_PATH);

          expect(config.command).toBe(tool.command);
          expect(config.args).toEqual(tool.args);
          expect(config.env).toEqual(tool.env);
          expect(config).not.toHaveProperty("cwd");
        },
      );
    }
  });

  test("buildBridgeConfig returns valid structure for all node-based preserved tools", () => {
    for (const tool of nodeBasedTools) {
      for (const installRoot of VARIED_INSTALL_ROOTS) {
        const config = buildBridgeConfig(installRoot, tool, FAKE_NODE_PATH);
        expect(config).toHaveProperty("command");
        expect(config).toHaveProperty("args");
        expect(config).toHaveProperty("cwd");
        expect(config).toHaveProperty("env");
        expect(Array.isArray(config.args)).toBe(true);
        expect(config.args.length).toBe(1);
        expect(typeof config.command).toBe("string");
        expect(typeof config.cwd).toBe("string");
        expect(typeof config.env).toBe("object");
      }
    }
  });

  test("buildBridgeConfig returns valid structure for all command-based preserved tools", () => {
    for (const tool of commandBasedTools) {
      for (const installRoot of VARIED_INSTALL_ROOTS) {
        const config = buildBridgeConfig(installRoot, tool, FAKE_NODE_PATH);
        expect(config).toHaveProperty("command");
        expect(config).toHaveProperty("args");
        expect(config).not.toHaveProperty("cwd");
        expect(config).toHaveProperty("env");
        expect(typeof config.command).toBe("string");
        expect(Array.isArray(config.args)).toBe(true);
        expect(typeof config.env).toBe("object");
      }
    }
  });
});

// ─── Property Test: PAYLOAD_ITEMS Preservation ───

describe("Property 2: Preservation — PAYLOAD_ITEMS non-ECM entries", () => {
  /**
   * Since PAYLOAD_ITEMS is in an ESM .mjs file that cannot be imported in
   * a CommonJS Jest test, we read and parse it from the file system.
   */
  const fs = require("node:fs");
  const path = require("node:path");

  const stagePayloadPath = path.join(__dirname, "..", "scripts", "stage-payload.mjs");
  const fileContent: string = fs.readFileSync(stagePayloadPath, "utf8");

  // Extract the PAYLOAD_ITEMS array from the file content
  const arrayMatch = fileContent.match(
    /const PAYLOAD_ITEMS\s*=\s*\[([\s\S]*?)\];/,
  );

  const parsedItems: string[] = arrayMatch
    ? arrayMatch[1]
        .split("\n")
        .map((line: string) => {
          const match = line.match(/"([^"]+)"/);
          return match ? match[1] : null;
        })
        .filter((item: string | null): item is string => item !== null)
    : [];

  test("PAYLOAD_ITEMS file was successfully read and parsed", () => {
    expect(parsedItems.length).toBeGreaterThan(0);
  });

  test.each(EXPECTED_NON_ECM_PAYLOAD_ITEMS)(
    "PAYLOAD_ITEMS contains '%s'",
    (item) => {
      expect(parsedItems).toContain(item);
    },
  );

  test("all expected non-ECM payload items are present", () => {
    for (const item of EXPECTED_NON_ECM_PAYLOAD_ITEMS) {
      expect(parsedItems).toContain(item);
    }
  });
});


// ─── Observation: Expected smoke-test-mcp.js tools (non-ECM) ───

const EXPECTED_SMOKE_TEST_TOOLS = [
  { name: "Terminal", dist: "Terminal/dist/mcp-server.js" },
  { name: "WebBrowser", dist: "WebBrowser/dist/mcp-server.js" },
  { name: "Calculator", dist: "Calculator/dist/mcp-server.js" },
  { name: "DocumentScraper", dist: "DocumentScraper/dist/mcp-server.js" },
  { name: "Clock", dist: "Clock/dist/mcp-server.js" },
  { name: "AskUser", dist: "AskUser/dist/mcp-server.js" },
  { name: "RAG", dist: "RAG/dist/mcp-server.js" },
  { name: "PythonShell", dist: "PythonShell/dist/mcp-server.js" },
  { name: "Skills", dist: "Skills/dist/mcp-server.js" },
  { name: "SlashCommands", dist: "SlashCommands/dist/mcp-server.js" },
];

// ─── Observation: Expected verify-tools.js tools ───

const EXPECTED_VERIFY_TOOLS = [
  { name: "Terminal", dist: "Terminal/dist/mcp-server.js", src: "Terminal/src/mcp-server.ts" },
  { name: "WebBrowser", dist: "WebBrowser/dist/mcp-server.js", src: "WebBrowser/src/mcp-server.ts" },
  { name: "Calculator", dist: "Calculator/dist/mcp-server.js", src: "Calculator/src/mcp-server.ts" },
  { name: "DocumentScraper", dist: "DocumentScraper/dist/mcp-server.js", src: "DocumentScraper/src/mcp-server.ts" },
  { name: "Clock", dist: "Clock/dist/mcp-server.js", src: "Clock/src/mcp-server.ts" },
  { name: "AskUser", dist: "AskUser/dist/mcp-server.js", src: "AskUser/src/mcp-server.ts" },
  { name: "RAG", dist: "RAG/dist/mcp-server.js", src: "RAG/src/mcp-server.ts" },
  { name: "PythonShell", dist: "PythonShell/dist/mcp-server.js", src: "PythonShell/src/mcp-server.ts" },
  { name: "SlashCommands", dist: "SlashCommands/dist/mcp-server.js", src: "SlashCommands/src/mcp-server.ts" },
];


// ─── Property Test: smoke-test-mcp.js Tools Preservation ───

describe("Property 2: Preservation — smoke-test-mcp.js non-ECM tools", () => {
  /**
   * **Validates: Requirements 3.5**
   *
   * Read and parse the smoke-test-mcp.js file to verify all non-ECM tools
   * remain present with their exact entries.
   */
  const fs = require("node:fs");
  const path = require("node:path");

  const smokeTestPath = path.join(__dirname, "..", "..", "scripts", "workspace", "smoke-test-mcp.js");
  const fileContent: string = fs.readFileSync(smokeTestPath, "utf8");

  // Extract the tools array from the file content
  const toolsArrayMatch = fileContent.match(
    /const tools\s*=\s*\[([\s\S]*?)\];/,
  );

  // Parse each tool entry: { name: "...", dist: "..." }
  const parsedTools: Array<{ name: string; dist: string }> = [];
  if (toolsArrayMatch) {
    const entriesStr = toolsArrayMatch[1];
    const entryRegex = /\{\s*name:\s*"([^"]+)",\s*dist:\s*"([^"]+)"\s*\}/g;
    let match: RegExpExecArray | null;
    while ((match = entryRegex.exec(entriesStr)) !== null) {
      parsedTools.push({ name: match[1], dist: match[2] });
    }
  }

  test("smoke-test-mcp.js was successfully read and parsed", () => {
    expect(parsedTools.length).toBeGreaterThan(0);
  });

  test.each(EXPECTED_SMOKE_TEST_TOOLS)(
    "smoke-test-mcp.js contains tool '$name' with dist '$dist'",
    (expected) => {
      const found = parsedTools.find((t) => t.name === expected.name);
      expect(found).toBeDefined();
      expect(found!.dist).toBe(expected.dist);
    },
  );

  test("all non-ECM smoke test tools are present with unchanged entries", () => {
    for (const expected of EXPECTED_SMOKE_TEST_TOOLS) {
      const found = parsedTools.find((t) => t.name === expected.name);
      expect(found).toBeDefined();
      expect(found).toEqual(expected);
    }
  });
});


// ─── Property Test: verify-tools.js Tools Preservation ───

describe("Property 2: Preservation — verify-tools.js existing tools", () => {
  /**
   * **Validates: Requirements 3.6**
   *
   * Read and parse the verify-tools.js file to verify all existing tools
   * remain present with their exact entries.
   */
  const fs = require("node:fs");
  const path = require("node:path");

  const verifyToolsPath = path.join(__dirname, "..", "..", "scripts", "workspace", "verify-tools.js");
  const fileContent: string = fs.readFileSync(verifyToolsPath, "utf8");

  // Extract the tools array from the file content
  const toolsArrayMatch = fileContent.match(
    /const tools\s*=\s*\[([\s\S]*?)\];/,
  );

  // Parse each tool entry: { name: "...", dist: "...", src: "..." }
  // Entries may span multiple lines in the source file
  const parsedTools: Array<{ name: string; dist: string; src: string }> = [];
  if (toolsArrayMatch) {
    const entriesStr = toolsArrayMatch[1];
    const entryRegex = /\{\s*name:\s*"([^"]+)"[\s\S]*?dist:\s*"([^"]+)"[\s\S]*?src:\s*"([^"]+)"[\s\S]*?\}/g;
    let match: RegExpExecArray | null;
    while ((match = entryRegex.exec(entriesStr)) !== null) {
      parsedTools.push({ name: match[1], dist: match[2], src: match[3] });
    }
  }

  test("verify-tools.js was successfully read and parsed", () => {
    expect(parsedTools.length).toBeGreaterThan(0);
  });

  test.each(EXPECTED_VERIFY_TOOLS)(
    "verify-tools.js contains tool '$name' with dist '$dist' and src '$src'",
    (expected) => {
      const found = parsedTools.find((t) => t.name === expected.name);
      expect(found).toBeDefined();
      expect(found!.dist).toBe(expected.dist);
      expect(found!.src).toBe(expected.src);
    },
  );

  test("all existing verify-tools entries are present with unchanged entries", () => {
    for (const expected of EXPECTED_VERIFY_TOOLS) {
      const found = parsedTools.find((t) => t.name === expected.name);
      expect(found).toBeDefined();
      expect(found).toEqual(expected);
    }
  });
});

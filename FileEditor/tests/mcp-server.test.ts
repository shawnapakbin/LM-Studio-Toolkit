import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Unit tests for the FileEditor MCP server module (`src/mcp-server.ts`).
 *
 * The module registers its tools and calls `main()` (which connects a
 * StdioServerTransport) as a side effect of import. To exercise it in a unit
 * test without opening a real stdio transport, we mock the MCP SDK's
 * `McpServer` and `StdioServerTransport`. The mock captures every
 * `registerTool(name, config, handler)` call so the tests can assert the tool
 * set, the Git-style result envelope, the per-tool policy checks, and that the
 * server boots by connecting a transport.
 */

type RegisteredTool = {
  name: string;
  config: { description?: string; inputSchema?: Record<string, unknown> };
  handler: (args: Record<string, unknown>) => Promise<{
    isError: boolean;
    content: Array<{ type: string; text: string }>;
    structuredContent?: unknown;
  }>;
};

const registeredTools: RegisteredTool[] = [];
const connectMock = jest.fn(async (_transport: unknown) => undefined);
const transportCtor = jest.fn();

jest.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    constructor(public info: { name: string; version: string }) {}
    registerTool(
      name: string,
      config: RegisteredTool["config"],
      handler: RegisteredTool["handler"],
    ) {
      registeredTools.push({ name, config, handler });
    }
    connect = connectMock;
  },
}));

jest.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {
    constructor() {
      transportCtor();
    }
  },
}));

const EXPECTED_TOOLS = [
  "read_file",
  "write_file",
  "search_files",
  "list_directory",
  "delete_file",
  "move_file",
] as const;

let workspaceRoot: string;

/** Load the module fresh so its top-level registration/boot side effects run. */
function loadServerModule(): void {
  registeredTools.length = 0;
  connectMock.mockClear();
  transportCtor.mockClear();
  jest.isolateModules(() => {
    require("../src/mcp-server");
  });
}

function getTool(name: string): RegisteredTool {
  const tool = registeredTools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Tool not registered: ${name}`);
  }
  return tool;
}

beforeAll(() => {
  // Point the server's workspace root at an isolated temp directory so the
  // policy path checks resolve against a known sandbox and real file
  // operations stay contained.
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "file-editor-mcp-"));
  process.env.FILE_EDITOR_WORKSPACE_ROOT = workspaceRoot;
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  loadServerModule();
});

afterAll(() => {
  jest.restoreAllMocks();
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  delete process.env.FILE_EDITOR_WORKSPACE_ROOT;
});

describe("FileEditor MCP server", () => {
  test("registers exactly six tools with the expected names", () => {
    expect(registeredTools).toHaveLength(6);
    expect(registeredTools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  test("every registered tool has a description and input schema", () => {
    for (const tool of registeredTools) {
      expect(typeof tool.config.description).toBe("string");
      expect(tool.config.description!.length).toBeGreaterThan(0);
      expect(tool.config.inputSchema).toBeDefined();
    }
  });

  test("boots under stdio by connecting a StdioServerTransport", () => {
    expect(transportCtor).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledTimes(1);
    // The transport instance passed to connect is the mocked stdio transport.
    expect(connectMock.mock.calls[0][0]).toBeDefined();
  });

  describe("Git-style result envelope", () => {
    test("read_file returns a success envelope with structuredContent", async () => {
      const filePath = "envelope.txt";
      fs.writeFileSync(path.join(workspaceRoot, filePath), "line one\nline two\n");

      const result = await getTool("read_file").handler({ path: filePath });

      expect(result.isError).toBe(false);
      expect(result.content[0].type).toBe("text");
      expect(result.structuredContent).toEqual({ content: "line one\nline two\n", lines: 3 });
      // content text is the JSON-stringified structured result.
      expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    });

    test("failure returns an error envelope with a '<tool> failed:' message and no structuredContent", async () => {
      const result = await getTool("read_file").handler({ path: "does-not-exist.txt" });

      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toMatch(/^read_file failed: /);
      expect(result.structuredContent).toBeUndefined();
    });
  });

  describe("per-tool policy checks", () => {
    test("read_file blocks path traversal (validatePath)", async () => {
      const result = await getTool("read_file").handler({ path: "../escape.txt" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("read_file failed:");
      expect(result.content[0].text).toMatch(/Path traversal|parent directory/i);
    });

    test("read_file blocks sensitive system paths (isBlockedPath)", async () => {
      const result = await getTool("read_file").handler({
        path: "C:/Windows/System32/drivers/etc/hosts",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("read_file failed:");
    });

    test("write_file blocks executable extensions (isAllowedExtensionForWrite)", async () => {
      const result = await getTool("write_file").handler({
        path: "installer.exe",
        content: "safe text",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/write_file failed: .*executable\/binary/i);
    });

    test("write_file blocks unsafe content (validateContentSafety)", async () => {
      const result = await getTool("write_file").handler({
        path: "script.txt",
        content: "rm -rf /",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/write_file failed: .*dangerous pattern/i);
    });

    test("write_file succeeds for safe content and returns a success envelope", async () => {
      const result = await getTool("write_file").handler({
        path: "safe-write.txt",
        content: "hello world",
      });
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({ bytesWritten: expect.any(Number) });
      expect(fs.readFileSync(path.join(workspaceRoot, "safe-write.txt"), "utf-8")).toBe(
        "hello world",
      );
    });

    test("list_directory validates the path (validatePath)", async () => {
      const result = await getTool("list_directory").handler({ path: "../outside" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("list_directory failed:");
    });

    test("list_directory returns a files+count payload on success", async () => {
      fs.mkdirSync(path.join(workspaceRoot, "listing"), { recursive: true });
      fs.writeFileSync(path.join(workspaceRoot, "listing", "a.txt"), "a");

      const result = await getTool("list_directory").handler({ path: "listing" });
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({ count: expect.any(Number) });
      expect((result.structuredContent as { files: unknown[] }).files.length).toBeGreaterThan(0);
    });

    test("delete_file blocks protected project files (canDelete)", async () => {
      const result = await getTool("delete_file").handler({ path: "package.json" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/delete_file failed: .*protected/i);
    });

    test("delete_file blocks path traversal (validatePath)", async () => {
      const result = await getTool("delete_file").handler({ path: "../secret.txt" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("delete_file failed:");
    });

    test("move_file validates both source and destination (validatePath)", async () => {
      fs.writeFileSync(path.join(workspaceRoot, "movable.txt"), "content");

      const badSource = await getTool("move_file").handler({
        source: "../outside-source.txt",
        destination: "dest.txt",
      });
      expect(badSource.isError).toBe(true);
      expect(badSource.content[0].text).toContain("move_file failed:");

      const badDest = await getTool("move_file").handler({
        source: "movable.txt",
        destination: "../outside-dest.txt",
      });
      expect(badDest.isError).toBe(true);
      expect(badDest.content[0].text).toContain("move_file failed:");
    });

    test("search_files performs schema-only validation and returns results+count", async () => {
      fs.writeFileSync(path.join(workspaceRoot, "haystack.txt"), "find the needle here");

      const result = await getTool("search_files").handler({ pattern: "needle" });
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({ count: expect.any(Number) });
    });
  });
});

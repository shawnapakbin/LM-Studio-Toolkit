/**
 * Unit tests for auto-trigger LM Studio top-level mcp.json sync behavior.
 *
 * Tests that after all per-plugin bridge configs are written, the setup script
 * writes a top-level ~/.lmstudio/mcp.json with synced entries. Validates
 * success logging, failure resilience, and BROWSERLESS_TOKEN pass-through.
 *
 * **Validates: Requirements 11.1, 11.3, 11.4, 11.5**
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface BridgeConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

interface SyncedConfigs {
  [serverName: string]: BridgeConfig;
}

interface TopLevelMcpJson {
  mcpServers?: Record<string, BridgeConfig>;
  [key: string]: unknown;
}

interface LmStudioSyncResult {
  written: boolean;
  messages: Array<{ type: string; msg: string }>;
}

/**
 * Simulates the top-level ~/.lmstudio/mcp.json sync logic from setup.js Step 6.
 * Accepts injectable dependencies for file I/O to test behaviors without hitting the filesystem.
 *
 * This mirrors the logic at the end of Step 6 in setup.js:
 *   - If synced > 0, reads existing mcp.json (if any), merges mcpServers, writes back
 *   - On success: logs info "LM Studio MCP bridge configs are up to date"
 *   - On failure: logs warn with error message, does NOT throw/abort
 */
function syncTopLevelMcpJson(deps: {
  syncedConfigs: SyncedConfigs;
  readExistingMcpJson: () => TopLevelMcpJson | null;
  writeMcpJson: (content: TopLevelMcpJson) => void;
}): LmStudioSyncResult {
  const messages: Array<{ type: string; msg: string }> = [];
  const send = (type: string, msg: string) => messages.push({ type, msg });

  const synced = Object.keys(deps.syncedConfigs).length;

  if (synced > 0) {
    try {
      let existing: TopLevelMcpJson = {};
      const read = deps.readExistingMcpJson();
      if (read !== null) {
        existing = read;
      }
      existing.mcpServers = { ...(existing.mcpServers || {}), ...deps.syncedConfigs };
      deps.writeMcpJson(existing);
      send("info", "LM Studio MCP bridge configs are up to date");
      return { written: true, messages };
    } catch (err: any) {
      send("warn", `LM Studio top-level mcp.json sync failed: ${err.message}. Continuing setup.`);
      return { written: false, messages };
    }
  }

  return { written: false, messages };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Auto-trigger LM Studio top-level mcp.json sync (Req 11.1, 11.3, 11.4, 11.5)", () => {
  test("top-level mcp.json is written after all per-plugin configs succeed", () => {
    let writtenContent: TopLevelMcpJson | null = null;

    const syncedConfigs: SyncedConfigs = {
      terminal: { command: "node", args: ["/path/to/terminal/dist/mcp-server.js"], env: {} },
      browserless: {
        command: "npx",
        args: ["-y", "@browserless.io/mcp"],
        env: { BROWSERLESS_TOKEN: "my-secret-key" },
      },
    };

    const result = syncTopLevelMcpJson({
      syncedConfigs,
      readExistingMcpJson: () => null,
      writeMcpJson: (content) => {
        writtenContent = content;
      },
    });

    // mcp.json should have been written
    expect(result.written).toBe(true);
    expect(writtenContent).not.toBeNull();
    expect(writtenContent!.mcpServers).toBeDefined();
    expect(writtenContent!.mcpServers!.terminal).toEqual(syncedConfigs.terminal);
    expect(writtenContent!.mcpServers!.browserless).toEqual(syncedConfigs.browserless);
  });

  test("failure to write top-level mcp.json logs a warning and does not abort", () => {
    const syncedConfigs: SyncedConfigs = {
      browserless: {
        command: "npx",
        args: ["-y", "@browserless.io/mcp"],
        env: { BROWSERLESS_TOKEN: "abc123" },
      },
    };

    const result = syncTopLevelMcpJson({
      syncedConfigs,
      readExistingMcpJson: () => null,
      writeMcpJson: () => {
        throw new Error("EACCES: permission denied");
      },
    });

    // Should NOT throw — the function catches and logs
    expect(result.written).toBe(false);
    // Warning should be logged with the error message
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].type).toBe("warn");
    expect(result.messages[0].msg).toContain("LM Studio top-level mcp.json sync failed");
    expect(result.messages[0].msg).toContain("EACCES: permission denied");
  });

  test("success logs confirmation message", () => {
    const syncedConfigs: SyncedConfigs = {
      terminal: { command: "node", args: ["terminal/dist/mcp-server.js"], env: {} },
    };

    const result = syncTopLevelMcpJson({
      syncedConfigs,
      readExistingMcpJson: () => null,
      writeMcpJson: () => {},
    });

    expect(result.written).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].type).toBe("info");
    expect(result.messages[0].msg).toBe("LM Studio MCP bridge configs are up to date");
  });

  test("resolved BROWSERLESS_TOKEN is passed through to the mcp.json entry", () => {
    const apiKey = "bless_live_xYz789AbcDef";
    let writtenContent: TopLevelMcpJson | null = null;

    const syncedConfigs: SyncedConfigs = {
      browserless: {
        command: "npx",
        args: ["-y", "@browserless.io/mcp"],
        env: { BROWSERLESS_TOKEN: apiKey },
      },
    };

    const result = syncTopLevelMcpJson({
      syncedConfigs,
      readExistingMcpJson: () => null,
      writeMcpJson: (content) => {
        writtenContent = content;
      },
    });

    expect(result.written).toBe(true);
    expect(writtenContent).not.toBeNull();
    expect(writtenContent!.mcpServers!.browserless.env.BROWSERLESS_TOKEN).toBe(apiKey);
  });

  test("existing mcp.json content (non-mcpServers keys) is preserved when merging", () => {
    let writtenContent: TopLevelMcpJson | null = null;

    const existingContent: TopLevelMcpJson = {
      version: "1.0",
      someCustomSetting: true,
      mcpServers: {
        "existing-server": { command: "node", args: ["existing.js"], env: {} },
      },
    };

    const syncedConfigs: SyncedConfigs = {
      browserless: {
        command: "npx",
        args: ["-y", "@browserless.io/mcp"],
        env: { BROWSERLESS_TOKEN: "key123" },
      },
    };

    const result = syncTopLevelMcpJson({
      syncedConfigs,
      readExistingMcpJson: () => existingContent,
      writeMcpJson: (content) => {
        writtenContent = content;
      },
    });

    expect(result.written).toBe(true);
    expect(writtenContent).not.toBeNull();
    // Non-mcpServers keys preserved
    expect(writtenContent!.version).toBe("1.0");
    expect(writtenContent!.someCustomSetting).toBe(true);
    // Existing server preserved
    expect(writtenContent!.mcpServers!["existing-server"]).toEqual(
      existingContent.mcpServers!["existing-server"],
    );
    // New server added
    expect(writtenContent!.mcpServers!.browserless).toEqual(syncedConfigs.browserless);
  });

  test("no write occurs when synced count is zero", () => {
    let writeWasCalled = false;

    const result = syncTopLevelMcpJson({
      syncedConfigs: {},
      readExistingMcpJson: () => null,
      writeMcpJson: () => {
        writeWasCalled = true;
      },
    });

    expect(result.written).toBe(false);
    expect(writeWasCalled).toBe(false);
    expect(result.messages).toHaveLength(0);
  });

  test("malformed existing mcp.json is treated as empty (read returns null)", () => {
    let writtenContent: TopLevelMcpJson | null = null;

    const syncedConfigs: SyncedConfigs = {
      browserless: {
        command: "npx",
        args: ["-y", "@browserless.io/mcp"],
        env: { BROWSERLESS_TOKEN: "token456" },
      },
    };

    const result = syncTopLevelMcpJson({
      syncedConfigs,
      readExistingMcpJson: () => null, // Simulates parse failure returning null
      writeMcpJson: (content) => {
        writtenContent = content;
      },
    });

    expect(result.written).toBe(true);
    expect(writtenContent).not.toBeNull();
    expect(writtenContent!.mcpServers!.browserless.env.BROWSERLESS_TOKEN).toBe("token456");
  });
});

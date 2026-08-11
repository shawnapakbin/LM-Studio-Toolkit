// Unit tests for tool registration
// **Validates: Requirements 2.4, 8.1, 8.2**

import * as os from "os";
import * as path from "path";

// Set required env vars before importing tool modules
process.env.ASK_USER_DB_PATH = path.join(os.tmpdir(), "reg-test-" + Date.now() + ".db");
process.env.CALCULATOR_DEFAULT_PRECISION = "12";
process.env.CALCULATOR_MAX_PRECISION = "20";
process.env.CLOCK_DEFAULT_TIMEZONE = "";
process.env.CLOCK_DEFAULT_LOCALE = "en-US";
process.env.DOC_SCRAPER_DEFAULT_TIMEOUT_MS = "20000";
process.env.DOC_SCRAPER_MAX_TIMEOUT_MS = "60000";
process.env.DOC_SCRAPER_MAX_CONTENT_BYTES = "52428800";
process.env.DOC_SCRAPER_MAX_CONTENT_CHARS = "50000";
process.env.DOC_SCRAPER_WORKSPACE_ROOT = "";

import { registerAskUserTool } from "../../src/tools/ask-user";
import { registerCalculatorTool } from "../../src/tools/calculator";
import { registerClockTool } from "../../src/tools/clock";
import { registerDocumentScraperTool } from "../../src/tools/document-scraper";

describe("Tool Registration", () => {
  const registeredTools: Array<{
    name: string;
    config: { description: string; inputSchema: unknown };
  }> = [];

  // Create a minimal mock of McpServer that captures registerTool calls
  const mockServer = {
    registerTool: jest.fn(
      (name: string, config: { description: string; inputSchema: unknown }, _handler: unknown) => {
        registeredTools.push({ name, config });
      },
    ),
  };

  beforeAll(() => {
    registerCalculatorTool(mockServer as any);
    registerClockTool(mockServer as any);
    registerAskUserTool(mockServer as any);
    registerDocumentScraperTool(mockServer as any);
  });

  it("should register exactly 4 tools", () => {
    expect(registeredTools).toHaveLength(4);
  });

  it("should register 'calculate_engineering' tool", () => {
    const tool = registeredTools.find((t) => t.name === "calculate_engineering");
    expect(tool).toBeDefined();
  });

  it("should register 'get_current_datetime' tool", () => {
    const tool = registeredTools.find((t) => t.name === "get_current_datetime");
    expect(tool).toBeDefined();
  });

  it("should register 'interview_user' tool", () => {
    const tool = registeredTools.find((t) => t.name === "interview_user");
    expect(tool).toBeDefined();
  });

  it("should register 'read_document' tool", () => {
    const tool = registeredTools.find((t) => t.name === "read_document");
    expect(tool).toBeDefined();
  });

  describe("input schemas", () => {
    it("calculate_engineering should have expression and precision in schema", () => {
      const tool = registeredTools.find((t) => t.name === "calculate_engineering");
      expect(tool).toBeDefined();
      const schema = tool!.config.inputSchema as Record<string, unknown>;
      expect(schema.expression).toBeDefined();
      expect(schema.precision).toBeDefined();
    });

    it("get_current_datetime should have timeZone and locale in schema", () => {
      const tool = registeredTools.find((t) => t.name === "get_current_datetime");
      expect(tool).toBeDefined();
      const schema = tool!.config.inputSchema as Record<string, unknown>;
      expect(schema.timeZone).toBeDefined();
      expect(schema.locale).toBeDefined();
    });

    it("interview_user should have action, questions, interviewId, and responses in schema", () => {
      const tool = registeredTools.find((t) => t.name === "interview_user");
      expect(tool).toBeDefined();
      const schema = tool!.config.inputSchema as Record<string, unknown>;
      expect(schema.action).toBeDefined();
      expect(schema.questions).toBeDefined();
      expect(schema.interviewId).toBeDefined();
      expect(schema.responses).toBeDefined();
    });

    it("read_document should have filePath in schema", () => {
      const tool = registeredTools.find((t) => t.name === "read_document");
      expect(tool).toBeDefined();
      const schema = tool!.config.inputSchema as Record<string, unknown>;
      expect(schema.filePath).toBeDefined();
    });
  });

  describe("tool descriptions", () => {
    it("each registered tool should have a non-empty description", () => {
      for (const tool of registeredTools) {
        expect(tool.config.description).toBeTruthy();
        expect(typeof tool.config.description).toBe("string");
        expect(tool.config.description.length).toBeGreaterThan(0);
      }
    });
  });
});

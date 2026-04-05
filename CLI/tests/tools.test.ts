/**
 * CLI tools command — unit tests with mocked HTTP
 */

import { Command } from "commander";
import { registerToolsCommands } from "../src/commands/tools";

jest.mock("../src/http", () => ({
  toolGet: jest.fn(),
  handleError: jest.fn(),
}));

import { handleError, toolGet } from "../src/http";

const mockToolGet = toolGet as jest.MockedFunction<typeof toolGet>;
const mockHandleError = handleError as jest.MockedFunction<typeof handleError>;

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerToolsCommands(program);
  return program;
}

beforeEach(() => jest.clearAllMocks());

describe("tools command", () => {
  describe("tools list", () => {
    it("prints all registered tool endpoints without HTTP calls", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      await makeProgram().parseAsync(["node", "llm", "tools", "list"]);

      expect(mockToolGet).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Registered tools:"));
      consoleSpy.mockRestore();
    });
  });

  describe("tools health", () => {
    it("checks health for all tools", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      mockToolGet.mockResolvedValue({ ok: true });

      await makeProgram().parseAsync(["node", "llm", "tools", "health"]);

      expect(mockToolGet).toHaveBeenCalledTimes(
        Object.keys(require("../src/config").TOOL_ENDPOINTS).length,
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("✓ healthy"));
      consoleSpy.mockRestore();
    });

    it("shows unreachable for tools that throw", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      mockToolGet.mockRejectedValue(new Error("ECONNREFUSED"));

      await makeProgram().parseAsync(["node", "llm", "tools", "health"]);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("✗ unreachable"));
      consoleSpy.mockRestore();
    });

    it("checks only the specified tool with --tool flag", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      mockToolGet.mockResolvedValue({ ok: true });

      await makeProgram().parseAsync(["node", "llm", "tools", "health", "--tool", "calculator"]);

      expect(mockToolGet).toHaveBeenCalledTimes(1);
      expect(mockToolGet).toHaveBeenCalledWith(expect.stringContaining("3335"));
      consoleSpy.mockRestore();
    });
  });

  describe("tools schema", () => {
    it("fetches and prints schema for a known tool", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      const schema = { name: "calculate_engineering", parameters: {} };
      mockToolGet.mockResolvedValue(schema);

      await makeProgram().parseAsync(["node", "llm", "tools", "schema", "calculator"]);

      expect(mockToolGet).toHaveBeenCalledWith(expect.stringContaining("/tool-schema"));
      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(schema, null, 2));
      consoleSpy.mockRestore();
    });

    it("calls handleError on HTTP failure", async () => {
      mockToolGet.mockRejectedValue(new Error("HTTP 404"));

      await makeProgram().parseAsync(["node", "llm", "tools", "schema", "calculator"]);

      expect(mockHandleError).toHaveBeenCalled();
    });
  });
});

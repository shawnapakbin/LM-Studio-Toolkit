/**
 * CLI config command — unit tests with mocked file system
 */

import { Command } from "commander";
import {
  CONFIG_FILE_PATH,
  loadConfig,
  registerConfigCommands,
  saveConfig,
} from "../src/commands/config";

// Mock fs so no real files are touched
jest.mock("fs");
import fs from "fs";

const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
const mockWriteFileSync = fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>;

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerConfigCommands(program);
  return program;
}

beforeEach(() => jest.clearAllMocks());

describe("loadConfig", () => {
  it("returns parsed JSON when file exists", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ "calculator.port": 4000 }));
    expect(loadConfig()).toEqual({ "calculator.port": 4000 });
  });

  it("returns empty object when file does not exist", () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(loadConfig()).toEqual({});
  });

  it("returns empty object on invalid JSON", () => {
    mockReadFileSync.mockReturnValue("not-json");
    expect(loadConfig()).toEqual({});
  });
});

describe("saveConfig", () => {
  it("writes JSON to the config file", () => {
    saveConfig({ "calculator.port": 4000 });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      CONFIG_FILE_PATH,
      JSON.stringify({ "calculator.port": 4000 }, null, 2),
      "utf-8",
    );
  });
});

describe("config command", () => {
  describe("config show", () => {
    it("prints all tool endpoints with defaults when no overrides", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      await makeProgram().parseAsync(["node", "llm", "config", "show"]);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("CLI Configuration:"));
      // Should show at least one tool endpoint
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("http://localhost:"));
      consoleSpy.mockRestore();
    });

    it("marks overridden entries", async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ "calculator.port": 9999 }));
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      await makeProgram().parseAsync(["node", "llm", "config", "show"]);

      const allCalls = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allCalls).toContain("9999");
      expect(allCalls).toContain("(overridden)");
      consoleSpy.mockRestore();
    });

    it("shows overrides section when overrides exist", async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ "clock.host": "10.0.0.1" }));
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      await makeProgram().parseAsync(["node", "llm", "config", "show"]);

      const allCalls = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allCalls).toContain("Overrides stored:");
      expect(allCalls).toContain("10.0.0.1");
      consoleSpy.mockRestore();
    });
  });

  describe("config set", () => {
    it("saves a port override as a number", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      await makeProgram().parseAsync(["node", "llm", "config", "set", "calculator.port", "4000"]);

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"calculator.port": 4000'),
        "utf-8",
      );
      expect(consoleSpy).toHaveBeenCalledWith("Set calculator.port = 4000");
      consoleSpy.mockRestore();
    });

    it("saves a host override as a string", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      await makeProgram().parseAsync([
        "node",
        "llm",
        "config",
        "set",
        "calculator.host",
        "192.168.1.10",
      ]);

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"calculator.host": "192.168.1.10"'),
        "utf-8",
      );
      expect(consoleSpy).toHaveBeenCalledWith("Set calculator.host = 192.168.1.10");
      consoleSpy.mockRestore();
    });

    it("merges with existing config", async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ "clock.port": 5000 }));
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      await makeProgram().parseAsync(["node", "llm", "config", "set", "calculator.port", "4000"]);

      const written = mockWriteFileSync.mock.calls[0][1] as string;
      const parsed = JSON.parse(written);
      expect(parsed).toEqual({ "clock.port": 5000, "calculator.port": 4000 });
      consoleSpy.mockRestore();
    });
  });
});

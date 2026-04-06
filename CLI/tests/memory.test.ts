/**
 * CLI memory command — unit tests with mocked SQLite
 */

import { Command } from "commander";
import { registerMemoryCommands } from "../src/commands/memory";

// Mock better-sqlite3 so no real DB is needed
const mockAll = jest.fn();
const mockGet = jest.fn();
const mockExec = jest.fn();
const mockClose = jest.fn();
const mockPrepare = jest.fn(() => ({ all: mockAll, get: mockGet }));

jest.mock("better-sqlite3", () =>
  jest.fn(() => ({
    prepare: mockPrepare,
    exec: mockExec,
    close: mockClose,
  })),
);

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerMemoryCommands(program);
  return program;
}

beforeEach(() => jest.clearAllMocks());

describe("memory command", () => {
  describe("memory stats", () => {
    it("queries runs table and prints stats", async () => {
      const row = { total: 10, successes: 8, avg_ms: 120.5, min_ms: 50, max_ms: 300 };
      mockGet.mockReturnValue(row);
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      await makeProgram().parseAsync(["node", "llm", "memory", "stats"]);

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("FROM runs"));
      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(row, null, 2));
      expect(mockClose).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("prints error and exits on DB failure", async () => {
      const Database = require("better-sqlite3");
      Database.mockImplementationOnce(() => {
        throw new Error("DB not found");
      });
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit");
      });

      await expect(makeProgram().parseAsync(["node", "llm", "memory", "stats"])).rejects.toThrow(
        "exit",
      );

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("DB not found"));
      consoleSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });

  describe("memory history", () => {
    it("queries runs with default limit 20", async () => {
      const rows = [{ id: 1, workflow_name: "test", success: 1, duration_ms: 100 }];
      mockAll.mockReturnValue(rows);
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      await makeProgram().parseAsync(["node", "llm", "memory", "history"]);

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("FROM runs"));
      expect(mockAll).toHaveBeenCalledWith(20);
      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(rows, null, 2));
      consoleSpy.mockRestore();
    });

    it("respects --limit option", async () => {
      mockAll.mockReturnValue([]);
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      await makeProgram().parseAsync(["node", "llm", "memory", "history", "--limit", "5"]);

      expect(mockAll).toHaveBeenCalledWith(5);
      consoleSpy.mockRestore();
    });
  });

  describe("memory patterns", () => {
    it("queries successful tool sequences", async () => {
      const rows = [{ workflow_name: "wf1", tool_sequence: "calc → browse", uses: 3 }];
      mockAll.mockReturnValue(rows);
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      await makeProgram().parseAsync(["node", "llm", "memory", "patterns"]);

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("success = 1"));
      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(rows, null, 2));
      consoleSpy.mockRestore();
    });
  });

  describe("memory clear", () => {
    it("clears DB when --confirm flag is provided", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      await makeProgram().parseAsync(["node", "llm", "memory", "clear", "--confirm"]);

      expect(mockExec).toHaveBeenCalledWith("DELETE FROM steps; DELETE FROM runs;");
      expect(consoleSpy).toHaveBeenCalledWith("Run history cleared.");
      consoleSpy.mockRestore();
    });
  });
});

/**
 * CLI workflow command — unit tests with mocked AgentRunner and fs
 */

import fs from "node:fs";
import { Command } from "commander";
import { registerWorkflowCommands } from "../src/commands/workflow";

const mockExecuteWorkflow = jest.fn();
const mockStoreRun = jest.fn();

jest.mock("../../AgentRunner/src/index", () => ({
  createAgentRunner: jest.fn(() => ({
    runner: { executeWorkflow: mockExecuteWorkflow },
    memory: { storeRun: mockStoreRun },
  })),
}));

jest.mock("../src/http", () => ({
  handleError: jest.fn(),
}));

import { handleError } from "../src/http";
const mockHandleError = handleError as jest.MockedFunction<typeof handleError>;

const SAMPLE_WORKFLOW = {
  id: "wf-1",
  name: "Test Workflow",
  mode: "sequential",
  steps: [{ id: "s1", toolId: "calculator", input: {} }],
};

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerWorkflowCommands(program);
  return program;
}

beforeEach(() => jest.clearAllMocks());

describe("workflow command", () => {
  describe("workflow run", () => {
    it("reads workflow JSON and executes it", async () => {
      jest.spyOn(fs, "existsSync").mockReturnValue(true);
      jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(SAMPLE_WORKFLOW));
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      mockExecuteWorkflow.mockResolvedValue({
        success: true,
        durationMs: 250,
        steps: [{ stepId: "s1", toolId: "calculator", success: true, durationMs: 100, retries: 0 }],
        autoApproved: false,
        followUpWorkflow: null,
      });

      await makeProgram().parseAsync(["node", "llm", "workflow", "run", "wf.json"]);

      expect(mockExecuteWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ id: "wf-1" }),
        expect.objectContaining({ autoApproveWrites: false }),
      );
      expect(mockStoreRun).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("completed successfully"));
      consoleSpy.mockRestore();
    });

    it("applies --timeout override to workflow definition", async () => {
      jest.spyOn(fs, "existsSync").mockReturnValue(true);
      jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(SAMPLE_WORKFLOW));
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      mockExecuteWorkflow.mockResolvedValue({
        success: true,
        durationMs: 100,
        steps: [],
        autoApproved: false,
        followUpWorkflow: null,
      });

      await makeProgram().parseAsync([
        "node",
        "llm",
        "workflow",
        "run",
        "wf.json",
        "--timeout",
        "9000",
      ]);

      expect(mockExecuteWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 9000 }),
        expect.any(Object),
      );
      consoleSpy.mockRestore();
    });

    it("passes --auto-approve flag to executeWorkflow", async () => {
      jest.spyOn(fs, "existsSync").mockReturnValue(true);
      jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(SAMPLE_WORKFLOW));
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      mockExecuteWorkflow.mockResolvedValue({
        success: true,
        durationMs: 50,
        steps: [],
        autoApproved: true,
        followUpWorkflow: null,
      });

      await makeProgram().parseAsync([
        "node",
        "llm",
        "workflow",
        "run",
        "wf.json",
        "--auto-approve",
      ]);

      expect(mockExecuteWorkflow).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ autoApproveWrites: true }),
      );
      consoleSpy.mockRestore();
    });

    it("exits with error when file does not exist", async () => {
      jest.spyOn(fs, "existsSync").mockReturnValue(false);
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit");
      });

      await expect(
        makeProgram().parseAsync(["node", "llm", "workflow", "run", "missing.json"]),
      ).rejects.toThrow("exit");

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("File not found"));
      consoleSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it("calls handleError when executeWorkflow throws", async () => {
      jest.spyOn(fs, "existsSync").mockReturnValue(true);
      jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(SAMPLE_WORKFLOW));
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      mockExecuteWorkflow.mockRejectedValue(new Error("Runner crashed"));

      await makeProgram().parseAsync(["node", "llm", "workflow", "run", "wf.json"]);

      expect(mockHandleError).toHaveBeenCalledWith(expect.any(Error));
      consoleSpy.mockRestore();
    });
  });
});

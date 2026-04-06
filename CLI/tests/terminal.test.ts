/**
 * CLI terminal command — unit tests with mocked HTTP
 */

import { Command } from "commander";
import { registerTerminalCommand } from "../src/commands/terminal";

jest.mock("../src/http", () => ({
  toolPost: jest.fn(),
  printResult: jest.fn(),
  handleError: jest.fn(),
}));

import { handleError, printResult, toolPost } from "../src/http";

const mockToolPost = toolPost as jest.MockedFunction<typeof toolPost>;
const mockPrintResult = printResult as jest.MockedFunction<typeof printResult>;
const mockHandleError = handleError as jest.MockedFunction<typeof handleError>;

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerTerminalCommand(program);
  return program;
}

beforeEach(() => jest.clearAllMocks());

describe("terminal command", () => {
  it("posts command to terminal endpoint", async () => {
    const result = { stdout: "hello", exitCode: 0 };
    mockToolPost.mockResolvedValue(result);

    await makeProgram().parseAsync(["node", "llm", "terminal", "echo hello"]);

    expect(mockToolPost).toHaveBeenCalledWith(
      expect.stringContaining("/tools/run_terminal_command"),
      { command: "echo hello" },
    );
    expect(mockPrintResult).toHaveBeenCalledWith(result);
  });

  it("includes cwd option when provided", async () => {
    mockToolPost.mockResolvedValue({});

    await makeProgram().parseAsync(["node", "llm", "terminal", "ls", "--cwd", "/tmp"]);

    expect(mockToolPost).toHaveBeenCalledWith(expect.any(String), { command: "ls", cwd: "/tmp" });
  });

  it("includes timeout option when provided", async () => {
    mockToolPost.mockResolvedValue({});

    await makeProgram().parseAsync(["node", "llm", "terminal", "sleep 1", "--timeout", "5000"]);

    expect(mockToolPost).toHaveBeenCalledWith(expect.any(String), {
      command: "sleep 1",
      timeoutMs: 5000,
    });
  });

  it("calls handleError on failure", async () => {
    const err = new Error("HTTP 500: Internal Server Error");
    mockToolPost.mockRejectedValue(err);

    await makeProgram().parseAsync(["node", "llm", "terminal", "bad-cmd"]);

    expect(mockHandleError).toHaveBeenCalledWith(err);
  });
});

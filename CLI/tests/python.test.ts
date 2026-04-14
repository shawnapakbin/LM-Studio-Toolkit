/**
 * CLI python commands — unit tests with mocked HTTP
 */

import { Command } from "commander";
import { registerPythonCommands } from "../src/commands/python";

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
  registerPythonCommands(program);
  return program;
}

beforeEach(() => jest.clearAllMocks());

describe("python command", () => {
  it("posts code to python_run_code", async () => {
    const result = { success: true, stdout: "hi" };
    mockToolPost.mockResolvedValue(result);

    await makeProgram().parseAsync(["node", "llm", "python", "run", "print('hi')"]);

    expect(mockToolPost).toHaveBeenCalledWith(expect.stringContaining("/tools/python_run_code"), {
      code: "print('hi')",
    });
    expect(mockPrintResult).toHaveBeenCalledWith(result);
  });

  it("includes cwd and timeout for python run", async () => {
    mockToolPost.mockResolvedValue({ success: true });

    await makeProgram().parseAsync([
      "node",
      "llm",
      "python",
      "run",
      "print('x')",
      "--cwd",
      "/tmp",
      "--timeout",
      "5000",
    ]);

    expect(mockToolPost).toHaveBeenCalledWith(expect.any(String), {
      code: "print('x')",
      cwd: "/tmp",
      timeoutMs: 5000,
    });
  });

  it("calls python_open_repl", async () => {
    mockToolPost.mockResolvedValue({ success: true, action: "repl" });

    await makeProgram().parseAsync(["node", "llm", "python", "repl", "--cwd", "/work"]);

    expect(mockToolPost).toHaveBeenCalledWith(expect.stringContaining("/tools/python_open_repl"), {
      cwd: "/work",
    });
  });

  it("calls python_open_idle", async () => {
    mockToolPost.mockResolvedValue({ success: true, action: "idle" });

    await makeProgram().parseAsync(["node", "llm", "python", "idle"]);

    expect(mockToolPost).toHaveBeenCalledWith(
      expect.stringContaining("/tools/python_open_idle"),
      {},
    );
  });

  it("calls handleError on failure", async () => {
    const err = new Error("HTTP 500");
    mockToolPost.mockRejectedValue(err);

    await makeProgram().parseAsync(["node", "llm", "python", "run", "print(1)"]);

    expect(mockHandleError).toHaveBeenCalledWith(err);
  });
});

/**
 * CLI calc command — unit tests with mocked HTTP
 */

import { Command } from "commander";
import { registerCalcCommand } from "../src/commands/calc";

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
  program.exitOverride(); // prevent process.exit in tests
  registerCalcCommand(program);
  return program;
}

beforeEach(() => jest.clearAllMocks());

describe("calc command", () => {
  it("posts expression to calculator endpoint", async () => {
    const result = { success: true, value: "4" };
    mockToolPost.mockResolvedValue(result);

    await makeProgram().parseAsync(["node", "llm", "calc", "2 + 2"]);

    expect(mockToolPost).toHaveBeenCalledWith(
      expect.stringContaining("/tools/calculate_engineering"),
      { expression: "2 + 2" },
    );
    expect(mockPrintResult).toHaveBeenCalledWith(result);
  });

  it("includes precision option when provided", async () => {
    mockToolPost.mockResolvedValue({ success: true, value: "3.14159" });

    await makeProgram().parseAsync(["node", "llm", "calc", "pi", "--precision", "5"]);

    expect(mockToolPost).toHaveBeenCalledWith(expect.any(String), {
      expression: "pi",
      precision: 5,
    });
  });

  it("calls handleError on HTTP failure", async () => {
    const err = new Error("HTTP 500: Internal Server Error");
    mockToolPost.mockRejectedValue(err);

    await makeProgram().parseAsync(["node", "llm", "calc", "bad"]);

    expect(mockHandleError).toHaveBeenCalledWith(err);
  });
});

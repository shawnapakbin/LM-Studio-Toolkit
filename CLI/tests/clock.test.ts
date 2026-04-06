/**
 * CLI clock command — unit tests with mocked HTTP
 */

import { Command } from "commander";
import { registerClockCommand } from "../src/commands/clock";

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
  registerClockCommand(program);
  return program;
}

beforeEach(() => jest.clearAllMocks());

describe("clock command", () => {
  it("posts to clock endpoint with no options", async () => {
    const result = { iso: "2026-04-02T00:00:00Z" };
    mockToolPost.mockResolvedValue(result);

    await makeProgram().parseAsync(["node", "llm", "clock"]);

    expect(mockToolPost).toHaveBeenCalledWith(
      expect.stringContaining("/tools/get_current_time"),
      {},
    );
    expect(mockPrintResult).toHaveBeenCalledWith(result);
  });

  it("includes timezone when provided", async () => {
    mockToolPost.mockResolvedValue({});

    await makeProgram().parseAsync(["node", "llm", "clock", "--timezone", "America/New_York"]);

    expect(mockToolPost).toHaveBeenCalledWith(expect.any(String), { timezone: "America/New_York" });
  });

  it("includes format when provided", async () => {
    mockToolPost.mockResolvedValue({});

    await makeProgram().parseAsync(["node", "llm", "clock", "--format", "unix"]);

    expect(mockToolPost).toHaveBeenCalledWith(expect.any(String), { format: "unix" });
  });

  it("calls handleError on failure", async () => {
    const err = new Error("HTTP 503: Service Unavailable");
    mockToolPost.mockRejectedValue(err);

    await makeProgram().parseAsync(["node", "llm", "clock"]);

    expect(mockHandleError).toHaveBeenCalledWith(err);
  });
});

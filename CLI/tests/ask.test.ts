/**
 * CLI ask command — unit tests with mocked HTTP
 */

import { Command } from "commander";
import { registerAskCommand } from "../src/commands/ask";

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
  registerAskCommand(program);
  return program;
}

beforeEach(() => jest.clearAllMocks());

describe("ask command", () => {
  it("posts prompt to askuser endpoint", async () => {
    const result = { interviewId: "abc123" };
    mockToolPost.mockResolvedValue(result);

    await makeProgram().parseAsync(["node", "llm", "ask", "What is your name?"]);

    expect(mockToolPost).toHaveBeenCalledWith(expect.stringContaining("/tools/ask_user"), {
      action: "create_interview",
      prompt: "What is your name?",
    });
    expect(mockPrintResult).toHaveBeenCalledWith(result);
  });

  it("includes title option when provided", async () => {
    mockToolPost.mockResolvedValue({});

    await makeProgram().parseAsync(["node", "llm", "ask", "Clarify?", "--title", "My Interview"]);

    expect(mockToolPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ title: "My Interview" }),
    );
  });

  it("includes expires option when provided", async () => {
    mockToolPost.mockResolvedValue({});

    await makeProgram().parseAsync(["node", "llm", "ask", "Clarify?", "--expires", "300"]);

    expect(mockToolPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ expiresInSeconds: 300 }),
    );
  });

  it("calls handleError on failure", async () => {
    const err = new Error("HTTP 503: Service Unavailable");
    mockToolPost.mockRejectedValue(err);

    await makeProgram().parseAsync(["node", "llm", "ask", "Clarify?"]);

    expect(mockHandleError).toHaveBeenCalledWith(err);
  });
});

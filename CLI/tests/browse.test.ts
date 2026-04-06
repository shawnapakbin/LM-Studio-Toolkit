/**
 * CLI browse command — unit tests with mocked HTTP
 */

import { Command } from "commander";
import { registerBrowseCommand } from "../src/commands/browse";

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
  registerBrowseCommand(program);
  return program;
}

beforeEach(() => jest.clearAllMocks());

describe("browse command", () => {
  it("posts url with default markdown format", async () => {
    const result = { content: "# Page" };
    mockToolPost.mockResolvedValue(result);

    await makeProgram().parseAsync(["node", "llm", "browse", "https://example.com"]);

    expect(mockToolPost).toHaveBeenCalledWith(expect.stringContaining("/tools/browse_web"), {
      url: "https://example.com",
      outputFormat: "markdown",
    });
    expect(mockPrintResult).toHaveBeenCalledWith(result);
  });

  it("passes --format option", async () => {
    mockToolPost.mockResolvedValue({});

    await makeProgram().parseAsync([
      "node",
      "llm",
      "browse",
      "https://example.com",
      "--format",
      "text",
    ]);

    expect(mockToolPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ outputFormat: "text" }),
    );
  });

  it("passes --screenshot flag", async () => {
    mockToolPost.mockResolvedValue({});

    await makeProgram().parseAsync([
      "node",
      "llm",
      "browse",
      "https://example.com",
      "--screenshot",
    ]);

    expect(mockToolPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ screenshot: true }),
    );
  });

  it("passes --wait-selector option", async () => {
    mockToolPost.mockResolvedValue({});

    await makeProgram().parseAsync([
      "node",
      "llm",
      "browse",
      "https://example.com",
      "--wait-selector",
      "#main",
    ]);

    expect(mockToolPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ waitForSelector: "#main" }),
    );
  });

  it("calls handleError on failure", async () => {
    const err = new Error("HTTP 403: Forbidden");
    mockToolPost.mockRejectedValue(err);

    await makeProgram().parseAsync(["node", "llm", "browse", "https://example.com"]);

    expect(mockHandleError).toHaveBeenCalledWith(err);
  });
});

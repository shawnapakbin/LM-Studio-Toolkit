/**
 * CLI rag command — unit tests with mocked HTTP
 */

import { Command } from "commander";
import { registerRagCommands } from "../src/commands/rag";

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
  registerRagCommands(program);
  return program;
}

beforeEach(() => jest.clearAllMocks());

describe("rag command", () => {
  describe("rag query", () => {
    it("posts query action with text", async () => {
      const result = { results: [] };
      mockToolPost.mockResolvedValue(result);

      await makeProgram().parseAsync(["node", "llm", "rag", "query", "what is AI?"]);

      expect(mockToolPost).toHaveBeenCalledWith(expect.stringContaining("/tools/rag"), {
        action: "query",
        query: "what is AI?",
      });
      expect(mockPrintResult).toHaveBeenCalledWith(result);
    });

    it("passes topK option", async () => {
      mockToolPost.mockResolvedValue({});

      await makeProgram().parseAsync(["node", "llm", "rag", "query", "test", "--top-k", "5"]);

      expect(mockToolPost).toHaveBeenCalledWith(expect.any(String), {
        action: "query",
        query: "test",
        topK: 5,
      });
    });

    it("calls handleError on failure", async () => {
      mockToolPost.mockRejectedValue(new Error("HTTP 500"));
      await makeProgram().parseAsync(["node", "llm", "rag", "query", "test"]);
      expect(mockHandleError).toHaveBeenCalled();
    });
  });

  describe("rag ingest", () => {
    it("posts ingest action with content", async () => {
      mockToolPost.mockResolvedValue({ ingested: true });

      await makeProgram().parseAsync(["node", "llm", "rag", "ingest", "Some document text"]);

      expect(mockToolPost).toHaveBeenCalledWith(expect.any(String), {
        action: "ingest",
        content: "Some document text",
      });
    });

    it("includes source label when provided", async () => {
      mockToolPost.mockResolvedValue({});

      await makeProgram().parseAsync([
        "node",
        "llm",
        "rag",
        "ingest",
        "text",
        "--source",
        "my-doc",
      ]);

      expect(mockToolPost).toHaveBeenCalledWith(expect.any(String), {
        action: "ingest",
        content: "text",
        source: "my-doc",
      });
    });
  });

  describe("rag list", () => {
    it("posts list_sources action", async () => {
      mockToolPost.mockResolvedValue({ sources: [] });

      await makeProgram().parseAsync(["node", "llm", "rag", "list"]);

      expect(mockToolPost).toHaveBeenCalledWith(expect.any(String), { action: "list_sources" });
    });
  });

  describe("rag delete", () => {
    it("posts delete_source action with sourceId", async () => {
      mockToolPost.mockResolvedValue({ deleted: true });

      await makeProgram().parseAsync(["node", "llm", "rag", "delete", "src-99"]);

      expect(mockToolPost).toHaveBeenCalledWith(expect.any(String), {
        action: "delete_source",
        sourceId: "src-99",
      });
    });
  });
});

/**
 * CLI ecm command — unit tests with mocked HTTP
 */

import { Command } from "commander";
import { registerEcmCommands } from "../src/commands/ecm";

jest.mock("../src/http", () => ({
  toolPost: jest.fn(),
  printResult: jest.fn(),
  handleError: jest.fn(),
}));

import { handleError, toolPost } from "../src/http";

const mockToolPost = toolPost as jest.MockedFunction<typeof toolPost>;
const mockHandleError = handleError as jest.MockedFunction<typeof handleError>;

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerEcmCommands(program);
  return program;
}

beforeEach(() => jest.clearAllMocks());

describe("ecm command", () => {
  describe("ecm store", () => {
    it("posts store_segment with required content", async () => {
      mockToolPost.mockResolvedValue({ segmentId: "seg-1" });

      await makeProgram().parseAsync(["node", "llm", "ecm", "store", "--content", "Hello world"]);

      expect(mockToolPost).toHaveBeenCalledWith(
        expect.stringContaining("/tools/ecm"),
        expect.objectContaining({ action: "store_segment", content: "Hello world" }),
      );
    });

    it("uses default session and type", async () => {
      mockToolPost.mockResolvedValue({});

      await makeProgram().parseAsync(["node", "llm", "ecm", "store", "--content", "test"]);

      expect(mockToolPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ sessionId: "cli-session", type: "conversation_turn" }),
      );
    });

    it("passes importance when provided", async () => {
      mockToolPost.mockResolvedValue({});

      await makeProgram().parseAsync([
        "node",
        "llm",
        "ecm",
        "store",
        "--content",
        "important",
        "--importance",
        "0.9",
      ]);

      expect(mockToolPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ importance: 0.9 }),
      );
    });
  });

  describe("ecm retrieve", () => {
    it("posts retrieve_context with query", async () => {
      mockToolPost.mockResolvedValue({ segments: [] });

      await makeProgram().parseAsync(["node", "llm", "ecm", "retrieve", "--query", "find me"]);

      expect(mockToolPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ action: "retrieve_context", query: "find me" }),
      );
    });

    it("passes topK and minScore options", async () => {
      mockToolPost.mockResolvedValue({});

      await makeProgram().parseAsync([
        "node",
        "llm",
        "ecm",
        "retrieve",
        "--query",
        "q",
        "--top-k",
        "3",
        "--min-score",
        "0.5",
      ]);

      expect(mockToolPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ topK: 3, minScore: 0.5 }),
      );
    });
  });

  describe("ecm list", () => {
    it("posts list_segments with default session", async () => {
      mockToolPost.mockResolvedValue({ data: { segments: [], total: 0 } });

      await makeProgram().parseAsync(["node", "llm", "ecm", "list"]);

      expect(mockToolPost).toHaveBeenCalledWith(expect.any(String), {
        action: "list_segments",
        sessionId: "cli-session",
      });
    });

    it("passes limit and offset options", async () => {
      mockToolPost.mockResolvedValue({});

      await makeProgram().parseAsync([
        "node",
        "llm",
        "ecm",
        "list",
        "--limit",
        "10",
        "--offset",
        "5",
      ]);

      expect(mockToolPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ limit: 10, offset: 5 }),
      );
    });
  });

  describe("ecm delete", () => {
    it("posts delete_segment with segmentId", async () => {
      mockToolPost.mockResolvedValue({ deleted: true });

      await makeProgram().parseAsync(["node", "llm", "ecm", "delete", "seg-42"]);

      expect(mockToolPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ action: "delete_segment", segmentId: "seg-42" }),
      );
    });
  });

  describe("ecm summarize", () => {
    it("posts summarize_session", async () => {
      mockToolPost.mockResolvedValue({ summary: "..." });

      await makeProgram().parseAsync(["node", "llm", "ecm", "summarize"]);

      expect(mockToolPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ action: "summarize_session" }),
      );
    });

    it("passes keepNewest option", async () => {
      mockToolPost.mockResolvedValue({});

      await makeProgram().parseAsync(["node", "llm", "ecm", "summarize", "--keep-newest", "3"]);

      expect(mockToolPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ keepNewest: 3 }),
      );
    });
  });

  describe("ecm clear", () => {
    it("posts clear_session", async () => {
      mockToolPost.mockResolvedValue({ cleared: true });

      await makeProgram().parseAsync(["node", "llm", "ecm", "clear"]);

      expect(mockToolPost).toHaveBeenCalledWith(expect.any(String), {
        action: "clear_session",
        sessionId: "cli-session",
      });
    });
  });

  describe("ecm compact", () => {
    it("calls summarize then list_segments and logs remaining count", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      mockToolPost
        .mockResolvedValueOnce({ summary: "compacted" })
        .mockResolvedValueOnce({ data: { total: 3 } });

      await makeProgram().parseAsync(["node", "llm", "ecm", "compact"]);

      expect(mockToolPost).toHaveBeenCalledTimes(2);
      expect(mockToolPost).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.objectContaining({ action: "summarize_session", keepNewest: 5 }),
      );
      expect(mockToolPost).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({ action: "list_segments", limit: 1 }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Segments remaining: 3"));
      consoleSpy.mockRestore();
    });

    it("calls handleError if summarize fails", async () => {
      mockToolPost.mockRejectedValue(new Error("HTTP 500"));

      await makeProgram().parseAsync(["node", "llm", "ecm", "compact"]);

      expect(mockHandleError).toHaveBeenCalled();
    });
  });
});

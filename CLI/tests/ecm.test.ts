/**
 * Tests for CLI ecm commands.
 */

import { Command } from "commander";

jest.mock("../src/http", () => ({
  toolPost: jest.fn(),
  printResult: jest.fn(),
  handleError: jest.fn(),
}));

import { registerEcmCommands } from "../src/commands/ecm";
import { handleError, printResult, toolPost } from "../src/http";

const mockedPost = toolPost as jest.MockedFunction<typeof toolPost>;
const mockedPrint = printResult as jest.MockedFunction<typeof printResult>;
const mockedError = handleError as jest.MockedFunction<typeof handleError>;

function makeCli() {
  const program = new Command();
  program.exitOverride();
  registerEcmCommands(program);
  return program;
}

describe("CLI ecm commands", () => {
  beforeEach(() => {
    mockedPost.mockReset();
    mockedPrint.mockReset();
    mockedError.mockReset();
  });

  describe("store", () => {
    it("posts store_segment with content and defaults", async () => {
      mockedPost.mockResolvedValue({ ok: true });
      const cli = makeCli();
      await cli.parseAsync(["node", "test", "ecm", "store", "-c", "hello world"]);
      expect(mockedPost).toHaveBeenCalledWith(
        "http://localhost:3342/tools/ecm",
        expect.objectContaining({
          action: "store_segment",
          sessionId: "cli-session",
          type: "conversation_turn",
          content: "hello world",
        }),
      );
    });

    it("includes importance when provided", async () => {
      mockedPost.mockResolvedValue({ ok: true });
      const cli = makeCli();
      await cli.parseAsync(["node", "test", "ecm", "store", "-c", "x", "-i", "0.9"]);
      expect(mockedPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ importance: 0.9 }),
      );
    });
  });

  describe("status", () => {
    it("posts get_status with default session", async () => {
      mockedPost.mockResolvedValue({ ok: true });
      const cli = makeCli();
      await cli.parseAsync(["node", "test", "ecm", "status"]);
      expect(mockedPost).toHaveBeenCalledWith(
        "http://localhost:3342/tools/ecm",
        expect.objectContaining({ action: "get_status", sessionId: "cli-session" }),
      );
    });

    it("respects --session override", async () => {
      mockedPost.mockResolvedValue({ ok: true });
      const cli = makeCli();
      await cli.parseAsync(["node", "test", "ecm", "status", "-s", "abc"]);
      expect(mockedPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ sessionId: "abc" }),
      );
    });
  });

  describe("clear", () => {
    it("posts clear_session", async () => {
      mockedPost.mockResolvedValue({ ok: true });
      const cli = makeCli();
      await cli.parseAsync(["node", "test", "ecm", "clear", "-s", "s1"]);
      expect(mockedPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ action: "clear_session", sessionId: "s1" }),
      );
    });
  });

  describe("compact", () => {
    it("posts on_user_turn with forced ratio when --used omitted", async () => {
      mockedPost.mockResolvedValue({ ok: true });
      const cli = makeCli();
      await cli.parseAsync(["node", "test", "ecm", "compact"]);
      const body = mockedPost.mock.calls[0][1] as Record<string, unknown>;
      expect(body.action).toBe("on_user_turn");
      expect(body.sessionId).toBe("cli-session");
      expect(body.currentUsedTokens).toBe(body.contextLimit);
    });

    it("forwards --used --limit --keep-newest --threshold", async () => {
      mockedPost.mockResolvedValue({ ok: true });
      const cli = makeCli();
      await cli.parseAsync([
        "node",
        "test",
        "ecm",
        "compact",
        "--used",
        "5000",
        "--limit",
        "8000",
        "--keep-newest",
        "3",
        "--threshold",
        "0.6",
      ]);
      expect(mockedPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          action: "on_user_turn",
          currentUsedTokens: 5000,
          contextLimit: 8000,
          keepNewest: 3,
          threshold: 0.6,
        }),
      );
    });
  });
});

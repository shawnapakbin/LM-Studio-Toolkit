/**
 * parseSlashCommand — ECM-related cases.
 */

import { parseSlashCommand as parse } from "../src/parser";

describe("parseSlashCommand — /ecm", () => {
  it("parses /ecm store", () => {
    expect(parse("/ecm store hello world")).toMatchObject({
      tool: "ecm",
      action: "store_segment",
      params: { sessionId: "default", content: "hello world", type: "conversation_turn" },
    });
  });

  it("parses /ecm store with importance and type", () => {
    expect(parse("/ecm store hi --importance 0.9 --type tool_output")).toMatchObject({
      tool: "ecm",
      action: "store_segment",
      params: { type: "tool_output", importance: 0.9 },
    });
  });

  it("parses /ecm status", () => {
    expect(parse("/ecm status --session abc")).toMatchObject({
      tool: "ecm",
      action: "get_status",
      params: { sessionId: "abc" },
    });
  });

  it("parses /ecm clear", () => {
    expect(parse("/ecm clear")).toMatchObject({
      tool: "ecm",
      action: "clear_session",
      params: { sessionId: "default" },
    });
  });

  it("parses /ecm compact with all flags", () => {
    expect(
      parse("/ecm compact --session s1 --used 5000 --limit 8000 --keep-newest 3 --threshold 0.6"),
    ).toMatchObject({
      tool: "ecm",
      action: "on_user_turn",
      params: {
        sessionId: "s1",
        currentUsedTokens: 5000,
        contextLimit: 8000,
        keepNewest: 3,
        threshold: 0.6,
      },
    });
  });

  it("returns unknown for /ecm retrieve (legacy action removed)", () => {
    expect(parse("/ecm retrieve foo")).toMatchObject({ tool: "unknown" });
  });

  it("returns unknown for /ecm continuous (legacy action removed)", () => {
    expect(parse("/ecm continuous on")).toMatchObject({ tool: "unknown" });
  });
});

describe("parseSlashCommand — /compact", () => {
  it("forwards to ecm.on_user_turn with forced ratio when --used omitted", () => {
    const d = parse("/compact --session s1");
    expect(d).toMatchObject({
      tool: "ecm",
      action: "on_user_turn",
      params: { sessionId: "s1", currentUsedTokens: 8192, contextLimit: 8192 },
    });
  });

  it("respects --used --limit --threshold", () => {
    expect(parse("/compact --used 100 --limit 1000 --threshold 0.5")).toMatchObject({
      tool: "ecm",
      action: "on_user_turn",
      params: { currentUsedTokens: 100, contextLimit: 1000, threshold: 0.5 },
    });
  });
});

/**
 * Router tests — ECM dispatch.
 */

jest.mock("../src/dispatch", () => ({
  post: jest.fn(),
  get: jest.fn(),
}));

import { post } from "../src/dispatch";
import { parseSlashCommand } from "../src/parser";
import { route } from "../src/router";

const mockedPost = post as jest.MockedFunction<typeof post>;

describe("route — /ecm", () => {
  beforeEach(() => {
    mockedPost.mockReset();
    mockedPost.mockResolvedValue({ ok: true });
  });

  it("posts store_segment", async () => {
    await route(parseSlashCommand("/ecm store hello"));
    expect(mockedPost).toHaveBeenCalledWith(
      "http://localhost:3342/tools/ecm",
      expect.objectContaining({ action: "store_segment", content: "hello" }),
    );
  });

  it("posts get_status", async () => {
    await route(parseSlashCommand("/ecm status"));
    expect(mockedPost).toHaveBeenCalledWith(
      "http://localhost:3342/tools/ecm",
      expect.objectContaining({ action: "get_status", sessionId: "default" }),
    );
  });

  it("posts clear_session", async () => {
    await route(parseSlashCommand("/ecm clear --session s1"));
    expect(mockedPost).toHaveBeenCalledWith(
      "http://localhost:3342/tools/ecm",
      expect.objectContaining({ action: "clear_session", sessionId: "s1" }),
    );
  });

  it("posts on_user_turn for /ecm compact", async () => {
    await route(parseSlashCommand("/ecm compact --used 5000 --limit 8000"));
    expect(mockedPost).toHaveBeenCalledWith(
      "http://localhost:3342/tools/ecm",
      expect.objectContaining({
        action: "on_user_turn",
        currentUsedTokens: 5000,
        contextLimit: 8000,
      }),
    );
  });
});

describe("route — /compact", () => {
  beforeEach(() => {
    mockedPost.mockReset();
    mockedPost.mockResolvedValue({ ok: true });
  });

  it("posts a single on_user_turn call", async () => {
    await route(parseSlashCommand("/compact --session abc"));
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith(
      "http://localhost:3342/tools/ecm",
      expect.objectContaining({ action: "on_user_turn", sessionId: "abc" }),
    );
  });
});

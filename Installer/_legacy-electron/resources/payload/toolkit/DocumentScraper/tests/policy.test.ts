import {
  clampDepth,
  clampMaxPages,
  isAllowedContentType,
  isBlockedHostname,
  isBlockedPath,
  validatePath,
  validateTargetUrl,
} from "../src/policy";

describe("DocumentScraper policy", () => {
  test("blocks private and localhost hosts", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("127.0.0.1")).toBe(true);
    expect(isBlockedHostname("10.1.2.3")).toBe(true);
    expect(isBlockedHostname("192.168.1.2")).toBe(true);
  });

  test("accepts public URL and blocks private URL", () => {
    const ok = validateTargetUrl("https://example.com");
    expect(ok.ok).toBe(true);

    const blocked = validateTargetUrl("http://localhost:8080");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.errorCode).toBe("POLICY_BLOCKED");
    }
  });

  test("validates local path boundaries", () => {
    const workspaceRoot = "C:/repo";
    const valid = validatePath("docs/file.md", workspaceRoot);
    expect(valid.valid).toBe(true);

    const invalid = validatePath("../secret.txt", workspaceRoot);
    expect(invalid.valid).toBe(false);
  });

  test("blocks sensitive local path patterns", () => {
    const blocked = isBlockedPath("C:/Users/test/.ssh/id_rsa");
    expect(blocked.blocked).toBe(true);
  });

  test("content type allowlist includes pdf and docx", () => {
    expect(isAllowedContentType("application/pdf")).toBe(true);
    expect(
      isAllowedContentType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
    expect(isAllowedContentType("image/png")).toBe(false);
  });

  test("clamps crawl controls", () => {
    expect(clampDepth(10)).toBe(3);
    expect(clampDepth(-1)).toBe(0);
    expect(clampMaxPages(100)).toBe(20);
    expect(clampMaxPages(0)).toBe(1);
  });
});

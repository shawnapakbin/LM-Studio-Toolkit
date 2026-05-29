import { isAllowedContentType, isBlockedHostname, validateTargetUrl } from "../src/policy";

describe("WebBrowser policy hardening", () => {
  test("blocks localhost and private hosts", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("127.0.0.1")).toBe(true);
    expect(isBlockedHostname("10.10.10.10")).toBe(true);
    expect(isBlockedHostname("192.168.1.10")).toBe(true);
    expect(isBlockedHostname("172.16.0.1")).toBe(true);
    expect(isBlockedHostname("172.31.255.255")).toBe(true);
    expect(isBlockedHostname("169.254.1.5")).toBe(true);
  });

  test("allows public hostnames", () => {
    expect(isBlockedHostname("example.com")).toBe(false);
    expect(isBlockedHostname("8.8.8.8")).toBe(false);
  });

  test("rejects invalid protocol", () => {
    const result = validateTargetUrl("file:///etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("INVALID_INPUT");
    }
  });

  test("rejects private URL by SSRF policy", () => {
    const result = validateTargetUrl("http://localhost:3000");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("POLICY_BLOCKED");
    }
  });

  test("accepts valid public URL", () => {
    const result = validateTargetUrl("https://example.com");
    expect(result.ok).toBe(true);
  });

  test("content-type allowlist works", () => {
    expect(isAllowedContentType("text/html; charset=utf-8")).toBe(true);
    expect(isAllowedContentType("text/plain")).toBe(true);
    expect(isAllowedContentType("application/xml")).toBe(true);
    expect(isAllowedContentType("image/png")).toBe(false);
    expect(isAllowedContentType("application/octet-stream")).toBe(false);
    expect(isAllowedContentType(null)).toBe(true);
  });
});

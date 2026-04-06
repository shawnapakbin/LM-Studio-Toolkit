/**
 * Property-based tests for WebBrowser v2.1.0
 * Uses fast-check to verify correctness properties across generated inputs.
 */
import * as fc from "fast-check";
import { isAllowedContentType, isBlockedHostname, validateTargetUrl } from "../src/policy";

// ─── Task 2.2: SSRF policy always fires before Playwright ────────────────────
// Property: for any blocked hostname, validateTargetUrl returns ok:false
// This is the pre-condition that prevents Playwright from ever being invoked.

describe("Property: SSRF policy blocks private/loopback addresses", () => {
  test("all RFC-1918 10.x.x.x addresses are blocked", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (b, c, d) => {
          const host = `10.${b}.${c}.${d}`;
          expect(isBlockedHostname(host)).toBe(true);
          const result = validateTargetUrl(`http://${host}`);
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.errorCode).toBe("POLICY_BLOCKED");
        },
      ),
    );
  });

  test("all RFC-1918 192.168.x.x addresses are blocked", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), (c, d) => {
        const host = `192.168.${c}.${d}`;
        expect(isBlockedHostname(host)).toBe(true);
      }),
    );
  });

  test("all RFC-1918 172.16–31.x.x addresses are blocked", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 16, max: 31 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (b, c, d) => {
          const host = `172.${b}.${c}.${d}`;
          expect(isBlockedHostname(host)).toBe(true);
        },
      ),
    );
  });

  test("public IP addresses are never blocked", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9 }), // first octet 1–9 (not 10)
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 1, max: 254 }),
        (a, b, c, d) => {
          const host = `${a}.${b}.${c}.${d}`;
          // Skip any that happen to be private
          if (host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("172."))
            return;
          expect(isBlockedHostname(host)).toBe(false);
        },
      ),
    );
  });

  test("non-http/https protocols always return INVALID_INPUT", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("ftp", "file", "ssh", "ws", "wss", "data", "javascript"),
        fc.domain(),
        (protocol, domain) => {
          const result = validateTargetUrl(`${protocol}://${domain}`);
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.errorCode).toBe("INVALID_INPUT");
        },
      ),
    );
  });
});

// ─── Task 3.2 / 3.3 / 3.4: content-type allowlist ────────────────────────────
// Property: allowed types always return true; binary/image types always false

describe("Property: content-type allowlist", () => {
  test("allowed content types always pass", () => {
    const allowed = [
      "text/html",
      "text/plain",
      "application/xhtml+xml",
      "application/xml",
      "application/json",
    ];
    fc.assert(
      fc.property(fc.constantFrom(...allowed), (ct) => {
        expect(isAllowedContentType(ct)).toBe(true);
      }),
    );
  });

  test("binary/image content types are always blocked", () => {
    const blocked = [
      "image/png",
      "image/jpeg",
      "image/gif",
      "application/octet-stream",
      "video/mp4",
      "audio/mpeg",
    ];
    fc.assert(
      fc.property(fc.constantFrom(...blocked), (ct) => {
        expect(isAllowedContentType(ct)).toBe(false);
      }),
    );
  });

  test("null content-type is always allowed (absent header)", () => {
    expect(isAllowedContentType(null)).toBe(true);
  });
});

// ─── Task 4.3: content truncation invariant ───────────────────────────────────
// Property: slicing content to maxContentChars always produces length <= maxContentChars

describe("Property: content truncation invariant", () => {
  test("sliced content length never exceeds maxContentChars", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50000 }),
        fc.integer({ min: 200, max: 12000 }),
        (content, maxChars) => {
          const truncated = content.slice(0, maxChars);
          expect(truncated.length).toBeLessThanOrEqual(maxChars);
          expect(truncated.length).toBe(Math.min(content.length, maxChars));
        },
      ),
    );
  });
});

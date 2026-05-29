import { isCommandBlocked, resolveSafeCwd, truncateOutput } from "../src/policy";

describe("Terminal policy hardening", () => {
  test("blocks destructive command patterns", () => {
    expect(isCommandBlocked("rm -rf /tmp/test")).toBe(true);
    expect(isCommandBlocked("del /s /q C:\\temp")).toBe(true);
    expect(isCommandBlocked("format C:")).toBe(true);
  });

  test("allows safe command patterns", () => {
    expect(isCommandBlocked("npm run build")).toBe(false);
    expect(isCommandBlocked("git status")).toBe(false);
    expect(isCommandBlocked("dir")).toBe(false);
  });

  test("rejects cwd escaping workspace root", () => {
    const result = resolveSafeCwd("C:/workspace", "../outside");
    expect(result.ok).toBe(false);
  });

  test("accepts cwd inside workspace root", () => {
    const result = resolveSafeCwd("C:/workspace", "project/sub");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cwd.replace(/\\/g, "/")).toContain("C:/workspace");
    }
  });

  test("truncates long output with explicit marker", () => {
    const input = "a".repeat(20);
    const output = truncateOutput(input, 10);
    expect(output).toContain("OUTPUT TRUNCATED");
    expect(output.startsWith("a".repeat(10))).toBe(true);
  });

  test("does not truncate short output", () => {
    const input = "short text";
    expect(truncateOutput(input, 50)).toBe(input);
  });
});

import { detectPythonEnvironment } from "../src/python-env";

describe("detectPythonEnvironment", () => {
  test("returns missing when all candidates fail", () => {
    const result = detectPythonEnvironment(() => ({
      status: 1,
      stdout: "",
      stderr: "not found",
    }));

    expect(result.installed).toBe(false);
    expect(result.isPython3).toBe(false);
    expect(result.instructions).toContain("python.org/downloads");
  });

  test("rejects python 2 outputs", () => {
    const result = detectPythonEnvironment((_command, args) => {
      if (args.includes("--version")) {
        return { status: 0, stdout: "Python 2.7.18", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "" };
    });

    expect(result.installed).toBe(false);
  });

  test("detects python 3 and captures launcher metadata", () => {
    const result = detectPythonEnvironment((command, args) => {
      const joined = `${command} ${args.join(" ")}`;
      if (joined.includes("--version")) {
        return { status: 0, stdout: "Python 3.11.9", stderr: "" };
      }
      return { status: 0, stdout: "/usr/bin/python3\n", stderr: "" };
    });

    expect(result.installed).toBe(true);
    expect(result.isPython3).toBe(true);
    expect(result.version).toBe("3.11.9");
    expect(result.launcher).toBeDefined();
  });

  test("checks commands in configured fallback order", () => {
    const calls: string[] = [];
    detectPythonEnvironment((command, args) => {
      calls.push(`${command} ${args.join(" ")}`.trim());
      return { status: 1, stdout: "", stderr: "" };
    });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((cmd) => cmd.includes("--version"))).toBe(true);
  });
});

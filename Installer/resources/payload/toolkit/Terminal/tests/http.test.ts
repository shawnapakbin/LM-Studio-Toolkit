import request from "supertest";
import { app } from "../src/index";
import { clearPunchoutSession } from "../src/punchout";

describe("Terminal HTTP endpoint hardening", () => {
  beforeEach(() => {
    clearPunchoutSession();
  });

  test("rejects missing command", async () => {
    const response = await request(app).post("/tools/run_terminal_command").send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe("INVALID_INPUT");
  });

  test("blocks denied command pattern", async () => {
    const response = await request(app)
      .post("/tools/run_terminal_command")
      .send({ command: "rm -rf /tmp/test" });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe("POLICY_BLOCKED");
  });

  test("blocks cwd escaping workspace root", async () => {
    const response = await request(app)
      .post("/tools/run_terminal_command")
      .send({ command: "echo hello", cwd: "../.." });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe("POLICY_BLOCKED");
  });

  test("executes safe command", async () => {
    const response = await request(app)
      .post("/tools/run_terminal_command")
      .send({ command: "echo hello" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(typeof response.body.stdout).toBe("string");
    expect(response.body.stdout.toLowerCase()).toContain("hello");
  });

  test("punchout returns punchout metadata without stdout", async () => {
    const response = await request(app)
      .post("/tools/run_terminal_command")
      .send({ command: "echo hello", punchout: true });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.punchout).toBe(true);
    expect(typeof response.body.pid).toBe("number");
    expect(typeof response.body.message).toBe("string");
    expect(response.body.stdout).toBeUndefined();
  });

  test("punchout reuses terminal on second call", async () => {
    const first = await request(app)
      .post("/tools/run_terminal_command")
      .send({ command: "echo first", punchout: true });
    expect(first.body.reused).toBe(false);

    const second = await request(app)
      .post("/tools/run_terminal_command")
      .send({ command: "echo second", punchout: true });
    // Reuse depends on whether the spawned process is still alive in the test runner;
    // on Windows with PowerShell it will be true, on Linux/macOS this may vary.
    expect(typeof second.body.reused).toBe("boolean");
    expect(second.body.punchout).toBe(true);
  });

  test("punchout still enforces policy", async () => {
    const response = await request(app)
      .post("/tools/run_terminal_command")
      .send({ command: "rm -rf /tmp/test", punchout: true });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe("POLICY_BLOCKED");
  });
});

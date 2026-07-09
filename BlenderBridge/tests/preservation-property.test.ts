/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Preservation Property Tests - BlenderBridge Existing Behavior Unchanged
 *
 * Property 2: Preservation - BlenderBridge Existing Behavior Unchanged
 *
 * These tests capture the EXISTING (unfixed) behavior that MUST remain unchanged
 * after the bugfix implementation. All tests MUST PASS on the current unfixed code.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 */

import * as fc from "fast-check";
import * as net from "net";
import {
  ExecuteBlenderCodeFn,
  createBlenderClient,
  formatExecutionError,
  withTimeout,
} from "../src/blender-client";
import { loadConfig, validateConfig } from "../src/config";
import { BlenderBridgeConfig } from "../src/types";
import { checkAddonConnectivity, runHealthCheck } from "../src/health-check";

const defaultConfig: BlenderBridgeConfig = {
  blenderMcpHost: "127.0.0.1",
  blenderMcpPort: 9876,
  blenderMcpCommand: "blender-mcp",
  blenderMcpArgs: [],
  healthCheckTimeoutMs: 5000,
  operationTimeoutMs: 30000,
};

/**
 * Preservation Property 1: Quick Operations Return Immediately
 *
 * For all quick operations (duration < 30s), result format is unchanged
 * and no additional overhead added.
 *
 * Validates: Requirements 3.1
 */
describe("Preservation: Quick operations return results immediately without overhead", () => {
  // Generator: various quick Python code snippets (standard Blender operations)
  const quickPythonCodeArb = fc.oneof(
    fc.constant("import bpy\nresult = bpy.context.scene.name"),
    fc.constant("import bpy\nresult = str(len(bpy.data.objects))"),
    fc.constant("import bpy\nbpy.ops.mesh.primitive_cube_add()\nresult = 'created'"),
    fc.constant("import bpy\nresult = bpy.app.version_string"),
    fc.constant("import bpy, json\nresult = json.dumps({'objects': len(bpy.data.objects)})"),
    fc.constant("result = 'hello world'"),
    fc.constant("import math\nresult = str(math.pi)"),
    fc.constant("import bpy\nbpy.ops.object.select_all(action='DESELECT')\nresult = 'done'"),
  );

  // Generator: various fast response outputs (simulating Blender returning quickly)
  const quickResponseArb = fc.oneof(
    fc.constant("Scene"),
    fc.constant("5"),
    fc.constant("created"),
    fc.constant("4.2.0"),
    fc.constant('{"objects": 3}'),
    fc.constant("hello world"),
    fc.constant("3.141592653589793"),
    fc.constant("done"),
  );

  it("executeCode with quick delegate returns {success: true, output: string} immediately", async () => {
    await fc.assert(
      fc.asyncProperty(quickPythonCodeArb, quickResponseArb, async (code, response) => {
        // Simulate a fast delegate (< 30s)
        const delegate: ExecuteBlenderCodeFn = async (_code: string) => response;

        const client = createBlenderClient(defaultConfig, delegate);

        // executeCode should return the result immediately
        const result = await client.executeCode(code);
        // Result format must be: { success: true, output: string }
        expect(result.success).toBe(true);
        expect(result.output).toBe(response);
        expect(typeof result.output).toBe("string");
        // No additional error metadata
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 50 },
    );
  });

  it("executeCode does not add timing overhead for fast operations", async () => {
    const delegate: ExecuteBlenderCodeFn = async () => "fast_result";
    const client = createBlenderClient(defaultConfig, delegate);

    const start = Date.now();
    const result = await client.executeCode("result = 'fast_result'");
    const elapsed = Date.now() - start;

    expect(result.success).toBe(true);
    expect(result.output).toBe("fast_result");
    // Should complete in well under 1 second (no artificial delay/polling)
    expect(elapsed).toBeLessThan(1000);
  });

  it("quick operation result contains no additional error metadata fields", async () => {
    await fc.assert(
      fc.asyncProperty(quickResponseArb, async (response) => {
        const delegate: ExecuteBlenderCodeFn = async () => response;
        const client = createBlenderClient(defaultConfig, delegate);

        const result = await client.executeCode("result = 'test'");
        expect(result.success).toBe(true);
        expect(result.output).toBeDefined();
        // Must NOT have additional error-related metadata
        expect(result.error).toBeUndefined();
        // The result object should only have success + output for success cases
        const keys = Object.keys(result).filter((k) => result[k as keyof typeof result] !== undefined);
        expect(keys).toContain("success");
        expect(keys).toContain("output");
        expect(keys).not.toContain("error");
      }),
      { numRuns: 30 },
    );
  });
});

/**
 * Preservation Property 2: Standard API Code Passes Through Unmodified
 *
 * For all Python code NOT using deprecated 5.x APIs, code passes through
 * unmodified (character-for-character).
 *
 * Validates: Requirements 3.2
 */
describe("Preservation: Standard API code passes through unmodified", () => {
  // Generator: standard Blender Python code that should NEVER be modified
  const standardApiCodeArb = fc.oneof(
    fc.constant("import bpy\nbpy.ops.mesh.primitive_cube_add()"),
    fc.constant("import bpy\nbpy.ops.mesh.primitive_sphere_add(radius=2.0)"),
    fc.constant("import bpy\nbpy.ops.mesh.primitive_cylinder_add()"),
    fc.constant("import bpy\nbpy.ops.object.select_all(action='DESELECT')"),
    fc.constant("import bpy\nbpy.context.scene.render.resolution_x = 1920"),
    fc.constant("import bpy\nbpy.ops.render.render(write_still=True)"),
    fc.constant("import bpy\nbpy.ops.object.modifier_add(type='SUBSURF')"),
    fc.constant("import bpy, json\nresult = json.dumps({'name': bpy.context.scene.name})"),
    fc.constant("import bpy\nfor obj in bpy.data.objects:\n    print(obj.name)"),
    fc.constant("import bpy\nbpy.ops.object.delete()"),
  );

  it("Python code using standard APIs is received character-for-character by the delegate", async () => {
    await fc.assert(
      fc.asyncProperty(standardApiCodeArb, async (code) => {
        // Track exactly what the delegate receives
        let receivedCode: string | null = null;
        const delegate: ExecuteBlenderCodeFn = async (pythonCode: string) => {
          receivedCode = pythonCode;
          return "ok";
        };

        const client = createBlenderClient(defaultConfig, delegate);

        await client.executeCode(code);
        // The delegate must receive EXACTLY the same code, character-for-character
        expect(receivedCode).toBe(code);
      }),
      { numRuns: 50 },
    );
  });

  it("arbitrary Python code without deprecated APIs passes through unmodified", async () => {
    // Generate random Python-like strings that don't contain deprecated API patterns
    const arbitraryCodeArb = fc
      .string({ minLength: 1, maxLength: 200 })
      .filter(
        (s) =>
          !s.includes("export_mesh.stl") &&
          !s.includes("normal_make") &&
          s.length > 0,
      );

    await fc.assert(
      fc.asyncProperty(arbitraryCodeArb, async (code) => {
        let receivedCode: string | null = null;
        const delegate: ExecuteBlenderCodeFn = async (pythonCode: string) => {
          receivedCode = pythonCode;
          return "ok";
        };

        const client = createBlenderClient(defaultConfig, delegate);

        await client.executeCode(code);
        expect(receivedCode).toBe(code);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Preservation Property 3: Successful Operations Response Structure
 *
 * For all successful operations, response structure contains no additional
 * error metadata. Format is: { success: true, output: string }.
 *
 * Validates: Requirements 3.3
 */
describe("Preservation: Successful operations response structure unchanged", () => {
  // Generator: various valid output strings (what Blender might return)
  const outputArb = fc.oneof(
    fc.string({ minLength: 0, maxLength: 500 }),
    fc.constant(""),
    fc.constant('{"result": true}'),
    fc.constant("Scene\n  Camera\n  Cube\n  Light"),
    fc.constant("4.2.0 LTS"),
  );

  it("successful operation always returns exactly {success: true, output: string}", async () => {
    await fc.assert(
      fc.asyncProperty(outputArb, async (output) => {
        const delegate: ExecuteBlenderCodeFn = async () => output;
        const client = createBlenderClient(defaultConfig, delegate);

        const result = await client.executeCode("test code");
        // Success flag
        expect(result.success).toBe(true);
        // Output is exactly what the delegate returned
        expect(result.output).toBe(output);
        // No error metadata present
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it("BlenderExecutionResult for success has no extra fields beyond success and output", async () => {
    await fc.assert(
      fc.asyncProperty(outputArb, async (output) => {
        const delegate: ExecuteBlenderCodeFn = async () => output;
        const client = createBlenderClient(defaultConfig, delegate);

        const result = await client.executeCode("test code");
        // Only 'success' and 'output' should be defined
        const definedKeys = Object.entries(result)
          .filter(([_, v]) => v !== undefined)
          .map(([k]) => k);
        expect(definedKeys.sort()).toEqual(["output", "success"]);
      }),
      { numRuns: 50 },
    );
  });
});

/**
 * Preservation Property 4: TCP Protocol Remains Null-Byte-Delimited JSON
 *
 * For all valid TCP requests, protocol remains null-byte-delimited JSON.
 * The sendCodeToAddon function formats: JSON + \0 for request, expects JSON + \0 for response.
 *
 * Validates: Requirements 3.4
 */
describe("Preservation: TCP protocol remains null-byte-delimited JSON", () => {
  // We test this by creating a mock TCP server that verifies the protocol format

  let server: net.Server;
  let serverPort: number;

  beforeAll((done) => {
    server = net.createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on("data", (chunk) => {
        chunks.push(chunk);
        const all = Buffer.concat(chunks);
        const nullIdx = all.indexOf(0x00);
        if (nullIdx !== -1) {
          // Verify null-byte delimiter in request
          const jsonStr = all.slice(0, nullIdx).toString("utf-8");
          const request = JSON.parse(jsonStr);

          // Respond with null-byte-delimited JSON
          const response = JSON.stringify({
            status: "ok",
            result: `executed: ${request.code?.substring(0, 20) || "unknown"}`,
          });
          socket.write(response + "\0");
          socket.end();
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      serverPort = addr.port;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  // Generator: various Python code to send through the protocol
  const codeSnippets = [
    "import bpy\nresult = 'hello'",
    "result = 42",
    "import json\nresult = json.dumps({'key': 'value'})",
    "bpy.ops.mesh.primitive_cube_add()",
    "# empty comment",
  ];

  it("sendCodeToAddon uses null-byte-delimited JSON protocol (request format)", (done) => {
    // Create a new server that captures raw bytes to verify protocol
    const captureServer = net.createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on("data", (chunk) => {
        chunks.push(chunk);
        const all = Buffer.concat(chunks);
        const nullIdx = all.indexOf(0x00);
        if (nullIdx !== -1) {
          // Verify: data before null byte is valid JSON
          const beforeNull = all.slice(0, nullIdx).toString("utf-8");
          const parsed = JSON.parse(beforeNull);

          // Verify protocol structure
          expect(parsed.type).toBe("execute");
          expect(parsed.code).toBeDefined();
          expect(parsed.strict_json).toBe(true);

          // Respond in protocol format
          socket.write(JSON.stringify({ status: "ok", result: "ok" }) + "\0");
          socket.end();
        }
      });
    });

    captureServer.listen(0, "127.0.0.1", async () => {
      const addr = captureServer.address() as net.AddressInfo;

      // Use the addon transport module
      const { createAddonExecuteCodeDelegate } = require("../src/addon-transport");
      const config: BlenderBridgeConfig = {
        ...defaultConfig,
        blenderMcpPort: addr.port,
      };
      const delegate = createAddonExecuteCodeDelegate(config);

      try {
        await delegate("result = 'test_protocol'");
      } catch {
        // Connection may have issues but we validated the format in the server
      }
      captureServer.close(done);
    });
  });

  it("addon transport sends request as {type: 'execute', code: string, strict_json: true} + null byte", (done) => {
    let receivedRequest: any = null;

    const verifyServer = net.createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on("data", (chunk) => {
        chunks.push(chunk);
        const all = Buffer.concat(chunks);
        const nullIdx = all.indexOf(0x00);
        if (nullIdx !== -1) {
          const jsonStr = all.slice(0, nullIdx).toString("utf-8");
          receivedRequest = JSON.parse(jsonStr);

          socket.write(JSON.stringify({ status: "ok", result: "verified" }) + "\0");
          socket.end();
        }
      });
    });

    verifyServer.listen(0, "127.0.0.1", async () => {
      const addr = verifyServer.address() as net.AddressInfo;
      const { createAddonExecuteCodeDelegate } = require("../src/addon-transport");
      const config: BlenderBridgeConfig = {
        ...defaultConfig,
        blenderMcpPort: addr.port,
      };
      const delegate = createAddonExecuteCodeDelegate(config);

      try {
        const result = await delegate("bpy.ops.mesh.primitive_cube_add()");
        expect(result).toBe("verified");
        expect(receivedRequest.type).toBe("execute");
        expect(receivedRequest.code).toBe("bpy.ops.mesh.primitive_cube_add()");
        expect(receivedRequest.strict_json).toBe(true);
      } catch (err) {
        // If this fails, the protocol has changed
        throw err;
      }
      verifyServer.close(done);
    });
  });

  it.each(codeSnippets)(
    "code snippet '%s' is transmitted using null-byte protocol unchanged",
    (code, done: any) => {
      let receivedCode: string | null = null;

      const snippetServer = net.createServer((socket) => {
        const chunks: Buffer[] = [];
        socket.on("data", (chunk) => {
          chunks.push(chunk);
          const all = Buffer.concat(chunks);
          const nullIdx = all.indexOf(0x00);
          if (nullIdx !== -1) {
            const jsonStr = all.slice(0, nullIdx).toString("utf-8");
            const parsed = JSON.parse(jsonStr);
            receivedCode = parsed.code;
            socket.write(JSON.stringify({ status: "ok", result: "ok" }) + "\0");
            socket.end();
          }
        });
      });

      snippetServer.listen(0, "127.0.0.1", async () => {
        const addr = snippetServer.address() as net.AddressInfo;
        const { createAddonExecuteCodeDelegate } = require("../src/addon-transport");
        const config: BlenderBridgeConfig = {
          ...defaultConfig,
          blenderMcpPort: addr.port,
        };
        const delegate = createAddonExecuteCodeDelegate(config);

        try {
          await delegate(code);
          expect(receivedCode).toBe(code);
        } catch (err) {
          throw err;
        }
        snippetServer.close(done);
      });
    },
  );
});

/**
 * Preservation Property 5: Config Loading From Env Vars With Same Defaults
 *
 * For all config loading, env vars respected with same defaults and validation.
 * Defaults: host=127.0.0.1, port=9876, healthCheckTimeoutMs=5000, operationTimeoutMs=30000
 *
 * Validates: Requirements 3.5
 */
describe("Preservation: Config loads from env vars with same defaults and validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.BLENDER_MCP_HOST;
    delete process.env.BLENDER_MCP_PORT;
    delete process.env.BLENDER_MCP_COMMAND;
    delete process.env.BLENDER_MCP_ARGS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("default config values are unchanged: host=127.0.0.1, port=9876", () => {
    const config = loadConfig();
    expect(config.blenderMcpHost).toBe("127.0.0.1");
    expect(config.blenderMcpPort).toBe(9876);
  });

  it("default healthCheckTimeoutMs is 5000", () => {
    const config = loadConfig();
    expect(config.healthCheckTimeoutMs).toBe(5000);
  });

  it("default operationTimeoutMs is 30000", () => {
    const config = loadConfig();
    expect(config.operationTimeoutMs).toBe(30000);
  });

  it("default command is 'blender-mcp' and args is empty array", () => {
    const config = loadConfig();
    expect(config.blenderMcpCommand).toBe("blender-mcp");
    expect(config.blenderMcpArgs).toEqual([]);
  });

  it("env var BLENDER_MCP_HOST overrides default host", () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.char().filter((c) => c.trim().length > 0 && c !== "\0"), {
          minLength: 1,
          maxLength: 50,
        }),
        (host) => {
          process.env.BLENDER_MCP_HOST = host;
          const config = loadConfig();
          expect(config.blenderMcpHost).toBe(host);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("env var BLENDER_MCP_PORT overrides default port", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 65535 }), (port) => {
        process.env.BLENDER_MCP_PORT = String(port);
        const config = loadConfig();
        expect(config.blenderMcpPort).toBe(port);
      }),
      { numRuns: 30 },
    );
  });

  it("invalid port validation unchanged: port < 1 or > 65535 throws", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -1000, max: 0 }),
          fc.integer({ min: 65536, max: 100000 }),
        ),
        (port) => {
          process.env.BLENDER_MCP_PORT = String(port);
          expect(() => loadConfig()).toThrow(/BLENDER_MCP_PORT/);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("empty host validation unchanged: empty string throws", () => {
    const config: BlenderBridgeConfig = {
      blenderMcpHost: "",
      blenderMcpPort: 9876,
      blenderMcpCommand: "blender-mcp",
      blenderMcpArgs: [],
      healthCheckTimeoutMs: 5000,
      operationTimeoutMs: 30000,
    };
    expect(() => validateConfig(config)).toThrow(/BLENDER_MCP_HOST/);
  });

  it("args exceeding 1024 chars validation unchanged", () => {
    const config: BlenderBridgeConfig = {
      blenderMcpHost: "127.0.0.1",
      blenderMcpPort: 9876,
      blenderMcpCommand: "blender-mcp",
      blenderMcpArgs: ["a".repeat(1025)],
      healthCheckTimeoutMs: 5000,
      operationTimeoutMs: 30000,
    };
    expect(() => validateConfig(config)).toThrow(/BLENDER_MCP_ARGS/);
  });
});

/**
 * Preservation Property 6: Health Check Uses 5000ms Timeout and Returns Status
 *
 * For health check, timeout remains 5000ms and response format is unchanged.
 *
 * Validates: Requirements 3.6
 */
describe("Preservation: Health check uses 5000ms timeout and returns connectivity status", () => {
  it("health check uses healthCheckTimeoutMs from config (default 5000)", () => {
    const config = loadConfig();
    expect(config.healthCheckTimeoutMs).toBe(5000);
  });

  it("health check returns HealthCheckError with BLENDER_ADDON_UNREACHABLE when addon unavailable", async () => {
    // Use a port that nothing is listening on
    const config: BlenderBridgeConfig = {
      ...defaultConfig,
      blenderMcpPort: 19999, // Unlikely to be in use
      healthCheckTimeoutMs: 500, // Short timeout for test speed
    };

    const result = await runHealthCheck(config);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe("BLENDER_ADDON_UNREACHABLE");
      expect(result.error.message).toContain("Cannot connect");
      expect(result.error.remediation).toBeDefined();
      expect(result.error.remediation.length).toBeGreaterThan(0);
    }
  });

  it("health check returns HealthCheckSuccess when addon is reachable", async () => {
    // Create a mock TCP server to simulate the Blender addon
    const mockAddon = net.createServer((socket) => {
      // Just accept connection - health check only checks connectivity
      socket.end();
    });

    await new Promise<void>((resolve) => {
      mockAddon.listen(0, "127.0.0.1", resolve);
    });

    const addr = mockAddon.address() as net.AddressInfo;
    const config: BlenderBridgeConfig = {
      ...defaultConfig,
      blenderMcpPort: addr.port,
      healthCheckTimeoutMs: 5000,
    };

    const result = await runHealthCheck(config);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.addonListening).toBe(true);
    }

    await new Promise<void>((resolve) => mockAddon.close(() => resolve()));
  });

  it("health check response format matches HealthCheckResult type structure", async () => {
    // Test error case structure
    const config: BlenderBridgeConfig = {
      ...defaultConfig,
      blenderMcpPort: 19998,
      healthCheckTimeoutMs: 200,
    };

    const result = await runHealthCheck(config);

    // Must have 'status' field
    expect(result).toHaveProperty("status");
    expect(["ok", "error"]).toContain(result.status);

    if (result.status === "error") {
      // Error structure must have code, message, remediation
      expect(result.error).toHaveProperty("code");
      expect(result.error).toHaveProperty("message");
      expect(result.error).toHaveProperty("remediation");
      expect(["BLENDER_ADDON_UNREACHABLE", "BLENDER_MCP_NOT_INSTALLED"]).toContain(
        result.error.code,
      );
    }
  });

  it("checkAddonConnectivity respects timeout parameter", async () => {
    const start = Date.now();
    // Connect to a port that's not listening - should timeout
    const result = await checkAddonConnectivity("127.0.0.1", 19997, 300);
    const elapsed = Date.now() - start;

    expect(result).toBe(false);
    // Should respect the timeout (within reasonable margin)
    expect(elapsed).toBeLessThan(2000);
  });
});

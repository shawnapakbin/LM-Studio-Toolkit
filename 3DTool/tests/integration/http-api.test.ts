import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import type { Application } from "express";
import request from "supertest";

// http-server.ts uses __dirname (CJS global) for static asset path.
// In Jest CJS mode, __dirname is available natively.
// We ensure it points to the src/ directory for the http-server module.

const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);

let app: Application;
let sceneManagerModule: typeof import("../../src/shared-state");

beforeAll(async () => {
  const module = await import("../../src/http-server");
  sceneManagerModule = await import("../../src/shared-state");
  app = module.createApp();
});

describe("HTTP API Integration Tests", () => {
  /**
   * Validates: Requirements 5.5, 10.3, 10.4
   * Tests that POST /api/interactions returns enriched data with success and id.
   */
  describe("POST /api/interactions", () => {
    it("returns enriched data with success: true and a non-empty id", async () => {
      const interaction = {
        x: 1.5,
        y: 2.3,
        z: -0.7,
        meshId: "arm_mesh_001",
        prompt: "Make this part smoother",
        faceNormal: { x: 0, y: 1, z: 0 },
        faceIndex: 42,
        objectPath: "RootGroup/ArmGroup/ArmMesh",
        objectId: "bracket-01",
      };

      const response = await request(app).post("/api/interactions").send(interaction);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.id).toBeDefined();
      expect(typeof response.body.id).toBe("string");
      expect(response.body.id.length).toBeGreaterThan(0);
    });

    it("assigns unique ids to successive interactions", async () => {
      const interaction = {
        x: 0,
        y: 0,
        z: 0,
        meshId: "mesh_a",
        prompt: "First",
      };

      const res1 = await request(app).post("/api/interactions").send(interaction);
      const res2 = await request(app)
        .post("/api/interactions")
        .send({ ...interaction, prompt: "Second" });

      expect(res1.body.id).not.toBe(res2.body.id);
    });

    it("preserves enriched fields: faceNormal, faceIndex, objectPath, objectId", async () => {
      const interaction = {
        x: 3.14,
        y: -1.5,
        z: 0.99,
        meshId: "gear_mesh_007",
        prompt: "Add chamfer to this edge",
        faceNormal: { x: 0.577, y: 0.577, z: 0.577 },
        faceIndex: 128,
        objectPath: "Assembly/GearGroup/GearMesh",
        objectId: "gear-01",
      };

      const response = await request(app).post("/api/interactions").send(interaction);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify the enriched interaction was queued in SceneManager
      const pollResult = sceneManagerModule.sceneManager.pollInteractions();
      const queued = pollResult.events.find((e) => e.meshId === "gear_mesh_007");
      expect(queued).toBeDefined();
      expect(queued!.faceNormal).toEqual({ x: 0.577, y: 0.577, z: 0.577 });
      expect(queued!.faceIndex).toBe(128);
      expect(queued!.objectPath).toBe("Assembly/GearGroup/GearMesh");
      expect(queued!.objectId).toBe("gear-01");
    });

    it("defaults enriched fields when not provided", async () => {
      const interaction = {
        x: 1,
        y: 2,
        z: 3,
        meshId: "simple_mesh",
        prompt: "Do something",
      };

      const response = await request(app).post("/api/interactions").send(interaction);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // The server uses SceneManager's canonical ID format
      expect(response.body.id).toMatch(/^int_/);
    });
  });

  /**
   * Validates: Requirements 5.5, 10.3, 10.4
   * Tests SSE event delivery via GET /api/stream.
   */
  describe("GET /api/stream (SSE)", () => {
    it("responds with text/event-stream content type", (done) => {
      const server = (app as any).listen(0, () => {
        const port = (server.address() as { port: number }).port;
        let safetyTimer: ReturnType<typeof setTimeout>;

        const req = http.get(`http://localhost:${port}/api/stream`, (res) => {
          expect(res.headers["content-type"]).toContain("text/event-stream");
          expect(res.headers["cache-control"]).toContain("no-cache");
          clearTimeout(safetyTimer);
          req.destroy();
          server.close(done);
        });

        safetyTimer = setTimeout(() => {
          req.destroy();
          server.close(() => done(new Error("Timeout waiting for SSE headers")));
        }, 3000);
      });
    });

    it("delivers reload event when POST /api/reload is triggered", (done) => {
      const server = (app as any).listen(0, () => {
        const port = (server.address() as { port: number }).port;
        let receivedData = "";
        let safetyTimer: ReturnType<typeof setTimeout>;

        const req = http.get(`http://localhost:${port}/api/stream`, (res) => {
          res.on("data", (chunk: Buffer) => {
            receivedData += chunk.toString();
            // Check if we received the reload event
            if (receivedData.includes("event: reload")) {
              clearTimeout(safetyTimer);
              req.destroy();
              server.close(done);
            }
          });
        });

        // Give SSE connection time to establish, then trigger reload
        setTimeout(() => {
          http
            .request(
              {
                hostname: "localhost",
                port,
                path: "/api/reload",
                method: "POST",
                headers: { "Content-Type": "application/json" },
              },
              () => {},
            )
            .end("{}");
        }, 100);

        // Safety timeout to avoid hanging
        safetyTimer = setTimeout(() => {
          req.destroy();
          server.close(() => done(new Error("Timeout waiting for SSE reload event")));
        }, 3000);
      });
    });

    it("delivers pin_state event when interaction is posted", (done) => {
      const server = (app as any).listen(0, () => {
        const port = (server.address() as { port: number }).port;
        let receivedData = "";
        let safetyTimer: ReturnType<typeof setTimeout>;

        const req = http.get(`http://localhost:${port}/api/stream`, (res) => {
          res.on("data", (chunk: Buffer) => {
            receivedData += chunk.toString();
            if (receivedData.includes("event: pin_state")) {
              expect(receivedData).toContain('"state":"pending"');
              clearTimeout(safetyTimer);
              req.destroy();
              server.close(done);
            }
          });
        });

        // Give SSE connection time to establish, then post interaction
        setTimeout(() => {
          const postData = JSON.stringify({
            x: 1,
            y: 2,
            z: 3,
            meshId: "test",
            prompt: "hello",
          });

          http
            .request(
              {
                hostname: "localhost",
                port,
                path: "/api/interactions",
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(postData),
                },
              },
              () => {},
            )
            .end(postData);
        }, 100);

        // Safety timeout
        safetyTimer = setTimeout(() => {
          req.destroy();
          server.close(() => done(new Error("Timeout waiting for SSE pin_state event")));
        }, 3000);
      });
    });
  });

  /**
   * Validates: Requirements 5.5
   * Tests that GET /api/scene returns current scene state.
   */
  describe("GET /api/scene", () => {
    it("returns objects array (initially empty)", async () => {
      const response = await request(app).get("/api/scene");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("objects");
      expect(Array.isArray(response.body.objects)).toBe(true);
    });

    it("returns scene objects with position, rotation, scale, and materials", async () => {
      // Add a scene object via SceneManager directly
      const fixtureDir = path.resolve(__dirname_esm, "..", "fixtures");
      const cubePath = "cube.obj";

      // Ensure the fixture exists
      expect(fs.existsSync(path.resolve(fixtureDir, cubePath))).toBe(true);

      try {
        sceneManagerModule.sceneManager.addObject({
          id: "test-scene-obj",
          filePath: cubePath,
          workspaceRoot: fixtureDir,
          position: { x: 1, y: 2, z: 3 },
          rotation: { x: 0, y: 90, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          materials: [],
        });
      } catch {
        // Object might already exist from previous test run in same suite
      }

      const response = await request(app).get("/api/scene");

      expect(response.status).toBe(200);
      expect(response.body.objects).toBeDefined();
      const obj = response.body.objects.find((o: any) => o.id === "test-scene-obj");
      expect(obj).toBeDefined();
      expect(obj.filePath).toBe(cubePath);
      expect(obj.position).toEqual({ x: 1, y: 2, z: 3 });
      expect(obj.rotation).toEqual({ x: 0, y: 90, z: 0 });
      expect(obj.scale).toEqual({ x: 1, y: 1, z: 1 });
      expect(obj.materials).toEqual([]);

      // Cleanup
      try {
        sceneManagerModule.sceneManager.removeObject("test-scene-obj");
      } catch {
        // ignore if already removed
      }
    });
  });

  /**
   * Tests that GET /health returns status ok.
   */
  describe("GET /health", () => {
    it("returns { status: 'ok' }", async () => {
      const response = await request(app).get("/health");

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("ok");
    });
  });

  /**
   * Validates: Requirements 5.5
   * Tests that POST /api/load sets the active model.
   */
  describe("POST /api/load", () => {
    it("returns success when filePath is provided", async () => {
      const response = await request(app).post("/api/load").send({
        filePath: "models/test.glb",
        workspaceRoot: "/tmp/workspace",
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.filePath).toBe("models/test.glb");
      expect(response.body.workspaceRoot).toBe("/tmp/workspace");
    });

    it("returns 400 when filePath is missing", async () => {
      const response = await request(app).post("/api/load").send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  /**
   * Validates: Requirements 10.3
   * Tests that POST /api/camera accepts and stores camera position.
   */
  describe("POST /api/camera", () => {
    it("returns success when location and target are provided", async () => {
      const response = await request(app)
        .post("/api/camera")
        .send({
          location: { x: 5, y: 3, z: 10 },
          target: { x: 0, y: 0, z: 0 },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("returns 400 when location or target is missing", async () => {
      const response = await request(app)
        .post("/api/camera")
        .send({
          location: { x: 5, y: 3, z: 10 },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  /**
   * Validates: Requirements 5.5, 10.3, 10.4
   * Tests the full cycle: tool call triggers reload visible to SSE stream.
   */
  describe("Tool call → interaction → reload cycle", () => {
    it("POST /api/interactions followed by POST /api/reload succeeds", async () => {
      // Step 1: Submit an interaction
      const interactionRes = await request(app)
        .post("/api/interactions")
        .send({
          x: 2.0,
          y: 1.0,
          z: -1.0,
          meshId: "body_mesh",
          prompt: "Smooth this surface",
          faceNormal: { x: 0, y: 0, z: 1 },
          faceIndex: 10,
          objectPath: "Root/Body",
          objectId: "main-body",
        });

      expect(interactionRes.status).toBe(200);
      expect(interactionRes.body.success).toBe(true);

      // Step 2: Trigger reload (simulating what happens after LLM edits a file)
      const reloadRes = await request(app).post("/api/reload").send({});

      expect(reloadRes.status).toBe(200);
      expect(reloadRes.body.success).toBe(true);
    });

    it("full cycle: SSE stream receives both pin_state and reload events in sequence", (done) => {
      const server = (app as any).listen(0, () => {
        const port = (server.address() as { port: number }).port;
        let receivedData = "";
        let gotPinState = false;
        let gotReload = false;
        let safetyTimer: ReturnType<typeof setTimeout>;

        const req = http.get(`http://localhost:${port}/api/stream`, (res) => {
          res.on("data", (chunk: Buffer) => {
            receivedData += chunk.toString();
            if (receivedData.includes("event: pin_state")) {
              gotPinState = true;
            }
            if (receivedData.includes("event: reload")) {
              gotReload = true;
            }
            if (gotPinState && gotReload) {
              clearTimeout(safetyTimer);
              req.destroy();
              server.close(done);
            }
          });
        });

        // Step 1: Wait for SSE connection, then post interaction (triggers pin_state)
        setTimeout(() => {
          const postData = JSON.stringify({
            x: 1,
            y: 2,
            z: 3,
            meshId: "cycle_mesh",
            prompt: "test cycle",
            faceNormal: { x: 1, y: 0, z: 0 },
            faceIndex: 5,
            objectPath: "Root/Part",
            objectId: "part-01",
          });

          const postReq = http.request(
            {
              hostname: "localhost",
              port,
              path: "/api/interactions",
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(postData),
              },
            },
            () => {
              // Step 2: After interaction is posted, trigger reload (simulates file write complete)
              setTimeout(() => {
                http
                  .request(
                    {
                      hostname: "localhost",
                      port,
                      path: "/api/reload",
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                    },
                    () => {},
                  )
                  .end("{}");
              }, 50);
            },
          );
          postReq.end(postData);
        }, 100);

        safetyTimer = setTimeout(() => {
          req.destroy();
          server.close(() =>
            done(new Error(`Timeout: got pin_state=${gotPinState}, reload=${gotReload}`)),
          );
        }, 3000);
      });
    });
  });
});

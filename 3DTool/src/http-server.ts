import fs from "fs";
import path from "path";
import express, { Request, Response } from "express";

import { sceneManager } from "./shared-state";

// --- In-memory state (minimal until SceneManager is wired in task 6) ---

/** Connected SSE clients */
const sseClients: Response[] = [];

/** Active model file path (set via POST /api/load or launch_viewer) */
let activeModelPath: string | null = null;

/** Active workspace root (set alongside activeModelPath) */
let activeWorkspaceRoot: string | null = null;

// --- SSE Helpers ---

function addSseClient(res: Response): void {
  sseClients.push(res);
}

function removeSseClient(res: Response): void {
  const idx = sseClients.indexOf(res);
  if (idx !== -1) {
    sseClients.splice(idx, 1);
  }
}

function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

// --- Public API for other modules ---

export function setActiveModel(filePath: string, workspaceRoot: string): void {
  activeModelPath = filePath;
  activeWorkspaceRoot = workspaceRoot;
}

export function getActiveModel(): { filePath: string | null; workspaceRoot: string | null } {
  return { filePath: activeModelPath, workspaceRoot: activeWorkspaceRoot };
}

export function triggerReload(): void {
  broadcast("reload", {});
}

export function broadcastEvent(event: string, data: unknown): void {
  broadcast(event, data);
}

// --- Express App ---

export function createApp(): express.Application {
  const app = express();
  app.use(express.json());

  // Serve viewer assets from dist/viewer/
  // Use __dirname in CJS mode (production), fallback for ESM test environments
  const currentDir = typeof __dirname !== "undefined" ? __dirname : process.cwd();
  const viewerPath = path.resolve(currentDir, "viewer");
  app.use(express.static(viewerPath));

  // --- GET /health ---
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // --- GET /api/stream (SSE) ---
  app.get("/api/stream", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    addSseClient(res);

    _req.on("close", () => {
      removeSseClient(res);
    });
  });

  // --- POST /api/interactions ---
  app.post("/api/interactions", (req: Request, res: Response) => {
    const body = req.body;

    // Use SceneManager as the single source of truth for interaction tracking
    const interaction = sceneManager.addInteraction({
      x: body.x ?? 0,
      y: body.y ?? 0,
      z: body.z ?? 0,
      meshId: body.meshId ?? "unknown",
      prompt: body.prompt ?? "",
      faceNormal: body.faceNormal ?? { x: 0, y: 0, z: 0 },
      faceIndex: body.faceIndex ?? -1,
      objectPath: body.objectPath ?? "",
      objectId: body.objectId ?? "",
    });

    // Broadcast pin_state using the canonical ID from SceneManager
    broadcast("pin_state", { id: interaction.id, state: "pending" });

    res.json({ success: true, id: interaction.id });
  });

  // --- GET /api/scene ---
  app.get("/api/scene", (_req: Request, res: Response) => {
    const objects = sceneManager.listObjects();
    res.json({
      objects: objects.map((obj) => ({
        id: obj.id,
        filePath: obj.filePath,
        position: obj.position,
        rotation: obj.rotation,
        scale: obj.scale,
        materials: obj.materials,
      })),
    });
  });

  // --- POST /api/camera ---
  app.post("/api/camera", (req: Request, res: Response) => {
    const { location, target } = req.body;
    if (!location || !target) {
      res.status(400).json({ error: "location and target are required" });
      return;
    }
    sceneManager.setCameraPosition(
      { x: location.x ?? 0, y: location.y ?? 0, z: location.z ?? 0 },
      { x: target.x ?? 0, y: target.y ?? 0, z: target.z ?? 0 },
    );
    res.json({ success: true });
  });

  // --- POST /api/load ---
  app.post("/api/load", (req: Request, res: Response) => {
    const { filePath, workspaceRoot } = req.body;
    if (!filePath) {
      res.status(400).json({ error: "filePath is required" });
      return;
    }
    setActiveModel(filePath, workspaceRoot || "");
    res.json({ success: true, filePath, workspaceRoot: workspaceRoot || "" });
  });

  // --- POST /api/reload ---
  app.post("/api/reload", (_req: Request, res: Response) => {
    triggerReload();
    res.json({ success: true });
  });

  // --- GET /api/model/:objectId? ---
  app.get("/api/model/:objectId?", (req: Request, res: Response) => {
    const objectId = req.params.objectId;

    let fullPath: string;

    // If objectId is provided, try to find the scene object
    if (objectId) {
      const sceneObjects = sceneManager.listObjects();
      const sceneObj = sceneObjects.find((o) => o.id === objectId);
      if (sceneObj) {
        fullPath = path.resolve(sceneObj.workspaceRoot, sceneObj.filePath);
      } else if (!activeModelPath || !activeWorkspaceRoot) {
        res.status(404).json({ error: "Object not found and no active model set", objectId });
        return;
      } else {
        // Fall back to active model
        fullPath = path.resolve(activeWorkspaceRoot, activeModelPath);
      }
    } else {
      // No objectId — serve active model
      if (!activeModelPath || !activeWorkspaceRoot) {
        res.status(404).json({ error: "No active model set" });
        return;
      }
      fullPath = path.resolve(activeWorkspaceRoot, activeModelPath);
    }

    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: "Model file not found", path: fullPath });
      return;
    }

    // Determine content type from extension
    const ext = path.extname(fullPath).toLowerCase();
    switch (ext) {
      case ".obj":
        res.setHeader("Content-Type", "text/plain");
        break;
      case ".glb":
        res.setHeader("Content-Type", "model/gltf-binary");
        break;
      case ".gltf":
        res.setHeader("Content-Type", "model/gltf+json");
        break;
      default:
        res.setHeader("Content-Type", "application/octet-stream");
    }

    const stream = fs.createReadStream(fullPath);
    stream.pipe(res);
    stream.on("error", (err) => {
      res.status(500).json({ error: "Failed to read model file", message: err.message });
    });
  });

  return app;
}

// --- Start Server ---

const DEFAULT_PORT = 3344;

export interface HttpServerOptions {
  port?: number;
  openBrowser?: boolean;
}

export function startHttpServer(options: HttpServerOptions = {}): void {
  const { port = DEFAULT_PORT, openBrowser = false } = options;
  const app = createApp();

  app.listen(port, () => {
    console.error(`3DTool HTTP server running on http://localhost:${port}`);
    if (openBrowser) {
      openInBrowser(`http://localhost:${port}`);
    }
  });
}

/** Open a URL in the user's default browser (platform-specific) */
function openInBrowser(url: string): void {
  const { exec } = require("child_process") as typeof import("child_process");
  const platform = process.platform;

  let command: string;
  if (platform === "win32") {
    command = `start "" "${url}"`;
  } else if (platform === "darwin") {
    command = `open "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  exec(command, (err: Error | null) => {
    if (err) {
      console.error(`Failed to open browser: ${err.message}`);
    }
  });
}

import fs from "fs";
import path from "path";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { stateManager } from "./state";

dotenv.config();

const PORT = 3344; // New dedicated port for 3DTool

export function startHttpServer(): void {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Serve static viewer files
  app.use("/viewer", express.static(path.join(__dirname, "viewer")));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "3d-tool" });
  });

  // Set the active model file (used by launch_viewer MCP tool and for testing)
  app.post("/api/load", (req, res) => {
    const { file, workspace } = req.body as { file: string; workspace: string };
    if (!file || !workspace) {
      res.status(400).json({ error: "file and workspace are required" });
      return;
    }
    stateManager.setFile(workspace, file);
    res.json({ ok: true });
  });

  // Serve the current 3D model file
  app.get("/api/model", (_req, res) => {
    const file = stateManager.currentFile;
    const workspace = stateManager.currentWorkspace;
    if (!file || !workspace) {
      res.status(404).send("No model loaded");
      return;
    }
    const resolved = path.resolve(workspace, file);
    if (!fs.existsSync(resolved)) {
      res.status(404).send("Model file not found");
      return;
    }
    res.setHeader("Content-Type", "text/plain");
    res.sendFile(resolved);
  });

  // Trigger a live reload without changing the active file (used by delegate mode)
  app.post("/api/reload", (_req, res) => {
    stateManager.triggerReload();
    res.json({ ok: true });
  });

  // SSE stream for live reload events
  app.get("/api/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    stateManager.addClient(res);
    req.on("close", () => stateManager.removeClient(res));
  });

  // Receive interaction events from the viewer
  app.post("/api/interactions", (req, res) => {
    const { x, y, z, meshId, prompt } = req.body as {
      x: number;
      y: number;
      z: number;
      meshId: string;
      prompt: string;
    };
    const event = stateManager.addInteraction({ x, y, z, meshId, prompt });
    res.json({ ok: true, id: event.id });
  });

  // Read (and drain) all pending interaction events
  app.get("/api/interactions", (_req, res) => {
    res.json(stateManager.pollInteractions());
  });

  const httpServer = app.listen(PORT, () => {
    console.error(`3DTool HTTP server running on port ${PORT}`);
  });
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`3DTool HTTP server: port ${PORT} already in use — switching to delegate mode`);
      stateManager.setDelegateMode(PORT);
    } else {
      throw err;
    }
  });
}

// Allow running standalone
if (require.main === module) {
  startHttpServer();
}

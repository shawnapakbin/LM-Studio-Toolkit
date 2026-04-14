import cors from "cors";
import express, { type Express } from "express";

export interface ToolServerOptions {
  name: string;
  port: number;
  jsonLimit?: string;
}

/**
 * Create a pre-configured Express app for a tool server.
 * Includes CORS, JSON parsing, and a /health endpoint.
 */
export function createToolServer(options: ToolServerOptions): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: options.jsonLimit ?? "1mb" }));

  app.get("/health", (_, res) => {
    res.json({ status: "ok", tool: options.name });
  });

  return app;
}

/**
 * Start a tool server and log the startup message.
 */
export function startToolServer(app: Express, options: ToolServerOptions): void {
  app.listen(options.port, () => {
    console.log(`${options.name} running → http://localhost:${options.port}`);
  });
}

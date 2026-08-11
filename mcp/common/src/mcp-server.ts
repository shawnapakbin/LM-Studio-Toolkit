import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerAskUserTool } from "./tools/ask-user";
import { registerCalculatorTool } from "./tools/calculator";
import { registerClockTool } from "./tools/clock";
import { registerDocumentScraperTool } from "./tools/document-scraper";

const server = new McpServer({
  name: "lm-studio-common-tools",
  version: "2.3.2",
});

registerCalculatorTool(server);
registerClockTool(server);
registerAskUserTool(server);
registerDocumentScraperTool(server);

async function startInterviewUI() {
  try {
    // Import the Express app and port setter from AskUser package
    const { app } = await import("llm-toolkit-ask-user/dist/index");
    const { setActiveUIPort } = await import("llm-toolkit-ask-user/dist/ask-user");
    const basePort = Number(process.env.ASK_USER_UI_PORT ?? process.env.PORT ?? 3338);

    const tryListen = (port: number, retries: number): void => {
      const httpServer = app.listen(port);

      httpServer.on("listening", () => {
        setActiveUIPort(port);
        console.error(`AskUser Interview UI available at http://localhost:${port}/ui/`);
      });

      httpServer.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && retries > 0) {
          console.error(`Port ${port} in use, trying ${port + 1}...`);
          httpServer.close();
          tryListen(port + 1, retries - 1);
        } else if (err.code === "EADDRINUSE") {
          console.error(
            `Interview UI: all ports ${basePort}-${port} in use. UI unavailable (MCP tool still works).`,
          );
        } else {
          console.error(`Interview UI HTTP server error: ${err.message}`);
        }
      });
    };

    tryListen(basePort, 5);
  } catch (err) {
    console.error("Failed to start Interview UI HTTP server:", err);
    // Non-fatal: MCP server continues working without the UI
  }
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LM Studio Common Tools MCP server running on stdio");

  // Start the AskUser interview UI HTTP server (non-fatal if port is busy)
  await startInterviewUI();
}

main().catch((error) => {
  console.error("MCP server startup failed:", error);
  process.exit(1);
});

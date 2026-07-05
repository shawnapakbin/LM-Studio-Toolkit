import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from "@modelcontextprotocol/sdk/types.js";

export type ToolHandler = (args: unknown) => Promise<string>;

export interface ToolDefinition {
  tool: Tool;
  handler: ToolHandler;
}

export async function startServer(
  name: string,
  version: string,
  tools: ToolDefinition[]
): Promise<void> {
  const server = new Server(
    {
      name,
      version
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((item) => item.tool)
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const match = tools.find((item) => item.tool.name === request.params.name);
    if (!match) {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    const text = await match.handler(request.params.arguments ?? {});
    return {
      content: [
        {
          type: "text",
          text
        }
      ]
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

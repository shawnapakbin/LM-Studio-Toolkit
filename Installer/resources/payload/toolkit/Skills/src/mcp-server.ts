import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { z } from "zod";
import { defineSkill, deleteSkill, executeSkill, getSkill, listSkills } from "./skills";

dotenv.config();

// Flat input shape — all fields optional except action.
// Cast to any to avoid Zod v3/v4 compat type depth errors in the SDK generics.
const skillsInputShape = {
  action: z
    .enum(["define_skill", "execute_skill", "get_skill", "list_skills", "delete_skill"])
    .describe("The operation to perform."),
  // define_skill fields
  name: z
    .string()
    .optional()
    .describe("(define_skill/execute_skill/get_skill/delete_skill) Kebab-case skill name."),
  description: z.string().optional().describe("(define_skill) Human-readable description."),
  paramSchema: z
    .object({
      type: z.literal("object"),
      properties: z.record(z.object({ type: z.string(), description: z.string().optional() })),
      required: z.array(z.string()).optional(),
    })
    .optional()
    .describe("(define_skill) JSON Schema for skill parameters."),
  steps: z
    .array(
      z.object({
        type: z.enum(["prompt", "tool_call"]),
        template: z.string().optional(),
        tool: z.string().optional(),
        args: z.record(z.string()).optional(),
      }),
    )
    .optional()
    .describe("(define_skill) Ordered step sequence."),
  // execute_skill fields
  params: z
    .record(z.unknown())
    .optional()
    .describe("(execute_skill) Parameter values for interpolation."),
  // get_skill / delete_skill fields
  id: z.string().optional().describe("(get_skill/delete_skill) Skill UUID (alternative to name)."),
  // list_skills fields
  limit: z.number().optional().describe("(list_skills) Max results (default 20)."),
  offset: z.number().optional().describe("(list_skills) Pagination offset (default 0)."),
} as const;

type SkillsInput = {
  action: "define_skill" | "execute_skill" | "get_skill" | "list_skills" | "delete_skill";
  name?: string;
  description?: string;
  paramSchema?: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  steps?: Array<{
    type: "prompt" | "tool_call";
    template?: string;
    tool?: string;
    args?: Record<string, string>;
  }>;
  params?: Record<string, unknown>;
  id?: string;
  limit?: number;
  offset?: number;
};

export function createSkillsMcpServer(): McpServer {
  const server = new McpServer({
    name: "lm-studio-skills-tool",
    version: "2.1.0",
  });

  // Cast to any to avoid Zod v3/v4 compat type depth errors in the SDK generics.
  // Runtime behaviour is unaffected — Zod v3 validation still runs correctly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server.registerTool as any)(
    "skills",
    {
      description:
        "Skills tool for managing and executing reusable agent playbooks. Set action to one of: 'define_skill' (create or update a skill), 'execute_skill' (resolve a skill's steps with params), 'get_skill' (retrieve a skill by name or id), 'list_skills' (list all skills), 'delete_skill' (remove a skill by name or id). Then populate the relevant payload fields for that action.",
      inputSchema: skillsInputShape,
    },
    async (input: SkillsInput): Promise<CallToolResult> => {
      const { action, name, description, paramSchema, steps, params, id, limit, offset } = input;

      let result: unknown;

      switch (action) {
        case "define_skill":
          result = await defineSkill({
            name: name as string,
            description: description as string,
            paramSchema: paramSchema as SkillsInput["paramSchema"] & { type: "object" },
            steps: steps as SkillsInput["steps"] &
              Array<{
                type: "prompt" | "tool_call";
                template: string;
                tool: string;
                args: Record<string, string>;
              }>,
          });
          break;

        case "execute_skill":
          result = await executeSkill({ name: name as string, params });
          break;

        case "get_skill":
          result = await getSkill({ name, id });
          break;

        case "list_skills":
          result = await listSkills({ limit, offset });
          break;

        case "delete_skill":
          result = await deleteSkill({ name, id });
          break;

        default: {
          const _exhaustive: never = action;
          result = {
            success: false,
            error: { code: "INVALID_INPUT", message: `Unknown action: ${_exhaustive}` },
          };
        }
      }

      const res = result as { success: boolean };
      return {
        isError: !res.success,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  return server;
}

async function main() {
  const server = createSkillsMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LM Studio Skills MCP server running on stdio");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("MCP server startup failed:", error);
    process.exit(1);
  });
}

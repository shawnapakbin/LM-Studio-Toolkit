import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { startServer } from "../shared/mcp-helpers.js";

const readArgs = z.object({
  path: z.string(),
  maxChars: z.number().int().positive().max(200000).optional().default(20000)
});

const writeArgs = z.object({
  path: z.string(),
  content: z.string()
});

const listArgs = z.object({
  path: z.string().optional().default(".")
});

const fsRoot = path.resolve(process.env.FS_ROOT ?? process.cwd());

function resolveSafePath(requestPath: string): string {
  const absolute = path.resolve(fsRoot, requestPath);
  if (!absolute.startsWith(fsRoot)) {
    throw new Error("Path is outside FS_ROOT sandbox.");
  }
  return absolute;
}

async function main(): Promise<void> {
  await startServer("filesystem-mcp-server", "0.1.0", [
    {
      tool: {
        name: "read_file",
        description: "Read UTF-8 file contents within FS_ROOT sandbox.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            maxChars: { type: "number", minimum: 1, maximum: 200000 }
          },
          required: ["path"]
        }
      },
      handler: async (args: unknown) => {
        const parsed = readArgs.parse(args);
        const filePath = resolveSafePath(parsed.path);
        const content = await fs.readFile(filePath, "utf8");
        return content.slice(0, parsed.maxChars);
      }
    },
    {
      tool: {
        name: "write_file",
        description: "Write UTF-8 content within FS_ROOT sandbox, creating directories if needed.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" }
          },
          required: ["path", "content"]
        }
      },
      handler: async (args: unknown) => {
        const parsed = writeArgs.parse(args);
        const filePath = resolveSafePath(parsed.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, parsed.content, "utf8");
        return `Wrote ${parsed.content.length} chars to ${filePath}`;
      }
    },
    {
      tool: {
        name: "list_dir",
        description: "List files and folders in a sandboxed directory.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" }
          }
        }
      },
      handler: async (args: unknown) => {
        const parsed = listArgs.parse(args);
        const dir = resolveSafePath(parsed.path);
        const items = await fs.readdir(dir, { withFileTypes: true });
        return items
          .map((item) => (item.isDirectory() ? `${item.name}/` : item.name))
          .sort((a, b) => a.localeCompare(b))
          .join("\n");
      }
    }
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

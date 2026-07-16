import { z } from "zod";
import { startServer } from "../shared/mcp-helpers.js";

const nowArgs = z.object({
  timeZone: z.string().optional().default("UTC"),
});

const addDaysArgs = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().int().min(-36500).max(36500),
});

function formatDateParts(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone,
  }).format(date);

  return parts;
}

async function main(): Promise<void> {
  await startServer("calendar-mcp-server", "0.1.0", [
    {
      tool: {
        name: "get_current_datetime",
        description: "Get current date/time for a given IANA timezone.",
        inputSchema: {
          type: "object",
          properties: {
            timeZone: { type: "string" },
          },
        },
      },
      handler: async (args: unknown) => {
        const parsed = nowArgs.parse(args);
        const now = new Date();
        return formatDateParts(now, parsed.timeZone);
      },
    },
    {
      tool: {
        name: "add_days",
        description: "Add or subtract days from a date (YYYY-MM-DD).",
        inputSchema: {
          type: "object",
          properties: {
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            days: { type: "integer", minimum: -36500, maximum: 36500 },
          },
          required: ["date", "days"],
        },
      },
      handler: async (args: unknown) => {
        const parsed = addDaysArgs.parse(args);
        const base = new Date(`${parsed.date}T00:00:00Z`);
        if (Number.isNaN(base.getTime())) {
          throw new Error("Invalid date.");
        }

        base.setUTCDate(base.getUTCDate() + parsed.days);
        return base.toISOString().slice(0, 10);
      },
    },
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

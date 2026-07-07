/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import { Parser } from "expr-eval";
import { z } from "zod";
import { startServer } from "../shared/mcp-helpers.js";

const evaluateArgs = z.object({
  expression: z.string().min(1),
  variables: z.record(z.number()).optional().default({})
});

async function main(): Promise<void> {
  await startServer("calculator-mcp-server", "0.1.0", [
    {
      tool: {
        name: "evaluate_expression",
        description: "Evaluate arithmetic/scientific expressions safely.",
        inputSchema: {
          type: "object",
          properties: {
            expression: { type: "string" },
            variables: {
              type: "object",
              additionalProperties: { type: "number" }
            }
          },
          required: ["expression"]
        }
      },
      handler: async (args: unknown) => {
        const parsed = evaluateArgs.parse(args);
        const parser = new Parser({
          allowMemberAccess: false
        });

        const compiled = parser.parse(parsed.expression);
        const result = compiled.evaluate(parsed.variables);
        return `${String(result)}`;
      }
    }
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

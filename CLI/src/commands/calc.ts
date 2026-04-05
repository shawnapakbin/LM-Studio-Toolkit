/**
 * calc — evaluate a math expression via the Calculator tool
 */

import type { Command } from "commander";
import { TOOL_ENDPOINTS } from "../config";
import { handleError, printResult, toolPost } from "../http";

export function registerCalcCommand(program: Command): void {
  program
    .command("calc <expression>")
    .description('Evaluate a math expression  e.g. calc "sin(30°)"')
    .option("-p, --precision <digits>", "Significant digits for output", parseInt)
    .action(async (expression: string, opts: { precision?: number }) => {
      try {
        const result = await toolPost(`${TOOL_ENDPOINTS.calculator}/tools/calculate_engineering`, {
          expression,
          ...(opts.precision !== undefined && { precision: opts.precision }),
        });
        printResult(result);
      } catch (err) {
        handleError(err);
      }
    });
}

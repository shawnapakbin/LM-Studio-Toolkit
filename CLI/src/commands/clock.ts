/**
 * clock — get current date/time via the Clock tool
 */

import type { Command } from "commander";
import { TOOL_ENDPOINTS } from "../config";
import { handleError, printResult, toolPost } from "../http";

export function registerClockCommand(program: Command): void {
  program
    .command("clock")
    .description("Get the current date and time")
    .option("-z, --timezone <tz>", "IANA timezone  e.g. America/New_York")
    .option("-f, --format <fmt>", "Output format: iso | locale | unix")
    .action(async (opts: { timezone?: string; format?: string }) => {
      try {
        const result = await toolPost(`${TOOL_ENDPOINTS.clock}/tools/get_current_time`, {
          ...(opts.timezone && { timezone: opts.timezone }),
          ...(opts.format && { format: opts.format }),
        });
        printResult(result);
      } catch (err) {
        handleError(err);
      }
    });
}

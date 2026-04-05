/**
 * browse — fetch a URL via the WebBrowser tool
 */

import type { Command } from "commander";
import { TOOL_ENDPOINTS } from "../config";
import { handleError, printResult, toolPost } from "../http";

export function registerBrowseCommand(program: Command): void {
  program
    .command("browse <url>")
    .description("Fetch and render a URL via the headless browser")
    .option("-f, --format <type>", "Output format: text | markdown | html", "markdown")
    .option("-s, --screenshot", "Capture a screenshot")
    .option("--wait-selector <selector>", "Wait for a CSS selector before extracting")
    .action(
      async (
        url: string,
        opts: { format: string; screenshot?: boolean; waitSelector?: string },
      ) => {
        try {
          const result = await toolPost(`${TOOL_ENDPOINTS.webbrowser}/tools/browse_web`, {
            url,
            outputFormat: opts.format,
            ...(opts.screenshot && { screenshot: true }),
            ...(opts.waitSelector && { waitForSelector: opts.waitSelector }),
          });
          printResult(result);
        } catch (err) {
          handleError(err);
        }
      },
    );
}

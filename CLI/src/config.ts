/**
 * CLI Configuration — tool endpoint base URLs and defaults
 */

import { TOOL_PORTS, toolEndpoint } from "@shared/ports";

export { TOOL_PORTS };

export const TOOL_ENDPOINTS: Record<string, string> = Object.fromEntries(
  Object.keys(TOOL_PORTS).map((name) => [name, toolEndpoint(name)]),
);

export const DEFAULT_ECM_SESSION = "cli-session";

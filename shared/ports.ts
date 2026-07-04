/**
 * Central port registry for all LLM Toolkit tools.
 *
 * Each tool's port can be overridden at runtime via environment variables:
 *   - Port only:     {TOOL_UPPER}_PORT        (e.g. TERMINAL_PORT=3333)
 *   - Full endpoint: {TOOL_UPPER}_ENDPOINT    (e.g. TERMINAL_ENDPOINT=http://10.0.0.5:3333)
 *
 * The {TOOL_UPPER}_ENDPOINT override takes priority over {TOOL_UPPER}_PORT,
 * enabling remote/containerised deployments without changing any source code.
 */

/** Default HTTP port for each tool, keyed by lowercase tool name. */
export const TOOL_PORTS: Record<string, number> = {
  terminal: Number(process.env.TERMINAL_PORT ?? 3333),
  webbrowser: Number(process.env.WEBBROWSER_PORT ?? 3334),
  calculator: Number(process.env.CALCULATOR_PORT ?? 3335),
  documentscraper: Number(process.env.DOCUMENTSCRAPER_PORT ?? 3336),
  clock: Number(process.env.CLOCK_PORT ?? 3337),
  askuser: Number(process.env.ASKUSER_PORT ?? 3338),
  rag: Number(process.env.RAG_PORT ?? 3339),
  csvexporter: Number(process.env.CSVEXPORTER_PORT ?? 3340),
  skills: Number(process.env.SKILLS_PORT ?? 3341),
  pythonshell: Number(process.env.PYTHONSHELL_PORT ?? 3343),
  "3dtool": Number(process.env.TOOL_3DTOOL_PORT ?? 3344),
  browserless: Number(process.env.BROWSERLESS_PORT ?? 3003),
  git: Number(process.env.GIT_PORT ?? 3011),
};

/**
 * Returns the base URL for a named tool endpoint (no trailing slash).
 *
 * Resolution order:
 *  1. `{TOOL_UPPER}_ENDPOINT` env var   — full URL override (highest priority)
 *  2. `http://localhost:{TOOL_UPPER}_PORT` env var   — port-only override
 *  3. `http://localhost:<default port>`  — compiled-in default
 *
 * The `name` argument is case-insensitive and may contain hyphens or spaces.
 */
export function toolEndpoint(name: string): string {
  const key = name.toUpperCase().replace(/[-\s]/g, "_");
  const endpointOverride = process.env[`${key}_ENDPOINT`];
  if (endpointOverride) return endpointOverride.replace(/\/$/, "");
  const port = TOOL_PORTS[name.toLowerCase().replace(/[-\s]/g, "")] ?? 3333;
  return `http://localhost:${port}`;
}

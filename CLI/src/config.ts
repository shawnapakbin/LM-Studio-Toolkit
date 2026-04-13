/**
 * CLI Configuration — tool endpoint base URLs and defaults
 */

export const TOOL_PORTS: Record<string, number> = {
  terminal: 3330,
  webbrowser: 3334,
  calculator: 3335,
  documentscraper: 3336,
  clock: 3337,
  askuser: 3338,
  rag: 3339,
  pythonshell: 3343,
  skills: 3341,
  ecm: 3342,
};

export const TOOL_ENDPOINTS: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_PORTS).map(([name, port]) => [name, `http://localhost:${port}`]),
);

export const DEFAULT_ECM_SESSION = "cli-session";

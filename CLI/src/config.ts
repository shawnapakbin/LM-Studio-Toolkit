/**
 * CLI Configuration — tool endpoint base URLs and defaults
 */

export const TOOL_PORTS: Record<string, number> = {
  terminal: 3333,
  webbrowser: 3334,
  calculator: 3335,
  documentscraper: 3336,
  clock: 3337,
  askuser: 3338,
  pythonshell: 3343,
  skills: 3341,
};

export const TOOL_ENDPOINTS: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_PORTS).map(([name, port]) => [name, `http://localhost:${port}`]),
);

/**
 * Tool endpoint configuration for slash command dispatch
 */
export const ENDPOINTS = {
  calculator: process.env.CALCULATOR_ENDPOINT ?? "http://localhost:3335",
  webbrowser: process.env.WEBBROWSER_ENDPOINT ?? "http://localhost:3334",
  clock: process.env.CLOCK_ENDPOINT ?? "http://localhost:3337",
  terminal: process.env.TERMINAL_ENDPOINT ?? "http://localhost:3330",
  askuser: process.env.ASKUSER_ENDPOINT ?? "http://localhost:3338",
  rag: process.env.RAG_ENDPOINT ?? "http://localhost:3339",
  pythonshell: process.env.PYTHONSHELL_ENDPOINT ?? "http://localhost:3343",
  skills: process.env.SKILLS_ENDPOINT ?? "http://localhost:3341",
  ecm: process.env.ECM_ENDPOINT ?? "http://localhost:3342",
} as const;

export const DEFAULT_SESSION = process.env.SLASH_DEFAULT_SESSION ?? "default";

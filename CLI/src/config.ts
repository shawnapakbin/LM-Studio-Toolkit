/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * CLI Configuration — tool endpoint base URLs and defaults.
 *
 * Port assignments are kept in sync with the canonical registry at shared/ports.ts.
 * If you add or change a port here, update shared/ports.ts as well.
 */

export const TOOL_PORTS: Record<string, number> = {
  terminal: 3333,
  webbrowser: 3334,
  calculator: 3335,
  documentscraper: 3336,
  clock: 3337,
  askuser: 3338,
  rag: 3339,
  csvexporter: 3340,
  skills: 3341,
  pythonshell: 3343,
  browserless: 3003,
  git: 3011,
  fileeditor: 3012,
  packagemanager: 3013,
  slashcommands: 3345,
  blenderbridge: 3346,
};

export const TOOL_ENDPOINTS: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_PORTS).map(([name, port]) => [name, `http://localhost:${port}`]),
);

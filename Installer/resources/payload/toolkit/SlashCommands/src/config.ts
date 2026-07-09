/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Tool endpoint configuration for slash command dispatch
 */
export const ENDPOINTS = {
  calculator: process.env.CALCULATOR_ENDPOINT ?? "http://localhost:3335",
  webbrowser: process.env.WEBBROWSER_ENDPOINT ?? "http://localhost:3334",
  clock: process.env.CLOCK_ENDPOINT ?? "http://localhost:3337",
  terminal: process.env.TERMINAL_ENDPOINT ?? "http://localhost:3333",
  askuser: process.env.ASKUSER_ENDPOINT ?? "http://localhost:3338",
  rag: process.env.RAG_ENDPOINT ?? "http://localhost:3339",
  pythonshell: process.env.PYTHONSHELL_ENDPOINT ?? "http://localhost:3343",
  skills: process.env.SKILLS_ENDPOINT ?? "http://localhost:3341",
} as const;

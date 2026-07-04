/**
 * Tool endpoint configuration for slash command dispatch
 */
import { toolEndpoint } from "@shared/ports";

export const ENDPOINTS = {
  calculator: toolEndpoint("calculator"),
  webbrowser: toolEndpoint("webbrowser"),
  clock: toolEndpoint("clock"),
  terminal: toolEndpoint("terminal"),
  askuser: toolEndpoint("askuser"),
  rag: toolEndpoint("rag"),
  pythonshell: toolEndpoint("pythonshell"),
  skills: toolEndpoint("skills"),
} as const;

export const DEFAULT_SESSION = process.env.SLASH_DEFAULT_SESSION ?? "default";

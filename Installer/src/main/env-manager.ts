import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import dotenv from "dotenv";

import type { EnvField, EnvState } from "./types";

const DEFAULT_FIELDS: EnvField[] = [
  {
    key: "BROWSERLESS_TOKEN",
    value: "",
    required: false,
    description: "API token for Browserless.io hosted MCP server (replaces BROWSERLESS_API_KEY).",
  },
  {
    key: "BROWSERLESS_API_URL",
    value: "",
    required: false,
    description: "Custom Browserless API URL. Empty defaults to https://production-sfo.browserless.io.",
  },
  {
    key: "LMSTUDIO_MCP_PLUGIN_ROOT",
    value: "",
    description: "Optional override for the LM Studio MCP plugin root folder.",
  },
];

function envFilePath(installRoot: string) {
  return join(installRoot, ".env");
}

export function ensureEnvState(installRoot: string) {
  const filePath = envFilePath(installRoot);
  if (!existsSync(filePath)) {
    saveEnvState(
      installRoot,
      Object.fromEntries(DEFAULT_FIELDS.map((field) => [field.key, field.value])),
    );
  }

  return loadEnvState(installRoot);
}

export function loadEnvState(installRoot: string): EnvState {
  const filePath = envFilePath(installRoot);
  const parsed = existsSync(filePath)
    ? dotenv.parse(readFileSync(filePath, "utf8"))
    : Object.fromEntries(DEFAULT_FIELDS.map((field) => [field.key, field.value]));

  return {
    envFilePath: filePath,
    fields: DEFAULT_FIELDS.map((field) => ({
      ...field,
      value: parsed[field.key] ?? field.value,
    })),
  };
}

export function saveEnvState(installRoot: string, entries: Record<string, string>) {
  const filePath = envFilePath(installRoot);
  mkdirSync(dirname(filePath), { recursive: true });

  const orderedKeys = DEFAULT_FIELDS.map((field) => field.key);
  const lines = orderedKeys.map((key) => `${key}=${entries[key] ?? ""}`);
  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");

  return loadEnvState(installRoot);
}

/**
 * Masks a token value for display purposes.
 * Shows first 4 characters and last 4 characters with *** in between.
 * Short tokens (8 chars or less) show first 2 chars + ***.
 * Empty tokens return "(not set)".
 */
export function maskTokenForDisplay(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "(not set)";
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}***`;
  return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
}

/**
 * Resolves the Browserless authentication token from an environment record.
 * Priority: BROWSERLESS_TOKEN > BROWSERLESS_API_KEY (backward compat).
 * Returns empty string and logs a warning if neither is set.
 */
export function resolveBrowserlessToken(env: Record<string, string>): string {
  const token = (env.BROWSERLESS_TOKEN ?? "").trim();
  if (token) return token;

  const legacyKey = (env.BROWSERLESS_API_KEY ?? "").trim();
  if (legacyKey) return legacyKey;

  console.warn(
    "[env-manager] BROWSERLESS_TOKEN is not configured. Browserless tools will not authenticate until a token is provided.",
  );
  return "";
}

/**
 * Resolves the Browserless fallback endpoint URL from an environment record.
 * Priority: BROWSERLESS_MCP_ENDPOINT > BROWSERLESS_API_URL + /smartscraper > default.
 */
export function resolveBrowserlessEndpoint(env: Record<string, string>): string {
  const mcpEndpoint = (env.BROWSERLESS_MCP_ENDPOINT ?? "").trim();
  if (mcpEndpoint) return mcpEndpoint;

  const apiUrl = (env.BROWSERLESS_API_URL ?? "").trim();
  if (apiUrl) return `${apiUrl}/smartscraper`;

  return "https://production-sfo.browserless.io/smartscraper";
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import dotenv from "dotenv";

import type { EnvField, EnvState } from "./types";

const DEFAULT_FIELDS: EnvField[] = [
  {
    key: "BROWSERLESS_API_KEY",
    value: "",
    required: true,
    description: "Required for Browserless-backed automation features.",
  },
  {
    key: "BROWSERLESS_DEFAULT_REGION",
    value: "production-sfo",
    description: "Default Browserless region.",
  },
  {
    key: "BROWSERLESS_DEFAULT_TIMEOUT_MS",
    value: "30000",
    description: "Default Browserless timeout in milliseconds.",
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

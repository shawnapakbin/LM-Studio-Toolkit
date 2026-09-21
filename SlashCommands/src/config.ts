/**
 * Tool endpoint configuration for slash command dispatch
 */
import { type Config, getConfig } from "@shared/config";

export const ENDPOINTS = {
  calculator: getConfig().slashcommands.calculatorEndpoint,
  webbrowser: getConfig().slashcommands.webbrowserEndpoint,
  clock: getConfig().slashcommands.clockEndpoint,
  terminal: getConfig().slashcommands.terminalEndpoint,
  askuser: getConfig().slashcommands.askuserEndpoint,
  rag: getConfig().slashcommands.ragEndpoint,
  pythonshell: getConfig().slashcommands.pythonshellEndpoint,
  skills: getConfig().slashcommands.skillsEndpoint,
  ecm: getConfig().slashcommands.ecmEndpoint,
} as const;

export const DEFAULT_SESSION = getConfig().slashcommands.defaultSession;

/**
 * Discoverable server registry (source of truth for `tools_list` discovery).
 *
 * Unlike {@link ENDPOINTS} — which is the fixed routing table consumed by
 * `tools_health`, `tools_schema`, `config_show`, and every non-`tools`
 * command — this registry describes the full set of servers that `tools_list`
 * may discover. Each entry maps a server's identity to *where its real bound
 * port lives* (its config namespace); it does NOT itself hardcode any port.
 *
 * A server's reported endpoint is derived from its own config block via
 * {@link endpointForServer}, so `tools_list` never depends on the potentially
 * stale `slashcommands.*Endpoint` values.
 *
 * `namespace` is the `getConfig()` key holding the server's real `port`
 * (e.g. `terminal` -> `getConfig().terminal.port`). Some servers have no port
 * of their own (e.g. `memory`, which only has a `dbPath`); their real endpoint
 * cannot be derived from a port, and discovery (see `discovery.ts`) decides how
 * to include them. `distDir` is the directory name the server builds into under
 * `dist/` (e.g. `"Browserless"` -> key `browserless`).
 */
export interface ServerRegistryEntry {
  /** Stable, lowercase identifier for the server. */
  key: string;
  /** Human-readable display name (also the `dist/` directory name convention). */
  name: string;
  /** The `getConfig()` namespace holding this server's real bound `port`. */
  namespace: keyof Config;
  /** The directory name this server builds into under `dist/`. */
  distDir: string;
}

export const SERVER_REGISTRY: readonly ServerRegistryEntry[] = [
  { key: "calculator", name: "Calculator", namespace: "calculator", distDir: "Calculator" },
  { key: "webbrowser", name: "WebBrowser", namespace: "webbrowser", distDir: "WebBrowser" },
  { key: "clock", name: "Clock", namespace: "clock", distDir: "Clock" },
  { key: "terminal", name: "Terminal", namespace: "terminal", distDir: "Terminal" },
  { key: "askuser", name: "AskUser", namespace: "askuser", distDir: "AskUser" },
  { key: "rag", name: "RAG", namespace: "rag", distDir: "RAG" },
  { key: "pythonshell", name: "PythonShell", namespace: "pythonshell", distDir: "PythonShell" },
  { key: "skills", name: "Skills", namespace: "skills", distDir: "Skills" },
  // ECM has no config namespace of its own; its endpoint is resolved from the
  // slashcommands routing table (see endpointForServer's fallback). We point its
  // namespace at `slashcommands` so the entry stays typed to a real Config key.
  { key: "ecm", name: "ECM", namespace: "slashcommands", distDir: "ECM" },
  { key: "browserless", name: "Browserless", namespace: "browserless", distDir: "Browserless" },
  {
    key: "documentscraper",
    name: "DocumentScraper",
    namespace: "documentscraper",
    distDir: "DocumentScraper",
  },
  { key: "memory", name: "Memory", namespace: "memory", distDir: "Memory" },
  {
    key: "observability",
    name: "Observability",
    namespace: "observability",
    distDir: "Observability",
  },
  { key: "fileeditor", name: "FileEditor", namespace: "fileeditor", distDir: "FileEditor" },
  { key: "git", name: "Git", namespace: "git", distDir: "Git" },
  {
    key: "packagemanager",
    name: "PackageManager",
    namespace: "packagemanager",
    distDir: "PackageManager",
  },
  { key: "threedtool", name: "3DTool", namespace: "threedtool", distDir: "3DTool" },
  { key: "csvexporter", name: "CSVExporter", namespace: "csvexporter", distDir: "CSVExporter" },
] as const;

/**
 * Resolve a registry entry's real bound port from its own config block.
 *
 * Returns the numeric `port` declared on the server's config namespace, or
 * `undefined` when that namespace exposes no `port` (e.g. `memory`). Consumes
 * only the already-typed `getConfig()` result — it introduces no new schema.
 */
export function realBoundPort(entry: ServerRegistryEntry): number | undefined {
  const block = getConfig()[entry.namespace] as Record<string, unknown> | undefined;
  const port = block?.port;
  return typeof port === "number" ? port : undefined;
}

/**
 * Build the endpoint URL for a registry entry from its real bound port.
 *
 * The endpoint is `http://localhost:{realBoundPort}`, derived from the server's
 * own config block — never from `slashcommands.*Endpoint`. This is what allows
 * `tools_list` to report each server at its actual port (e.g. Terminal at
 * `3333`, not the stale `3330`).
 *
 * For servers without a port of their own (e.g. `ecm`, whose endpoint lives in
 * the slashcommands routing table), the entry's `slashcommands.*Endpoint` value
 * is used as a fallback when available; otherwise `undefined` is returned and
 * discovery decides how to handle the entry.
 */
export function endpointForServer(entry: ServerRegistryEntry): string | undefined {
  const port = realBoundPort(entry);
  if (port !== undefined) {
    return `http://localhost:${port}`;
  }
  // Fallback for servers with no port of their own but a known routing endpoint
  // (e.g. ECM -> slashcommands.ecmEndpoint).
  const slashEndpointKey = `${entry.key}Endpoint` as keyof Config["slashcommands"];
  const fallback = getConfig().slashcommands[slashEndpointKey];
  return typeof fallback === "string" ? fallback : undefined;
}

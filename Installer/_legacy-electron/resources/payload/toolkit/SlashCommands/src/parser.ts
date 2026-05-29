/**
 * Slash command parser
 *
 * Parses a raw "/command [args] [--flags]" string into a structured
 * dispatch descriptor that the router can execute.
 */

export type DispatchDescriptor =
  | { tool: "ecm"; action: string; params: Record<string, unknown> }
  | { tool: "calculator"; expression: string; precision?: number }
  | {
      tool: "webbrowser";
      url: string;
      outputFormat: string;
      screenshot: boolean;
      waitForSelector?: string;
    }
  | { tool: "clock"; timeZone?: string }
  | { tool: "terminal"; command: string; cwd?: string }
  | {
      tool: "pythonshell";
      action: "run_code" | "open_repl" | "open_idle";
      code?: string;
      cwd?: string;
      timeoutMs?: number;
    }
  | { tool: "skills"; action: string; params: Record<string, unknown> }
  | { tool: "rag"; action: string; params: Record<string, unknown> }
  | { tool: "askuser"; prompt: string; title?: string; expiresInSeconds?: number }
  | { tool: "tools_list" }
  | { tool: "tools_health"; toolName?: string }
  | { tool: "tools_schema"; toolName: string }
  | { tool: "memory_stats" }
  | { tool: "memory_history"; limit: number }
  | { tool: "memory_patterns" }
  | { tool: "config_show" }
  | { tool: "help" }
  | { tool: "unknown"; raw: string };

/**
 * Tokenize a command string respecting quoted strings.
 * e.g. `/calc "sin(30°)" --precision 4` → ["calc", "sin(30°)", "--precision", "4"]
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const re = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[0]);
  }
  return tokens;
}

/**
 * Extract --flag <value> pairs from a token list.
 * Returns { flags, positional }.
 */
function extractFlags(tokens: string[]): {
  flags: Record<string, string | true>;
  positional: string[];
} {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.startsWith("--")) {
      const key = t.slice(2);
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i += 1;
      }
    } else {
      positional.push(t);
      i += 1;
    }
  }
  return { flags, positional };
}

function flag(flags: Record<string, string | true>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(flags: Record<string, string | true>, key: string): boolean {
  return key in flags;
}

/**
 * Parse a raw slash command string into a DispatchDescriptor.
 * The leading "/" is optional — callers may strip it before passing.
 */
export function parseSlashCommand(raw: string): DispatchDescriptor {
  const trimmed = raw.trim().replace(/^\//, "");
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return { tool: "unknown", raw };

  const [cmd, sub, ...rest] = tokens;
  const { flags, positional } = extractFlags([sub, ...rest].filter(Boolean));

  switch (cmd.toLowerCase()) {
    // ── /compact ──────────────────────────────────────────────────────────
    case "compact": {
      const keepNewest = flag(flags, "keep-newest") ? Number(flag(flags, "keep-newest")) : 5;
      const sessionId = flag(flags, "session") ?? "default";
      return { tool: "ecm", action: "compact", params: { sessionId, keepNewest } };
    }

    // ── /ecm <action> ─────────────────────────────────────────────────────
    case "ecm": {
      const sessionId = flag(flags, "session") ?? "default";
      switch ((sub ?? "").toLowerCase()) {
        case "store":
          return {
            tool: "ecm",
            action: "store_segment",
            params: {
              sessionId,
              content: positional.join(" ") || flag(flags, "content") || "",
              type: flag(flags, "type") ?? "conversation_turn",
              importance: flag(flags, "importance") ? Number(flag(flags, "importance")) : undefined,
            },
          };
        case "retrieve":
          return {
            tool: "ecm",
            action: "retrieve_context",
            params: {
              sessionId,
              query: positional.join(" ") || flag(flags, "query") || "",
              topK: flag(flags, "top-k") ? Number(flag(flags, "top-k")) : undefined,
              maxTokens: flag(flags, "max-tokens") ? Number(flag(flags, "max-tokens")) : undefined,
              minScore: flag(flags, "min-score") ? Number(flag(flags, "min-score")) : undefined,
            },
          };
        case "list":
          return {
            tool: "ecm",
            action: "list_segments",
            params: {
              sessionId,
              limit: flag(flags, "limit") ? Number(flag(flags, "limit")) : undefined,
              offset: flag(flags, "offset") ? Number(flag(flags, "offset")) : undefined,
            },
          };
        case "delete":
          return {
            tool: "ecm",
            action: "delete_segment",
            params: { sessionId, segmentId: positional[0] ?? flag(flags, "id") ?? "" },
          };
        case "summarize":
          return {
            tool: "ecm",
            action: "summarize_session",
            params: {
              sessionId,
              keepNewest: flag(flags, "keep-newest")
                ? Number(flag(flags, "keep-newest"))
                : undefined,
            },
          };
        case "clear":
          return { tool: "ecm", action: "clear_session", params: { sessionId } };
        case "compact":
          return {
            tool: "ecm",
            action: "compact",
            params: {
              sessionId,
              keepNewest: flag(flags, "keep-newest") ? Number(flag(flags, "keep-newest")) : 5,
            },
          };
        case "continuous": {
          const mode = (rest[0] ?? flag(flags, "mode") ?? "").toLowerCase();
          if (["on", "enable", "enabled", "true", "1"].includes(mode)) {
            return {
              tool: "ecm",
              action: "set_continuous_compact",
              params: {
                sessionId,
                enabled: true,
                keepNewest: flag(flags, "keep-newest")
                  ? Number(flag(flags, "keep-newest"))
                  : undefined,
              },
            };
          }
          if (["off", "disable", "disabled", "false", "0"].includes(mode)) {
            return {
              tool: "ecm",
              action: "set_continuous_compact",
              params: {
                sessionId,
                enabled: false,
              },
            };
          }
          return { tool: "unknown", raw };
        }
        case "policy":
          return {
            tool: "ecm",
            action: "get_session_policy",
            params: { sessionId },
          };
        default:
          return { tool: "unknown", raw };
      }
    }

    // ── /calc <expression> ────────────────────────────────────────────────
    case "calc":
    case "calculate": {
      const expression = [sub, ...rest.filter((t) => !t.startsWith("--"))]
        .filter(Boolean)
        .join(" ");
      const precision = flag(flags, "precision") ? Number(flag(flags, "precision")) : undefined;
      return { tool: "calculator", expression, precision };
    }

    // ── /browse <url> ─────────────────────────────────────────────────────
    case "browse": {
      const url = sub ?? "";
      return {
        tool: "webbrowser",
        url,
        outputFormat: flag(flags, "format") ?? "markdown",
        screenshot: flagBool(flags, "screenshot"),
        waitForSelector: flag(flags, "wait-selector"),
      };
    }

    // ── /clock ────────────────────────────────────────────────────────────
    case "clock":
    case "time":
    case "date": {
      return { tool: "clock", timeZone: flag(flags, "timezone") ?? sub };
    }

    // ── /run <command> ────────────────────────────────────────────────────
    case "run":
    case "terminal":
    case "exec": {
      const command = [sub, ...positional].filter(Boolean).join(" ");
      return { tool: "terminal", command, cwd: flag(flags, "cwd") };
    }

    // ── /python <run|repl|idle> ──────────────────────────────────────────
    case "python":
    case "py": {
      const action = (sub ?? "").toLowerCase();
      if (action === "run") {
        return {
          tool: "pythonshell",
          action: "run_code",
          code: positional.slice(1).join(" "),
          cwd: flag(flags, "cwd"),
          timeoutMs: flag(flags, "timeout") ? Number(flag(flags, "timeout")) : undefined,
        };
      }
      if (action === "repl") {
        return {
          tool: "pythonshell",
          action: "open_repl",
          cwd: flag(flags, "cwd"),
        };
      }
      if (action === "idle") {
        return {
          tool: "pythonshell",
          action: "open_idle",
          cwd: flag(flags, "cwd"),
        };
      }
      return { tool: "unknown", raw };
    }

    // ── /skills <action> ──────────────────────────────────────────────────
    case "skills": {
      const action = (sub ?? "").toLowerCase();
      switch (action) {
        case "list":
          return { tool: "skills", action: "list_skills", params: {} };
        case "get":
          return { tool: "skills", action: "get_skill", params: { name: positional[0] } };
        case "run":
        case "execute": {
          let params: Record<string, unknown> = {};
          const paramsFlag = flag(flags, "params");
          if (paramsFlag) {
            try {
              params = JSON.parse(paramsFlag);
            } catch {
              /* ignore */
            }
          }
          return {
            tool: "skills",
            action: "execute_skill",
            params: { name: positional[0], params },
          };
        }
        case "delete":
          return { tool: "skills", action: "delete_skill", params: { name: positional[0] } };
        default:
          return { tool: "unknown", raw };
      }
    }

    // ── /rag <action> ─────────────────────────────────────────────────────
    case "rag": {
      const action = (sub ?? "").toLowerCase();
      switch (action) {
        case "query":
          return {
            tool: "rag",
            action: "query",
            params: {
              query: positional.join(" "),
              topK: flag(flags, "top-k") ? Number(flag(flags, "top-k")) : undefined,
            },
          };
        case "ingest":
          return {
            tool: "rag",
            action: "ingest",
            params: { content: positional.join(" "), source: flag(flags, "source") },
          };
        case "list":
          return { tool: "rag", action: "list_sources", params: {} };
        case "delete":
          return { tool: "rag", action: "delete_source", params: { sourceId: positional[0] } };
        default:
          return { tool: "unknown", raw };
      }
    }

    // ── /ask <prompt> ─────────────────────────────────────────────────────
    case "ask": {
      const prompt = [sub, ...positional].filter(Boolean).join(" ");
      return {
        tool: "askuser",
        prompt,
        title: flag(flags, "title"),
        expiresInSeconds: flag(flags, "expires") ? Number(flag(flags, "expires")) : undefined,
      };
    }

    // ── /tools <sub> ──────────────────────────────────────────────────────
    case "tools": {
      switch ((sub ?? "").toLowerCase()) {
        case "list":
        case "":
          return { tool: "tools_list" };
        case "health":
          return { tool: "tools_health", toolName: positional[0] };
        case "schema":
          return { tool: "tools_schema", toolName: positional[0] ?? "" };
        default:
          return { tool: "tools_list" };
      }
    }

    // ── /memory <sub> ─────────────────────────────────────────────────────
    case "memory": {
      switch ((sub ?? "").toLowerCase()) {
        case "stats":
          return { tool: "memory_stats" };
        case "history":
          return {
            tool: "memory_history",
            limit: flag(flags, "limit") ? Number(flag(flags, "limit")) : 20,
          };
        case "patterns":
          return { tool: "memory_patterns" };
        default:
          return { tool: "memory_stats" };
      }
    }

    // ── /config show ──────────────────────────────────────────────────────
    case "config": {
      if ((sub ?? "").toLowerCase() === "show") {
        return { tool: "config_show" };
      }
      return { tool: "unknown", raw };
    }

    // ── /help ─────────────────────────────────────────────────────────────
    case "help":
      return { tool: "help" };

    default:
      return { tool: "unknown", raw };
  }
}

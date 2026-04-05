/**
 * Router — takes a DispatchDescriptor and executes the appropriate tool call
 */

import path from "path";
import Database from "better-sqlite3";
import { DEFAULT_SESSION, ENDPOINTS } from "./config";
import { get, post } from "./dispatch";
import type { DispatchDescriptor } from "./parser";

const TOOL_NAMES: Record<string, string> = {
  calculator: "Calculator",
  webbrowser: "WebBrowser",
  clock: "Clock",
  terminal: "Terminal",
  askuser: "AskUser",
  rag: "RAG",
  skills: "Skills",
  ecm: "ECM",
};

const HELP_TEXT = `Available slash commands:

  /help                                  Show this help message

  Context Memory (ECM)
  /compact [--session <id>] [--keep-newest <n>]
  /ecm store <text> [--session <id>] [--type <type>] [--importance <0-1>]
  /ecm retrieve <query> [--session <id>] [--top-k <n>]
  /ecm list [--session <id>]
  /ecm summarize [--session <id>] [--keep-newest <n>]
  /ecm clear [--session <id>]

  Calculator
  /calc <expression> [--precision <n>]

  Web Browser
  /browse <url> [--format text|markdown] [--screenshot] [--wait-selector <css>]

  Clock
  /clock [--timezone <iana-tz>]

  Terminal
  /run <command> [--cwd <dir>]

  Skills
  /skills list
  /skills get <name>
  /skills run <name> [--params <json>]
  /skills delete <name>

  RAG (Knowledge Base)
  /rag query <text> [--top-k <n>]
  /rag ingest <text> [--source <label>]
  /rag list
  /rag delete <sourceId>

  AskUser
  /ask <prompt> [--title <title>] [--expires <seconds>]

  Tools
  /tools list
  /tools health [<tool-name>]
  /tools schema <tool-name>

  Memory (Workflow History)
  /memory stats
  /memory history [--limit <n>]
  /memory patterns

  Config
  /config show`.trim();

export async function route(desc: DispatchDescriptor): Promise<unknown> {
  switch (desc.tool) {
    // ── ECM ───────────────────────────────────────────────────────────────
    case "ecm": {
      if (desc.action === "compact") {
        // Two-step: summarize then report remaining count
        const { sessionId = DEFAULT_SESSION, keepNewest = 5 } = desc.params;
        const summary = await post(`${ENDPOINTS.ecm}/tools/ecm`, {
          action: "summarize_session",
          sessionId,
          keepNewest,
        });
        const list = (await post(`${ENDPOINTS.ecm}/tools/ecm`, {
          action: "list_segments",
          sessionId,
          limit: 1,
        })) as Record<string, unknown>;
        const data = list.data as Record<string, unknown> | undefined;
        return {
          success: true,
          action: "compact",
          sessionId,
          keepNewest,
          summary,
          segmentsRemaining: data?.total ?? "unknown",
          message: `Context compacted. Session "${sessionId}" summarized, ${data?.total ?? "?"} segments remaining.`,
        };
      }
      return post(`${ENDPOINTS.ecm}/tools/ecm`, {
        action: desc.action,
        ...desc.params,
      });
    }

    // ── Calculator ────────────────────────────────────────────────────────
    case "calculator":
      return post(`${ENDPOINTS.calculator}/tools/calculate_engineering`, {
        expression: desc.expression,
        ...(desc.precision !== undefined && { precision: desc.precision }),
      });

    // ── WebBrowser ────────────────────────────────────────────────────────
    case "webbrowser":
      return post(`${ENDPOINTS.webbrowser}/tools/browse_web`, {
        url: desc.url,
        outputFormat: desc.outputFormat,
        screenshot: desc.screenshot,
        ...(desc.waitForSelector && { waitForSelector: desc.waitForSelector }),
      });

    // ── Clock ─────────────────────────────────────────────────────────────
    case "clock":
      return post(`${ENDPOINTS.clock}/tools/get_current_datetime`, {
        ...(desc.timeZone && { timeZone: desc.timeZone }),
      });

    // ── Terminal ──────────────────────────────────────────────────────────
    case "terminal":
      return post(`${ENDPOINTS.terminal}/tools/run_terminal_command`, {
        command: desc.command,
        ...(desc.cwd && { cwd: desc.cwd }),
      });

    // ── Skills ────────────────────────────────────────────────────────────
    case "skills":
      return post(`${ENDPOINTS.skills}/tools/skills`, {
        action: desc.action,
        ...desc.params,
      });

    // ── RAG ───────────────────────────────────────────────────────────────
    case "rag":
      return post(`${ENDPOINTS.rag}/tools/rag`, {
        action: desc.action,
        ...desc.params,
      });

    // ── AskUser ───────────────────────────────────────────────────────────
    case "askuser":
      return post(`${ENDPOINTS.askuser}/tools/ask_user`, {
        action: "create_interview",
        prompt: desc.prompt,
        ...(desc.title && { title: desc.title }),
        ...(desc.expiresInSeconds !== undefined && { expiresInSeconds: desc.expiresInSeconds }),
      });

    // ── Tools list ────────────────────────────────────────────────────────
    case "tools_list":
      return {
        success: true,
        tools: Object.entries(ENDPOINTS).map(([name, endpoint]) => ({
          name: TOOL_NAMES[name] ?? name,
          endpoint,
        })),
      };

    // ── Tools health ──────────────────────────────────────────────────────
    case "tools_health": {
      const targets = desc.toolName
        ? { [desc.toolName]: ENDPOINTS[desc.toolName as keyof typeof ENDPOINTS] }
        : ENDPOINTS;
      const results: Record<string, string> = {};
      for (const [name, endpoint] of Object.entries(targets)) {
        if (!endpoint) {
          results[name] = "unknown tool";
          continue;
        }
        try {
          const r = (await get(`${endpoint}/health`)) as Record<string, unknown>;
          results[name] = r.ok ? "healthy" : "unhealthy";
        } catch {
          results[name] = "unreachable";
        }
      }
      return { success: true, health: results };
    }

    // ── Tools schema ──────────────────────────────────────────────────────
    case "tools_schema": {
      const endpoint = ENDPOINTS[desc.toolName as keyof typeof ENDPOINTS];
      if (!endpoint) return { success: false, error: `Unknown tool: ${desc.toolName}` };
      return get(`${endpoint}/tool-schema`);
    }

    // ── Memory stats ──────────────────────────────────────────────────────
    case "memory_stats": {
      return queryMemory((db) =>
        db
          .prepare(
            `SELECT COUNT(*) AS total, SUM(success) AS successes,
             ROUND(AVG(duration_ms),1) AS avg_ms,
             MIN(duration_ms) AS min_ms, MAX(duration_ms) AS max_ms
             FROM runs`,
          )
          .get(),
      );
    }

    // ── Memory history ────────────────────────────────────────────────────
    case "memory_history": {
      return queryMemory((db) =>
        db
          .prepare(
            `SELECT id, workflow_name, success, duration_ms, started_at, error
             FROM runs ORDER BY id DESC LIMIT ?`,
          )
          .all(desc.limit),
      );
    }

    // ── Memory patterns ───────────────────────────────────────────────────
    case "memory_patterns": {
      return queryMemory((db) =>
        db
          .prepare(
            `SELECT r.workflow_name, GROUP_CONCAT(s.tool_id, ' → ') AS tool_sequence, COUNT(*) AS uses
             FROM runs r JOIN steps s ON s.run_id = r.id
             WHERE r.success = 1
             GROUP BY r.workflow_name ORDER BY uses DESC`,
          )
          .all(),
      );
    }

    // ── Config show ───────────────────────────────────────────────────────
    case "config_show": {
      const tools = Object.entries(ENDPOINTS).map(([name, endpoint]) => ({
        name: TOOL_NAMES[name] ?? name,
        key: name,
        endpoint,
      }));
      return {
        success: true,
        config: {
          tools,
        },
      };
    }

    // ── Help ──────────────────────────────────────────────────────────────
    case "help":
      return {
        success: true,
        help: HELP_TEXT,
      };

    // ── Unknown ───────────────────────────────────────────────────────────
    case "unknown":
      return {
        success: false,
        error: `Unknown slash command: "${desc.raw}". Type /help to see all available commands.`,
        availableCommands: [
          "/help",
          "/compact",
          "/ecm store|retrieve|list|delete|summarize|clear",
          "/calc <expr>",
          "/browse <url>",
          "/clock",
          "/run <cmd>",
          "/skills list|get|run|delete",
          "/rag query|ingest|list|delete",
          "/ask <prompt>",
          "/tools list|health|schema",
          "/memory stats|history|patterns",
          "/config show",
        ],
      };
  }
}

function queryMemory(fn: (db: Database.Database) => unknown): unknown {
  const dbPath = process.env.MEMORY_DB_PATH ?? path.join(process.cwd(), "data", "agent-memory.db");
  try {
    const db = new Database(dbPath, { readonly: true });
    const result = fn(db);
    db.close();
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * memory — inspect AgentRunner workflow history stored in SQLite
 */

import path from "path";
import Database from "better-sqlite3";
import type { Command } from "commander";

function openDb(dbPath?: string): Database.Database {
  const resolved = dbPath || path.join(process.cwd(), "data", "agent-memory.db");
  return new Database(resolved, { readonly: true });
}

export function registerMemoryCommands(program: Command): void {
  const mem = program.command("memory").description("Inspect AgentRunner workflow run history");

  mem
    .command("stats")
    .description("Show run success rates and average durations")
    .option("--db <path>", "Path to agent-memory.db")
    .action((opts: { db?: string }) => {
      try {
        const db = openDb(opts.db);
        const row = db
          .prepare(
            `SELECT
              COUNT(*) AS total,
              SUM(success) AS successes,
              ROUND(AVG(duration_ms), 1) AS avg_ms,
              MIN(duration_ms) AS min_ms,
              MAX(duration_ms) AS max_ms
            FROM runs`,
          )
          .get() as Record<string, unknown>;
        console.log(JSON.stringify(row, null, 2));
        db.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });

  mem
    .command("history")
    .description("List recent workflow runs")
    .option("-n, --limit <n>", "Number of runs to show", "20")
    .option("--db <path>", "Path to agent-memory.db")
    .action((opts: { limit: string; db?: string }) => {
      try {
        const db = openDb(opts.db);
        const rows = db
          .prepare(
            `SELECT id, workflow_name, success, duration_ms, started_at, error
             FROM runs ORDER BY id DESC LIMIT ?`,
          )
          .all(parseInt(opts.limit, 10));
        console.log(JSON.stringify(rows, null, 2));
        db.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });

  mem
    .command("patterns")
    .description("List successful tool sequences learned from run history")
    .option("--db <path>", "Path to agent-memory.db")
    .action((opts: { db?: string }) => {
      try {
        const db = openDb(opts.db);
        const rows = db
          .prepare(
            `SELECT r.workflow_name, GROUP_CONCAT(s.tool_id, ' → ') AS tool_sequence, COUNT(*) AS uses
             FROM runs r
             JOIN steps s ON s.run_id = r.id
             WHERE r.success = 1
             GROUP BY r.workflow_name
             ORDER BY uses DESC`,
          )
          .all();
        console.log(JSON.stringify(rows, null, 2));
        db.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });

  mem
    .command("clear")
    .description("Wipe all workflow run history (irreversible)")
    .option("--db <path>", "Path to agent-memory.db")
    .option("--confirm", "Skip confirmation prompt")
    .action(async (opts: { db?: string; confirm?: boolean }) => {
      if (!opts.confirm) {
        const { createInterface } = await import("readline");
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        await new Promise<void>((resolve) => {
          rl.question("This will delete all run history. Type YES to confirm: ", (ans) => {
            rl.close();
            if (ans.trim() !== "YES") {
              console.log("Aborted.");
              process.exit(0);
            }
            resolve();
          });
        });
      }
      try {
        const resolved = opts.db || path.join(process.cwd(), "data", "agent-memory.db");
        const db = new Database(resolved);
        db.exec("DELETE FROM steps; DELETE FROM runs;");
        db.close();
        console.log("Run history cleared.");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });
}

import path from "node:path";
import Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import type { SkillRecord, SkillSummary, SkillUpsertInput } from "./types";

const _rawDbPath = process.env.SKILLS_DB_PATH ?? "./skills.db";
export const DB_PATH =
  _rawDbPath === ":memory:" || path.isAbsolute(_rawDbPath)
    ? _rawDbPath
    : path.resolve(__dirname, _rawDbPath);

function initSchema(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL UNIQUE,
      description      TEXT NOT NULL,
      param_schema_json TEXT NOT NULL,
      steps_json       TEXT NOT NULL,
      version          INTEGER NOT NULL DEFAULT 1,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
  `);
}

export class SkillsStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    initSchema(this.db);
  }

  upsertSkill(input: SkillUpsertInput): SkillRecord {
    const now = new Date().toISOString();
    const paramSchemaJson = JSON.stringify(input.paramSchema);
    const stepsJson = JSON.stringify(input.steps);

    const existing = this.getSkillByName(input.name);

    if (!existing) {
      const id = uuid();
      const insert = this.db.prepare(`
        INSERT INTO skills (id, name, description, param_schema_json, steps_json, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `);
      insert.run(id, input.name, input.description, paramSchemaJson, stepsJson, now, now);

      const created = this.getSkillById(id);
      if (!created) throw new Error("Failed to create skill record.");
      return created;
    }

    const update = this.db.prepare(`
      UPDATE skills
      SET description = ?, param_schema_json = ?, steps_json = ?, version = version + 1, updated_at = ?
      WHERE name = ?
    `);
    update.run(input.description, paramSchemaJson, stepsJson, now, input.name);

    const updated = this.getSkillById(existing.id);
    if (!updated) throw new Error("Failed to update skill record.");
    return updated;
  }

  getSkillById(id: string): SkillRecord | undefined {
    const stmt = this.db.prepare("SELECT * FROM skills WHERE id = ?");
    return stmt.get(id) as SkillRecord | undefined;
  }

  getSkillByName(name: string): SkillRecord | undefined {
    const stmt = this.db.prepare("SELECT * FROM skills WHERE name = ?");
    return stmt.get(name) as SkillRecord | undefined;
  }

  listSkills(limit: number, offset: number): SkillSummary[] {
    const stmt = this.db.prepare(
      "SELECT id, name, description, steps_json, version, updated_at FROM skills ORDER BY updated_at DESC LIMIT ? OFFSET ?",
    );
    const rows = stmt.all(limit, offset) as Array<{
      id: string;
      name: string;
      description: string;
      steps_json: string;
      version: number;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      stepCount: (JSON.parse(row.steps_json) as unknown[]).length,
      version: row.version,
      updatedAt: row.updated_at,
    }));
  }

  deleteSkill(identifier: string): { deleted: boolean } {
    // Try by id first, then by name
    let stmt = this.db.prepare("DELETE FROM skills WHERE id = ?");
    let result = stmt.run(identifier);

    if (result.changes === 0) {
      stmt = this.db.prepare("DELETE FROM skills WHERE name = ?");
      result = stmt.run(identifier);
    }

    return { deleted: result.changes > 0 };
  }

  close(): void {
    this.db.close();
  }
}

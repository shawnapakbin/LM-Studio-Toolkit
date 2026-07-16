import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DefineSkillInput, ParamSchema, Step } from "./types";

/**
 * Resolves the base skills directory.
 * Uses SKILLS_DIR env var if set, otherwise defaults to:
 * - Windows: %APPDATA%/llm-toolkit/skills
 * - macOS: ~/Library/Application Support/llm-toolkit/skills
 * - Linux: ~/.config/llm-toolkit/skills
 */
export function getSkillsBaseDir(): string {
  if (process.env.SKILLS_DIR) {
    return process.env.SKILLS_DIR;
  }

  const platform = process.platform;
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "llm-toolkit", "skills");
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "llm-toolkit", "skills");
  }
  // Linux / other
  const configDir = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(configDir, "llm-toolkit", "skills");
}

export function getPreloadedSkillsDir(): string {
  return path.join(getSkillsBaseDir(), "preloaded");
}

export function getUserSkillsDir(): string {
  return path.join(getSkillsBaseDir(), "user");
}

/**
 * Ensures both skill directories exist.
 */
export function ensureSkillDirectories(): { preloaded: string; user: string } {
  const preloaded = getPreloadedSkillsDir();
  const user = getUserSkillsDir();
  fs.mkdirSync(preloaded, { recursive: true });
  fs.mkdirSync(user, { recursive: true });
  return { preloaded, user };
}

/**
 * Parses a preloaded skill JSON file into a DefineSkillInput.
 */
function parsePreloadedSkill(filePath: string): DefineSkillInput | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(content);
    if (!data.name || !data.description || !data.paramSchema || !data.steps) {
      return null;
    }
    return data as DefineSkillInput;
  } catch {
    return null;
  }
}

/**
 * Parses a user skill markdown file into a DefineSkillInput.
 *
 * Expected markdown format:
 * ---
 * name: skill-name
 * description: Skill description
 * ---
 * ## Parameters
 * - param_name (type, required): description
 *
 * ## Steps
 * 1. [prompt] Template text with {{param_name}}
 * 2. [tool_call:tool_name] {"arg": "{{param_name}}"}
 */
function parseUserSkillMarkdown(filePath: string): DefineSkillInput | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    // Parse frontmatter
    if (lines[0]?.trim() !== "---") return null;
    const frontmatterEnd = lines.indexOf("---", 1);
    if (frontmatterEnd === -1) return null;

    const frontmatter: Record<string, string> = {};
    for (let i = 1; i < frontmatterEnd; i++) {
      const line = lines[i];
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      frontmatter[key] = value;
    }

    if (!frontmatter.name || !frontmatter.description) return null;

    const body = lines.slice(frontmatterEnd + 1).join("\n");

    // Parse parameters section
    const paramSchema: ParamSchema = { type: "object", properties: {}, required: [] };
    const paramMatch = body.match(/## Parameters\n([\s\S]*?)(?=\n## |\n*$)/);
    if (paramMatch) {
      const paramLines = paramMatch[1].split("\n").filter((l) => l.trim().startsWith("-"));
      for (const pLine of paramLines) {
        const pMatch = pLine.match(/^-\s+(\w+)\s*\((\w+)(?:,\s*(required))?\):\s*(.+)/);
        if (pMatch) {
          const [, paramName, paramType, isRequired, desc] = pMatch;
          paramSchema.properties[paramName] = { type: paramType, description: desc };
          if (isRequired) {
            paramSchema.required!.push(paramName);
          }
        }
      }
    }

    // Parse steps section
    const steps: Step[] = [];
    const stepsMatch = body.match(/## Steps\n([\s\S]*?)(?=\n## |\n*$)/);
    if (stepsMatch) {
      const stepLines = stepsMatch[1].split("\n").filter((l) => /^\d+\.\s+/.test(l.trim()));
      for (const sLine of stepLines) {
        const promptMatch = sLine.match(/^\d+\.\s+\[prompt\]\s*(.+)/);
        if (promptMatch) {
          steps.push({ type: "prompt", template: promptMatch[1] });
          continue;
        }
        const toolMatch = sLine.match(/^\d+\.\s+\[tool_call:(\w+)\]\s*(.+)/);
        if (toolMatch) {
          const [, tool, argsStr] = toolMatch;
          try {
            const args = JSON.parse(argsStr) as Record<string, string>;
            steps.push({ type: "tool_call", tool, args });
          } catch {
            steps.push({ type: "tool_call", tool, args: {} });
          }
        }
      }
    }

    return {
      name: frontmatter.name,
      description: frontmatter.description,
      paramSchema,
      steps,
    };
  } catch {
    return null;
  }
}

/**
 * Loads all preloaded skills from JSON files.
 */
export function loadPreloadedSkills(): DefineSkillInput[] {
  const dir = getPreloadedSkillsDir();
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const skills: DefineSkillInput[] = [];

  for (const file of files) {
    const skill = parsePreloadedSkill(path.join(dir, file));
    if (skill) skills.push(skill);
  }

  return skills;
}

/**
 * Loads all user skills from markdown files.
 */
export function loadUserSkills(): DefineSkillInput[] {
  const dir = getUserSkillsDir();
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  const skills: DefineSkillInput[] = [];

  for (const file of files) {
    const skill = parseUserSkillMarkdown(path.join(dir, file));
    if (skill) skills.push(skill);
  }

  return skills;
}

/**
 * Loads all skills from both directories.
 */
export function loadAllFileSkills(): DefineSkillInput[] {
  return [...loadPreloadedSkills(), ...loadUserSkills()];
}

/**
 * Returns the permissions config for the user skills directory.
 * Used by access control layers to auto-approve file operations in this path.
 */
export function getUserSkillsPermissions(): {
  directory: string;
  autoApprove: string[];
} {
  return {
    directory: getUserSkillsDir(),
    autoApprove: ["create", "write", "edit", "read"],
  };
}

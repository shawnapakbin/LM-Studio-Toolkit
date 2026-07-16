/**
 * Copies preloaded skill JSON files from the project's preloaded/ directory
 * to the user's appdata skills directory.
 *
 * Run during build or install: node scripts/seed-skills.js
 *
 * Paths:
 * - Windows: %APPDATA%/llm-toolkit/skills/preloaded/
 * - macOS:   ~/Library/Application Support/llm-toolkit/skills/preloaded/
 * - Linux:   ~/.config/llm-toolkit/skills/preloaded/
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

function getSkillsBaseDir() {
  if (process.env.SKILLS_DIR) {
    return process.env.SKILLS_DIR;
  }

  const platform = process.platform;
  if (platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "llm-toolkit", "skills");
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "llm-toolkit", "skills");
  }
  const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configDir, "llm-toolkit", "skills");
}

const sourceDir = path.resolve(__dirname, "..", "preloaded");
const targetPreloaded = path.join(getSkillsBaseDir(), "preloaded");
const targetUser = path.join(getSkillsBaseDir(), "user");

// Ensure directories exist
fs.mkdirSync(targetPreloaded, { recursive: true });
fs.mkdirSync(targetUser, { recursive: true });

// Copy all JSON files from source to target preloaded directory
if (fs.existsSync(sourceDir)) {
  const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".json"));
  let copied = 0;
  let skipped = 0;

  for (const file of files) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetPreloaded, file);

    // Always overwrite preloaded skills (they're managed by the toolkit)
    fs.copyFileSync(sourcePath, targetPath);
    copied++;
  }

  console.log(`Skills seed: ${copied} preloaded skills copied, ${skipped} skipped.`);
  console.log(`  Preloaded: ${targetPreloaded}`);
  console.log(`  User:      ${targetUser}`);
} else {
  console.log("Skills seed: No preloaded/ directory found. Skipping.");
}

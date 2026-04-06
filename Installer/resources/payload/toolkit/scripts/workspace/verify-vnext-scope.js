#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const manifestPath = "docs/VNEXT_FEATURES.md";

function runGit(args, allowFailure = false) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (allowFailure) {
      return null;
    }
    const stderr = error && typeof error.stderr === "string" ? error.stderr.trim() : "";
    const detail = stderr ? `\n${stderr}` : "";
    console.error(`Failed to run git ${args.join(" ")}.${detail}`);
    process.exit(1);
  }
}

function resolveBaseAndHead() {
  const [, , cliBase, cliHead] = process.argv;
  const envBase = process.env.GITHUB_BASE_SHA || process.env.VNEXT_SCOPE_BASE;
  const envHead = process.env.GITHUB_SHA || process.env.VNEXT_SCOPE_HEAD;
  const head = cliHead || envHead || "HEAD";

  if (cliBase || envBase) {
    return { base: cliBase || envBase, head };
  }

  return null;
}

function getChangedFiles(base, head) {
  const output = runGit(["diff", "--name-only", `${base}...${head}`], true);
  if (!output) {
    return [];
  }
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function getAddedFiles(base, head) {
  const output = runGit(["diff", "--name-status", "--diff-filter=A", `${base}...${head}`], true);
  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      return parts.length >= 2 ? parts[1].trim() : "";
    })
    .filter(Boolean);
}

function hasToolLikeShape(dirName) {
  const absolute = path.join(repoRoot, dirName);
  return (
    fs.existsSync(absolute) &&
    fs.statSync(absolute).isDirectory() &&
    fs.existsSync(path.join(absolute, "package.json")) &&
    fs.existsSync(path.join(absolute, "src"))
  );
}

function existsAtBase(base, topLevelDir) {
  const result = runGit(["cat-file", "-e", `${base}:${topLevelDir}`], true);
  return result !== null;
}

const range = resolveBaseAndHead();
if (!range) {
  console.log("! Skipping vNext scope guard (no explicit base ref provided).");
  process.exit(0);
}

const changedFiles = getChangedFiles(range.base, range.head);
const addedFiles = getAddedFiles(range.base, range.head);
const manifestUpdated = changedFiles.includes(manifestPath);

const candidateDirs = new Set();
for (const filePath of addedFiles) {
  if (!filePath.includes("/")) {
    continue;
  }
  const topLevelDir = filePath.split("/")[0];
  if (!topLevelDir || topLevelDir.startsWith(".")) {
    continue;
  }
  if (!hasToolLikeShape(topLevelDir)) {
    continue;
  }
  if (!existsAtBase(range.base, topLevelDir)) {
    candidateDirs.add(topLevelDir);
  }
}

if (candidateDirs.size === 0) {
  console.log("✓ vNext scope guard passed (no new tool directories introduced).");
  process.exit(0);
}

if (!manifestUpdated) {
  const list = Array.from(candidateDirs)
    .sort()
    .map((item) => `  - ${item}`)
    .join("\n");

  console.error("✗ vNext scope guard failed.");
  console.error(
    "New top-level tool directories were introduced without updating docs/VNEXT_FEATURES.md:",
  );
  console.error(list);
  console.error(
    "\nUpdate docs/VNEXT_FEATURES.md in the same PR to mark intentional release scope.",
  );
  process.exit(1);
}

console.log("✓ vNext scope guard passed (manifest updated for new tool directories).");

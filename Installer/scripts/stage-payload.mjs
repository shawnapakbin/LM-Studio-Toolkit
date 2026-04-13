import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const installerRoot = join(__dirname, "..");
const repoRoot = join(installerRoot, "..");
const payloadRoot = join(installerRoot, "resources", "payload");
const toolkitRoot = join(payloadRoot, "toolkit");

const PAYLOAD_ITEMS = [
  "shared",
  "Terminal",
  "WebBrowser",
  "Calculator",
  "DocumentScraper",
  "Clock",
  "Browserless",
  "AskUser",
  "RAG",
  "PythonShell",
  "Memory",
  "Observability",
  "Skills",
  "ECM",
  "SlashCommands",
  "scripts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "README.md",
  "INSTALL.md",
  ".env.example",
];

const EXCLUDED_PATH_PARTS = new Set([
  ".git",
  "node_modules",
  "dist",
  "release",
  "coverage",
  "out",
  ".vs",
  ".vscode",
  ".kiro",
]);

function log(message) {
  console.log(`[stage-payload] ${message}`);
}

function resetPayloadDir() {
  rmSync(toolkitRoot, { recursive: true, force: true });
  mkdirSync(toolkitRoot, { recursive: true });
}

function shouldIncludePath(sourcePath) {
  const normalized = sourcePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return !parts.some((part) => EXCLUDED_PATH_PARTS.has(part));
}

function stageCuratedPayload() {
  let copiedCount = 0;

  for (const item of PAYLOAD_ITEMS) {
    const sourcePath = join(repoRoot, item);
    if (!existsSync(sourcePath)) {
      continue;
    }

    const targetPath = join(toolkitRoot, item);
    cpSync(sourcePath, targetPath, {
      recursive: true,
      force: true,
      filter: shouldIncludePath,
    });
    copiedCount += 1;
  }

  log(`Staged curated payload items: ${copiedCount}.`);
}

function filterPackageJsonWorkspaces() {
  const packageJsonPath = join(toolkitRoot, "package.json");
  const content = readFileSync(packageJsonPath, "utf8");
  const pkg = JSON.parse(content);

  if (pkg.workspaces && Array.isArray(pkg.workspaces)) {
    const workspaceRoots = new Set(
      PAYLOAD_ITEMS.filter((item) => existsSync(join(toolkitRoot, item))),
    );
    const filteredWorkspaces = pkg.workspaces.filter((ws) => {
      const wsName = typeof ws === "string" ? ws : ws.replace(/\/\*$/, "");
      return workspaceRoots.has(wsName);
    });

    if (filteredWorkspaces.length !== pkg.workspaces.length) {
      pkg.workspaces = filteredWorkspaces;
      writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
      log(
        `Filtered workspaces to ${filteredWorkspaces.length} items (removed non-existent references).`,
      );
    }
  }
}

function writeManifest() {
  const manifest = {
    source: "llm-toolkit workspace",
    mode: "directory",
  };

  writeFileSync(
    join(payloadRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

function main() {
  log("Preparing toolkit payload resources...");
  resetPayloadDir();

  stageCuratedPayload();
  filterPackageJsonWorkspaces();

  writeManifest();
  log("Payload staging complete.");
}

main();

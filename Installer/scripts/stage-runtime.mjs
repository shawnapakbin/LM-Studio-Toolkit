import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const installerRoot = join(__dirname, "..");
const runtimeRoot = join(installerRoot, "resources", "runtime");

function log(message) {
  console.log(`[stage-runtime] ${message}`);
}

function run(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
  });
}

function resolveNodePath() {
  const override = process.env.INSTALLER_NODE_BINARY;
  if (override && existsSync(override)) {
    return override;
  }

  return process.execPath;
}

function resolveNpmCliPath() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && existsSync(npmExecPath) && npmExecPath.endsWith("npm-cli.js")) {
    return npmExecPath;
  }

  const candidates = [];

  const prefixResult = run("npm", ["config", "get", "prefix"]);
  const prefix = (prefixResult.stdout || "").trim();
  if (prefix) {
    candidates.push(join(prefix, "node_modules", "npm", "bin", "npm-cli.js"));
    candidates.push(join(prefix, "lib", "node_modules", "npm", "bin", "npm-cli.js"));
  }

  const globalRootResult = run("npm", ["root", "-g"]);
  const globalRoot = (globalRootResult.stdout || "").trim();
  if (globalRoot) {
    candidates.push(join(globalRoot, "npm", "bin", "npm-cli.js"));
  }

  candidates.push(join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Unable to locate npm-cli.js. Set INSTALLER_NODE_BINARY and ensure npm is available while building installer artifacts.",
  );
}

function stageNodeBinary(nodePath) {
  if (process.platform === "win32") {
    const targetDir = join(runtimeRoot, "win32");
    mkdirSync(targetDir, { recursive: true });
    cpSync(nodePath, join(targetDir, "node.exe"), { recursive: false });
    return;
  }

  const targetDir = join(runtimeRoot, process.platform, "bin");
  mkdirSync(targetDir, { recursive: true });
  cpSync(nodePath, join(targetDir, "node"), { recursive: false });
}

function stageNpmPackage(npmCliPath) {
  const npmPackageRoot = join(dirname(npmCliPath), "..");
  const target = join(runtimeRoot, "npm");
  mkdirSync(dirname(target), { recursive: true });
  cpSync(npmPackageRoot, target, { recursive: true, force: true });
}

function writeManifest(nodePath, npmCliPath) {
  const manifest = {
    createdAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    nodeSource: nodePath,
    npmCliSource: npmCliPath,
  };

  writeFileSync(join(runtimeRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function main() {
  log("Preparing runtime resources...");
  rmSync(runtimeRoot, { recursive: true, force: true });
  mkdirSync(runtimeRoot, { recursive: true });

  const nodePath = resolveNodePath();
  const npmCliPath = resolveNpmCliPath();

  stageNodeBinary(nodePath);
  stageNpmPackage(npmCliPath);
  writeManifest(nodePath, npmCliPath);

  log("Runtime staging complete.");
}

main();

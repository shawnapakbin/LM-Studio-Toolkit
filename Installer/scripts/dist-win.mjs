import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const installerRoot = join(__dirname, "..");
const releaseRoot = join(installerRoot, "release");
const counterPath = join(releaseRoot, "compile-counter.json");

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: installerRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...extraEnv },
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? -1}`);
  }
}

function readCounter() {
  if (!existsSync(counterPath)) {
    return 0;
  }

  try {
    const raw = readFileSync(counterPath, "utf8");
    const parsed = JSON.parse(raw);
    return Number.isFinite(parsed.counter) ? Number(parsed.counter) : 0;
  } catch {
    return 0;
  }
}

function bumpCounter() {
  const nextCounter = readCounter() + 1;
  mkdirSync(releaseRoot, { recursive: true });
  writeFileSync(
    counterPath,
    `${JSON.stringify(
      {
        counter: nextCounter,
        label: "dist:win",
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return nextCounter;
}

function main() {
  const counter = bumpCounter();
  console.log(`[compile-counter] dist:win build #${counter}`);

  run("npm", ["run", "icons:build"]);
  run("npm", ["run", "prepare:resources"]);
  run("electron-builder", ["--win"], { CSC_IDENTITY_AUTO_DISCOVERY: "false" });

  const baseArtifact = join(releaseRoot, "install.exe");
  if (!existsSync(baseArtifact)) {
    throw new Error("Expected Installer/release/install.exe to exist after packaging.");
  }

  const stampedName = `install-${String(counter).padStart(4, "0")}.exe`;
  const stampedArtifact = join(releaseRoot, stampedName);
  cpSync(baseArtifact, stampedArtifact, { force: true });
  writeFileSync(join(releaseRoot, "latest-installer.txt"), `${stampedName}\n`, "utf8");

  console.log(`[compile-counter] stamped artifact: ${stampedName}`);
}

main();

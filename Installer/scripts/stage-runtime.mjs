import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const installerRoot = join(__dirname, "..");
const runtimeRoot = join(installerRoot, "resources", "runtime");

function log(message) {
  console.log(`[stage-runtime] ${message}`);
}

function writeManifest() {
  const manifest = {
    createdAt: new Date().toISOString(),
    strategy: "download-on-demand",
    nodeVersion: "20.17.0",
    note: "Portable runtime is downloaded by the installer at first use.",
  };

  writeFileSync(join(runtimeRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function main() {
  log("Preparing runtime resources...");
  rmSync(runtimeRoot, { recursive: true, force: true });
  mkdirSync(runtimeRoot, { recursive: true });

  writeManifest();

  log("Runtime staging complete.");
}

main();

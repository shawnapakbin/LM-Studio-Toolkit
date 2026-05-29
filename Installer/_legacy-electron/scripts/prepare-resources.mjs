import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const installerRoot = join(__dirname, "..");

function run(scriptName) {
  const result = spawnSync("node", [join(__dirname, scriptName)], {
    cwd: installerRoot,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`${scriptName} failed with exit code ${result.status ?? -1}.`);
  }
}

function main() {
  run("stage-payload.mjs");
  run("stage-runtime.mjs");
}

main();

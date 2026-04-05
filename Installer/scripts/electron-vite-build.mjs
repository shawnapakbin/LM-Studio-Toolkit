import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const installerRoot = join(__dirname, "..");
const installerNodeModules = join(installerRoot, "node_modules");

const result = spawnSync("electron-vite", ["build"], {
  cwd: installerRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    NODE_PATH: installerNodeModules,
  },
});

if (result.status !== 0) {
  throw new Error(`electron-vite build failed with exit code ${result.status ?? -1}`);
}

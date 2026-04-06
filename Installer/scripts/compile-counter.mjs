import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const installerRoot = join(__dirname, "..");
const releaseRoot = join(installerRoot, "release");
const counterPath = join(releaseRoot, "compile-counter.json");

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

function writeCounter(counter, label) {
  const payload = {
    counter,
    label,
    updatedAt: new Date().toISOString(),
  };

  mkdirSync(releaseRoot, { recursive: true });
  writeFileSync(counterPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function main() {
  const label = process.argv[2] ?? "compile";
  const nextCounter = readCounter() + 1;
  writeCounter(nextCounter, label);
  console.log(`[compile-counter] ${label} build #${nextCounter}`);
}

main();

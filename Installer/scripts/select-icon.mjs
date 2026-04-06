import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pngToIco from "png-to-ico";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const installerRoot = join(__dirname, "..");
const iconsRoot = join(installerRoot, "resources", "icons");

function log(message) {
  console.log(`[select-icon] ${message}`);
}

async function main() {
  const selected = process.argv[2] ?? "llm-toolkit-installer-nodes.svg";
  const sourceSvg = join(iconsRoot, selected);

  if (!existsSync(sourceSvg)) {
    throw new Error(`Icon sample not found: ${sourceSvg}`);
  }

  mkdirSync(iconsRoot, { recursive: true });

  const selectedSvg = join(iconsRoot, "icon.svg");
  const selectedPng = join(iconsRoot, "icon.png");
  const selectedIco = join(iconsRoot, "icon.ico");

  cpSync(sourceSvg, selectedSvg, { force: true });
  log(`Selected icon sample: ${selected}`);

  // Keep a high-resolution PNG for Linux and as ICO source.
  await sharp(selectedSvg).resize(1024, 1024).png().toFile(selectedPng);

  // Windows ICO with common resolutions.
  const icoBuffers = await Promise.all(
    [16, 24, 32, 48, 64, 128, 256].map((size) =>
      sharp(selectedSvg).resize(size, size).png().toBuffer(),
    ),
  );
  const ico = await pngToIco(icoBuffers);
  writeFileSync(selectedIco, ico);

  log("Generated resources/icons/icon.svg");
  log("Generated resources/icons/icon.png");
  log("Generated resources/icons/icon.ico");
}

main().catch((error) => {
  console.error(`[select-icon] ${error.message}`);
  process.exit(1);
});

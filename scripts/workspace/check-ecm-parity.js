#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");

const filePairs = [
  ["ECM/README.md", "Installer/resources/payload/toolkit/ECM/README.md"],
  ["ECM/src/ecm.ts", "Installer/resources/payload/toolkit/ECM/src/ecm.ts"],
  ["ECM/src/compactor.ts", "Installer/resources/payload/toolkit/ECM/src/compactor.ts"],
  ["ECM/src/index.ts", "Installer/resources/payload/toolkit/ECM/src/index.ts"],
  ["ECM/src/mcp-server.ts", "Installer/resources/payload/toolkit/ECM/src/mcp-server.ts"],
  ["ECM/src/policy.ts", "Installer/resources/payload/toolkit/ECM/src/policy.ts"],
  ["ECM/src/store.ts", "Installer/resources/payload/toolkit/ECM/src/store.ts"],
  ["ECM/src/types.ts", "Installer/resources/payload/toolkit/ECM/src/types.ts"],
  ["ECM/scripts/postbuild.js", "Installer/resources/payload/toolkit/ECM/scripts/postbuild.js"],
  ["ECM/tests/http.test.ts", "Installer/resources/payload/toolkit/ECM/tests/http.test.ts"],
  ["ECM/tests/property.test.ts", "Installer/resources/payload/toolkit/ECM/tests/property.test.ts"],
  ["ECM/tests/mcp.test.ts", "Installer/resources/payload/toolkit/ECM/tests/mcp.test.ts"],
  [
    "ECM/tests/auto-compact.test.ts",
    "Installer/resources/payload/toolkit/ECM/tests/auto-compact.test.ts",
  ],
  [
    "ECM/tests/auto-compact-quality-gate.test.ts",
    "Installer/resources/payload/toolkit/ECM/tests/auto-compact-quality-gate.test.ts",
  ],
];

function readFileOrNull(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
  const text = fs.readFileSync(absolutePath, "utf8");
  return text.replace(/\r\n/g, "\n").trimEnd();
}

const mismatches = [];

for (const [canonicalRel, installerRel] of filePairs) {
  const canonical = readFileOrNull(canonicalRel);
  const installer = readFileOrNull(installerRel);

  if (!canonical || !installer) {
    mismatches.push({
      canonicalRel,
      installerRel,
      reason: "missing",
    });
    continue;
  }

  if (canonical !== installer) {
    mismatches.push({
      canonicalRel,
      installerRel,
      reason: "content",
    });
  }
}

if (mismatches.length > 0) {
  console.error(
    "ECM parity check failed. Drift detected between canonical ECM and installer payload ECM.",
  );
  for (const m of mismatches) {
    if (m.reason === "missing") {
      console.error(`- Missing file in pair: ${m.canonicalRel} <-> ${m.installerRel}`);
    } else {
      console.error(`- Content mismatch: ${m.canonicalRel} <-> ${m.installerRel}`);
    }
  }
  process.exit(1);
}

console.log("ECM parity check passed. Installer payload ECM matches canonical ECM files.");

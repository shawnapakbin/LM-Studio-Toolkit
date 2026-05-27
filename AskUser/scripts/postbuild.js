const fs = require("fs");
const path = require("path");

const rootDist = path.resolve(__dirname, "..", "dist");
const nestedDist = path.join(rootDist, "AskUser", "src");
const modernDist = path.join(rootDist, "src");

// Prefer modern output layouts and avoid overwriting freshly compiled files.
const sourceDist = fs.existsSync(modernDist)
  ? modernDist
  : fs.existsSync(nestedDist)
    ? nestedDist
    : null;

if (!sourceDist) {
  process.exit(0);
}

for (const fileName of [
  "index.js",
  "mcp-server.js",
  "ask-user.js",
  "policy.js",
  "store.js",
  "types.js",
]) {
  const source = path.join(sourceDist, fileName);
  const target = path.join(rootDist, fileName);
  if (fs.existsSync(source) && !fs.existsSync(target)) {
    fs.copyFileSync(source, target);
  }
}

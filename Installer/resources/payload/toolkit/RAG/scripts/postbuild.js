const fs = require("fs");
const path = require("path");

const rootDist = path.resolve(__dirname, "..", "dist");
const nestedDist = path.join(rootDist, "RAG", "src");

if (!fs.existsSync(nestedDist)) {
  process.exit(0);
}

for (const fileName of [
  "index.js",
  "mcp-server.js",
  "rag.js",
  "policy.js",
  "store.js",
  "types.js",
  "chunker.js",
  "embeddings.js",
  "retrieval.js",
]) {
  const source = path.join(nestedDist, fileName);
  const target = path.join(rootDist, fileName);
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, target);
  }
}

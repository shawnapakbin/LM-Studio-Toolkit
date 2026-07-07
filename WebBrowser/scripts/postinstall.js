/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

const { spawnSync } = require("node:child_process");

if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1") {
  console.log(
    "[WebBrowser] Skipping Playwright browser download because PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1.",
  );
  process.exit(0);
}

const result = spawnSync("npx", ["playwright", "install", "chromium", "--with-deps"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

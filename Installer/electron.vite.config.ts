/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
    },
    resolve: {
      alias: {
        "@main": resolve(__dirname, "src/main"),
      },
    },
  },
  preload: {
    build: {
      outDir: "out/preload",
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "index.js",
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "src/renderer/src"),
      },
    },
    plugins: [tailwindcss()],
    build: {
      outDir: resolve(__dirname, "out/renderer"),
    },
  },
});

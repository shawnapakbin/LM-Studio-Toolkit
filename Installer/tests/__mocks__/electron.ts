/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";

// Minimal electron stub: only the `app` APIs used by runtime-manager.ts
export const app = {
  getPath: (_name: string) => join(tmpdir(), "llm-toolkit-test"),
  getAppPath: () => join(tmpdir(), "llm-toolkit-test"),
  isPackaged: false,
};

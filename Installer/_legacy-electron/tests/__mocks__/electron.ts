import { tmpdir } from "node:os";
import { join } from "node:path";

// Minimal electron stub: only the `app` APIs used by runtime-manager.ts
export const app = {
  getPath: (_name: string) => join(tmpdir(), "llm-toolkit-test"),
  getAppPath: () => join(tmpdir(), "llm-toolkit-test"),
  isPackaged: false,
};

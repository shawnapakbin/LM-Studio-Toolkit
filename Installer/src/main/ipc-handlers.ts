import { ipcMain, dialog, shell, type BrowserWindow } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";

import { ensureInstallRoot } from "./bootstrap";
import { loadEnvState, saveEnvState } from "./env-manager";
import { getLmStudioInstallationStatus, verifyLmStudio } from "./lmstudio-sync";
import { getRuntimeStatus } from "./runtime-manager";
import { runSetup } from "./setup-runner";
import { getToolStatuses } from "./tool-status";

function sendProgress(window: BrowserWindow, channel: string, payload: unknown) {
  window.webContents.send(channel, payload);
}

export function registerIpcHandlers(window: BrowserWindow) {
  let activeRunController: AbortController | null = null;
  const defaultInstallRoot = join(homedir(), "LLM-Toolkit");

  ipcMain.handle("app:get-runtime-status", () => getRuntimeStatus());
  ipcMain.handle("app:get-install-root", () => defaultInstallRoot);
  ipcMain.handle("dialog:select-dir", async () => {
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory", "createDirectory"],
    });

    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("shell:open-external", async (_event, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle("env:load", (_event, installRoot: string) => loadEnvState(installRoot));
  ipcMain.handle(
    "env:save",
    (_event, installRoot: string, entries: Record<string, string>) => saveEnvState(installRoot, entries),
  );
  ipcMain.handle("tools:status-all", (_event, installRoot: string) => getToolStatuses(installRoot));
  ipcMain.handle("lmstudio:status", (_event, override?: string) => getLmStudioInstallationStatus(override));
  ipcMain.handle("lmstudio:verify", (_event, installRoot: string, override?: string) =>
    verifyLmStudio(installRoot, override),
  );
  ipcMain.handle("setup:start", async (_event, installRoot: string, options?: { allowDownloads?: boolean }) => {
    ensureInstallRoot(installRoot);
    activeRunController = new AbortController();
    try {
      return await runSetup(
        { installRoot, repair: false, allowDownloads: options?.allowDownloads === true },
        {
          onProgress: (payload) => sendProgress(window, "setup:progress", payload),
          onLog: (payload) => sendProgress(window, "setup:log", payload),
        },
        activeRunController.signal,
      );
    } finally {
      activeRunController = null;
    }
  });
  ipcMain.handle("setup:repair", async (_event, installRoot: string, options?: { allowDownloads?: boolean }) => {
    ensureInstallRoot(installRoot);
    activeRunController = new AbortController();
    try {
      return await runSetup(
        { installRoot, repair: true, allowDownloads: options?.allowDownloads === true },
        {
          onProgress: (payload) => sendProgress(window, "setup:progress", payload),
          onLog: (payload) => sendProgress(window, "setup:log", payload),
        },
        activeRunController.signal,
      );
    } finally {
      activeRunController = null;
    }
  });
  ipcMain.handle("setup:cancel", () => {
    if (activeRunController) {
      activeRunController.abort();
      activeRunController = null;
      return true;
    }

    return false;
  });
}
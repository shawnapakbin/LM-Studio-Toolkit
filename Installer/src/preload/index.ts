import { contextBridge, ipcRenderer } from "electron";

const electronApi = {
  getRuntimeStatus: () => ipcRenderer.invoke("app:get-runtime-status"),
  getInstallRoot: () => ipcRenderer.invoke("app:get-install-root"),
  selectDirectory: () => ipcRenderer.invoke("dialog:select-dir"),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
  loadEnv: (installRoot: string) => ipcRenderer.invoke("env:load", installRoot),
  saveEnv: (installRoot: string, entries: Record<string, string>) =>
    ipcRenderer.invoke("env:save", installRoot, entries),
  getToolStatuses: (installRoot: string) => ipcRenderer.invoke("tools:status-all", installRoot),
  getLmStudioStatus: (override?: string) => ipcRenderer.invoke("lmstudio:status", override),
  verifyLmStudio: (installRoot: string, override?: string) =>
    ipcRenderer.invoke("lmstudio:verify", installRoot, override),
  startSetup: (installRoot: string, options?: { allowDownloads?: boolean }) =>
    ipcRenderer.invoke("setup:start", installRoot, options),
  repairSetup: (installRoot: string, options?: { allowDownloads?: boolean }) =>
    ipcRenderer.invoke("setup:repair", installRoot, options),
  cancelSetup: () => ipcRenderer.invoke("setup:cancel"),
  onSetupProgress: (handler: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => handler(payload);
    ipcRenderer.on("setup:progress", listener);
    return () => ipcRenderer.removeListener("setup:progress", listener);
  },
  onSetupLog: (handler: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => handler(payload);
    ipcRenderer.on("setup:log", listener);
    return () => ipcRenderer.removeListener("setup:log", listener);
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronApi);
export {};

interface RuntimeStatus {
  bundledNodePath: string | null;
  bundledNpmCliPath: string | null;
  downloadedNodePath: string | null;
  downloadedNpmCliPath: string | null;
  systemNodePath: string | null;
  systemNodeVersion: string | null;
  systemNpmVersion: string | null;
  isBundledRuntimeReady: boolean;
  isDownloadedRuntimeReady: boolean;
  mode: "bundled" | "downloaded" | "system" | "missing";
}

interface LmStudioInstallationStatus {
  appInstalled: boolean;
  appPath: string | null;
  pluginRoot: string;
  pluginRootExists: boolean;
  message: string;
}

declare global {
  interface Window {
    electronAPI: {
      getRuntimeStatus: () => Promise<RuntimeStatus>;
      getInstallRoot: () => Promise<string>;
      selectDirectory: () => Promise<string | null>;
      openExternal: (url: string) => Promise<void>;
      loadEnv: (installRoot: string) => Promise<unknown>;
      saveEnv: (installRoot: string, entries: Record<string, string>) => Promise<unknown>;
      getToolStatuses: (installRoot: string) => Promise<unknown>;
      getLmStudioStatus: (override?: string) => Promise<LmStudioInstallationStatus>;
      verifyLmStudio: (installRoot: string, override?: string) => Promise<unknown>;
      startSetup: (installRoot: string, options?: { allowDownloads?: boolean }) => Promise<unknown>;
      repairSetup: (installRoot: string, options?: { allowDownloads?: boolean }) => Promise<unknown>;
      cancelSetup: () => Promise<boolean>;
      onSetupProgress: (handler: (payload: unknown) => void) => () => void;
      onSetupLog: (handler: (payload: unknown) => void) => () => void;
    };
  }
}
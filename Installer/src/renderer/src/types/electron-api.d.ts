export {};

interface RuntimeStatus {
  bundledNodePath: string | null;
  bundledNpmCliPath: string | null;
  systemNodePath: string | null;
  systemNodeVersion: string | null;
  systemNpmVersion: string | null;
  isBundledRuntimeReady: boolean;
  mode: "bundled" | "system" | "missing";
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
      verifyLmStudio: (installRoot: string, override?: string) => Promise<unknown>;
      startSetup: (installRoot: string) => Promise<unknown>;
      repairSetup: (installRoot: string) => Promise<unknown>;
      cancelSetup: () => Promise<boolean>;
      onSetupProgress: (handler: (payload: unknown) => void) => () => void;
      onSetupLog: (handler: (payload: unknown) => void) => () => void;
    };
  }
}
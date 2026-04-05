export type ProgressLevel = "info" | "ok" | "warn" | "error" | "section";

export type SetupPhase =
  | "bootstrap"
  | "env"
  | "install"
  | "build"
  | "verify"
  | "lmstudio";

export interface SetupProgressEvent {
  level: ProgressLevel;
  message: string;
  phase: SetupPhase;
  step: number;
}

export interface SetupLogEvent {
  line: string;
  stream: "stdout" | "stderr";
}

export interface RuntimeStatus {
  bundledNodePath: string | null;
  bundledNpmCliPath: string | null;
  systemNodePath: string | null;
  systemNodeVersion: string | null;
  systemNpmVersion: string | null;
  isBundledRuntimeReady: boolean;
  mode: "bundled" | "system" | "missing";
}

export interface InstallContext {
  installRoot: string;
  repair: boolean;
}

export interface EnvField {
  key: string;
  value: string;
  required?: boolean;
  description: string;
}

export interface EnvState {
  envFilePath: string;
  fields: EnvField[];
}

export interface ToolDescriptor {
  id: string;
  displayName: string;
  relativeScript: string;
  env: Record<string, string>;
}

export interface ToolStatus {
  toolId: string;
  displayName: string;
  scriptPath: string;
  binaryExists: boolean;
  lastModifiedAt: string | null;
}

export interface LmStudioStatus {
  pluginRoot: string;
  exists: boolean;
  mode: "ready" | "skipped";
  updated: number;
  skipped: number;
  message: string;
}
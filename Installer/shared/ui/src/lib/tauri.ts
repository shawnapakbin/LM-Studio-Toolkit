import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type InstallScope = "system" | "user";

export interface SystemInfo {
  os: string;
  arch: string;
  elevated: boolean;
  installer_version: string;
  default_scope: InstallScope;
  default_install_root_system: string;
  default_install_root_user: string;
}

export interface LicenseAcceptance {
  checkbox_checked: boolean;
  scrolled_to_bottom: boolean;
}

export interface LmStudioInstallationStatus {
  app_installed: boolean;
  app_path: string | null;
  plugin_root: string;
  plugin_root_exists: boolean;
  message: string;
}

export interface ToolDescriptor {
  id: string;
  displayName: string;
  relativeScript: string;
  env: Record<string, string>;
}

export type Phase =
  | "welcome"
  | "license"
  | "location"
  | "options"
  | "runtime"
  | "payload-download"
  | "payload-extract"
  | "env-write"
  | "npm-install"
  | "build"
  | "verify"
  | "lm-studio-sync"
  | "done";

export type InstallErrorKind =
  | "network"
  | "filesystem"
  | "permission"
  | "process"
  | "verification"
  | "cancelled"
  | "invalid-input"
  | "internal";

export interface InstallError {
  phase: Phase;
  kind: InstallErrorKind;
  message: string;
  recoverable: boolean;
  cause_chain: string[];
}

export interface InstallProgress {
  phase: Phase;
  step: number;
  total: number;
  label: string;
}

export interface InstallPaths {
  scope: InstallScope;
  install_root: string;
  app_data: string;
  logs_dir: string;
  diagnostics_dir: string;
}

export type ProgressEvent =
  | { kind: "progress"; phase: Phase; step: number; total: number; label: string }
  | { kind: "log"; level: string; line: string }
  | { kind: "phase-done"; phase: Phase }
  | { kind: "error"; error: InstallError }
  | { kind: "done"; paths: InstallPaths };

export interface InstallOptions {
  scope: InstallScope;
  install_root: string;
  install_playwright_browsers: boolean;
  sync_lm_studio: boolean;
  create_start_menu_shortcut: boolean;
  license: LicenseAcceptance;
  payload_url_override?: string | null;
}

export interface InstallErrorEvent {
  error: InstallError;
  report_path: string | null;
  issue_url: string;
}

export const tauriApi = {
  getSystemInfo: () => invoke<SystemInfo>("get_system_info"),
  getLicenseText: () => invoke<string>("get_license_text"),
  validateLicense: (acceptance: LicenseAcceptance) =>
    invoke<void>("validate_license", { acceptance }),
  getLmStudioStatus: (overridePath?: string) =>
    invoke<LmStudioInstallationStatus>("get_lm_studio_status", {
      overridePath: overridePath ?? null,
    }),
  startInstall: (options: InstallOptions) => invoke<void>("start_install", { options }),
  cancelInstall: () => invoke<void>("cancel_install"),
  listTools: () => invoke<ToolDescriptor[]>("list_tools"),
  saveDiagnosticReport: (error: InstallError | null) =>
    invoke<string>("save_diagnostic_report", { error }),
  buildGithubIssueUrl: (error: InstallError | null, reportPath: string | null) =>
    invoke<string>("build_github_issue_url", { error, reportPath }),
};

export function onInstallEvent(handler: (evt: ProgressEvent) => void): Promise<UnlistenFn> {
  return listen<ProgressEvent>("install:event", (e) => handler(e.payload));
}

export function onInstallError(handler: (evt: InstallErrorEvent) => void): Promise<UnlistenFn> {
  return listen<InstallErrorEvent>("install:error", (e) => handler(e.payload));
}

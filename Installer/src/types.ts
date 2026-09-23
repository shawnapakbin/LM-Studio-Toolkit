/**
 * Installer step and state type definitions.
 *
 * The installer moves through a wizard:
 *   welcome → installing (5 provisioning steps) → complete
 *
 * During the "installing" macro-phase, the backend runs five ordered
 * provisioning steps and reports 0–100% progress for each. The step
 * string values below MUST match the backend `InstallationResult.step`
 * values exactly (see `installer.rs` `Step::name()`).
 */

/** Top-level wizard screen the user sees. */
export type WizardPhase = "welcome" | "installing" | "complete";

/**
 * The five ordered provisioning steps executed sequentially by the backend.
 *
 * These values match the backend `Step::name()` output exactly:
 *   "runtimes" | "copy-tools" | "lm-studio-plugin-dirs"
 *   | "env-config" | "uninstall-registration"
 */
export type InstallStep =
  | "runtimes"
  | "copy-tools"
  | "lm-studio-plugin-dirs"
  | "env-config"
  | "uninstall-registration";

/** Human-readable labels for each provisioning step (Req 9.1). */
export const STEP_LABELS: Record<InstallStep, string> = {
  runtimes: "Runtimes",
  "copy-tools": "Copy Tools",
  "lm-studio-plugin-dirs": "LM Studio Plugin Dirs",
  "env-config": "Env Config",
  "uninstall-registration": "Uninstall Registration",
};

/** Ordered list of provisioning steps for iteration (Req 9.1 order). */
export const STEP_ORDER: InstallStep[] = [
  "runtimes",
  "copy-tools",
  "lm-studio-plugin-dirs",
  "env-config",
  "uninstall-registration",
];

/** Progress state for the installation flow. */
export interface InstallProgress {
  /** Current provisioning step being executed. */
  currentPhase: InstallStep;
  /** 0–100 progress within the current step. */
  percent: number;
  /** Optional status message from the backend. */
  message?: string;
}

/** Error state when an installation step fails. */
export interface InstallError {
  /** Which provisioning step failed. */
  phase: InstallStep;
  /** Error description. */
  message: string;
  /** Whether the error is network-related (enables retry). */
  isNetworkError: boolean;
}

/** Result returned by the validate_install_path Tauri command. */
export interface PathValidationResult {
  valid: boolean;
  error?: string;
}

/** Dependency status returned by check_dependencies command. */
export interface DependencyStatus {
  name: string;
  displayName: string;
  installed: boolean;
  version?: string;
  meetsMinimum: boolean;
  minimumVersion: string;
}

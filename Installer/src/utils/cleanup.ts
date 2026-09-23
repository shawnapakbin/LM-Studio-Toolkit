/**
 * Installation cleanup utility.
 *
 * Mirrors the Rust `cleanup_installation()` logic in `src-tauri/src/installer.rs`.
 * When a user cancels an installation (or a phase fails irrecoverably), this function
 * removes partially installed components from the installation directory, leaving no
 * orphaned files. The parent install directory itself is preserved.
 *
 * Subdirectories removed:
 * - `llm-toolkit/` (cloned repository)
 * - `downloads/` (dependency installer files)
 */

import * as fs from "fs";
import * as path from "path";

/** Subdirectories that are cleaned up on cancellation. */
export const CLEANUP_SUBDIRS = ["llm-toolkit", "downloads"] as const;

/**
 * Remove partially installed components from the installation directory.
 *
 * For each known subdirectory (`llm-toolkit/`, `downloads/`), if it exists,
 * remove it recursively. The parent `installPath` directory is preserved.
 *
 * @param installPath - The root installation directory.
 */
export function cleanupInstallation(installPath: string): void {
  for (const subdir of CLEANUP_SUBDIRS) {
    const target = path.join(installPath, subdir);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
}

/**
 * Client-side installation path validation.
 *
 * These checks mirror the Rust-side validation in src-tauri/src/path_validation.rs
 * but run synchronously in the frontend for immediate feedback. The backend
 * additionally verifies writability (which requires filesystem access).
 */

/** Maximum allowed length for an installation path */
export const MAX_PATH_LENGTH = 200;

/** Characters that are invalid in Windows file paths (excluding path separators) */
export const INVALID_WINDOWS_CHARS: readonly string[] = ["<", ">", '"', "|", "?", "*"];

/**
 * Validate a path string for use as an installation directory.
 *
 * Returns null if the path is valid, or a descriptive error string if not.
 *
 * Checks performed:
 * 1. Path is not empty (or whitespace-only)
 * 2. Path does not exceed 200 characters
 * 3. Path does not contain invalid Windows characters
 * 4. Path does not contain control characters (ASCII 0-31)
 */
export function validateInstallPath(path: string): string | null {
  // Check for empty path
  if (!path.trim()) {
    return "Installation path cannot be empty.";
  }

  // Check path length
  if (path.length > MAX_PATH_LENGTH) {
    return `Path must be ${MAX_PATH_LENGTH} characters or fewer (currently ${path.length}).`;
  }

  // Check for invalid Windows characters (skip drive letter colon)
  const pathToCheck = path.length >= 2 && path[1] === ":" ? path.slice(2) : path;

  for (const ch of INVALID_WINDOWS_CHARS) {
    if (pathToCheck.includes(ch)) {
      return `Path contains invalid character: '${ch}'`;
    }
  }

  // Check for control characters (ASCII 0-31)
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code >= 0 && code <= 31) {
      return "Path contains invalid control characters.";
    }
  }

  return null;
}

use serde::Serialize;
use std::fs;
use std::path::Path;

/// Maximum allowed length for an installation path
const MAX_PATH_LENGTH: usize = 200;

/// Characters that are invalid in Windows file paths (excluding path separators)
const INVALID_WINDOWS_CHARS: &[char] = &['<', '>', '"', '|', '?', '*'];

/// Result of path validation
#[derive(Debug, Clone, Serialize)]
pub struct PathValidationResult {
    pub valid: bool,
    pub error: Option<String>,
}

impl PathValidationResult {
    fn ok() -> Self {
        Self {
            valid: true,
            error: None,
        }
    }

    fn err(message: impl Into<String>) -> Self {
        Self {
            valid: false,
            error: Some(message.into()),
        }
    }
}

/// Validate that a given path is suitable as an installation directory.
///
/// Checks performed:
/// 1. Path is not empty
/// 2. Path does not exceed 200 characters
/// 3. Path does not contain invalid Windows characters
/// 4. Path (or its nearest existing ancestor) is writable
///
/// Returns a `PathValidationResult` indicating success or a descriptive error.
pub fn validate_install_path(path: &str) -> PathValidationResult {
    // Check for empty path
    if path.trim().is_empty() {
        return PathValidationResult::err("Installation path cannot be empty");
    }

    // Check path length
    if path.len() > MAX_PATH_LENGTH {
        return PathValidationResult::err(format!(
            "Path exceeds {} characters (length: {})",
            MAX_PATH_LENGTH,
            path.len()
        ));
    }

    // Check for invalid Windows characters in the path (excluding drive letter colon)
    // We check the path portion after any drive letter prefix (e.g., "C:")
    let path_to_check = if path.len() >= 2 && path.as_bytes()[1] == b':' {
        &path[2..]
    } else {
        path
    };

    for ch in INVALID_WINDOWS_CHARS {
        if path_to_check.contains(*ch) {
            return PathValidationResult::err(format!("Path contains invalid character: '{}'", ch));
        }
    }

    // Check for control characters (ASCII 0-31)
    if path.chars().any(|c| c.is_control()) {
        return PathValidationResult::err("Path contains invalid control characters");
    }

    // Check writability by attempting a test write
    let target = Path::new(path);

    // If the path already exists, test write directly in it
    if target.exists() {
        return check_writable(target);
    }

    // If the path doesn't exist, try to find the nearest existing ancestor
    // and check if we can create directories there
    let mut ancestor = target.parent();
    while let Some(dir) = ancestor {
        if dir.exists() {
            // Try to create the target directory to verify write access
            match fs::create_dir_all(target) {
                Ok(_) => {
                    // Clean up: remove only the directories we just created
                    // Walk back from target to the existing ancestor and remove empty dirs
                    cleanup_created_dirs(target, dir);
                    return PathValidationResult::ok();
                }
                Err(e) => {
                    return PathValidationResult::err(format!("Path is not writable: {}", e));
                }
            }
        }
        ancestor = dir.parent();
    }

    // No existing ancestor found at all — path is invalid
    PathValidationResult::err("Path is not writable: no valid parent directory exists")
}

/// Check that an existing directory is writable by creating and removing a temp file.
fn check_writable(dir: &Path) -> PathValidationResult {
    let test_file = dir.join(".llm_toolkit_write_test");
    match fs::write(&test_file, b"test") {
        Ok(_) => {
            let _ = fs::remove_file(&test_file);
            PathValidationResult::ok()
        }
        Err(e) => PathValidationResult::err(format!("Path is not writable: {}", e)),
    }
}

/// Remove directories we created during validation, walking from `created` back to `existing_ancestor`.
fn cleanup_created_dirs(created: &Path, existing_ancestor: &Path) {
    let mut current = created;
    while current != existing_ancestor {
        // Only remove if empty (safety measure)
        if fs::remove_dir(current).is_err() {
            break;
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => break,
        }
    }
}

/// Returns the default installation path: `%LOCALAPPDATA%\LLM-Toolkit`
pub fn default_install_path() -> String {
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        format!("{}\\LLM-Toolkit", local_app_data)
    } else {
        // Fallback if LOCALAPPDATA is not set (unlikely on Windows)
        "C:\\LLM-Toolkit".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn test_empty_path_rejected() {
        let result = validate_install_path("");
        assert!(!result.valid);
        assert_eq!(result.error.unwrap(), "Installation path cannot be empty");
    }

    #[test]
    fn test_whitespace_only_path_rejected() {
        let result = validate_install_path("   ");
        assert!(!result.valid);
        assert_eq!(result.error.unwrap(), "Installation path cannot be empty");
    }

    #[test]
    fn test_path_exceeds_max_length() {
        let long_path = "C:\\".to_string() + &"a".repeat(200);
        let result = validate_install_path(&long_path);
        assert!(!result.valid);
        let err = result.error.unwrap();
        assert!(err.contains("exceeds 200 characters"));
    }

    #[test]
    fn test_path_at_exactly_max_length_is_valid() {
        // Create a valid, writable path that is exactly 200 characters
        let temp = env::temp_dir();
        let temp_str = temp.to_string_lossy().to_string();
        // Pad the path to exactly 200 characters
        let needed = 200 - temp_str.len() - 1; // -1 for the separator
        if needed > 0 {
            let padded = format!("{}\\{}", temp_str, "x".repeat(needed));
            assert_eq!(padded.len(), 200);
            let result = validate_install_path(&padded);
            // Should not fail on length check
            assert!(result.valid || !result.error.as_deref().unwrap_or("").contains("exceeds"));
        }
    }

    #[test]
    fn test_invalid_characters_rejected() {
        let invalid_paths = vec![
            "C:\\install<dir",
            "C:\\install>dir",
            "C:\\install\"dir",
            "C:\\install|dir",
            "C:\\install?dir",
            "C:\\install*dir",
        ];

        for path in invalid_paths {
            let result = validate_install_path(path);
            assert!(!result.valid, "Path should be invalid: {}", path);
            assert!(
                result.error.as_ref().unwrap().contains("invalid character"),
                "Error should mention invalid character for: {}",
                path
            );
        }
    }

    #[test]
    fn test_control_characters_rejected() {
        let path = "C:\\install\x01dir";
        let result = validate_install_path(path);
        assert!(!result.valid);
        assert!(result.error.unwrap().contains("control characters"));
    }

    #[test]
    fn test_valid_temp_path() {
        let temp = env::temp_dir();
        let test_path = temp.join("llm_toolkit_test_validation");
        let result = validate_install_path(&test_path.to_string_lossy());
        assert!(
            result.valid,
            "Temp directory path should be valid: {:?}",
            result.error
        );
        // Clean up in case the dir was created during validation
        let _ = fs::remove_dir(&test_path);
    }

    #[test]
    fn test_default_install_path_uses_localappdata() {
        let path = default_install_path();
        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            assert!(path.starts_with(&local_app_data));
            assert!(path.ends_with("LLM-Toolkit"));
        } else {
            assert_eq!(path, "C:\\LLM-Toolkit");
        }
    }

    #[test]
    fn test_nonexistent_unwritable_path() {
        // A path that should not be writable on most systems
        let result = validate_install_path("Z:\\nonexistent_drive\\some_path");
        assert!(!result.valid);
        let err = result.error.unwrap();
        assert!(
            err.contains("not writable") || err.contains("no valid parent"),
            "Unexpected error: {}",
            err
        );
    }

    #[test]
    fn test_drive_letter_colon_not_treated_as_invalid() {
        // "C:\\" has a colon but it's a valid drive letter prefix
        let temp = env::temp_dir();
        let result = validate_install_path(&temp.to_string_lossy());
        // Should not fail due to colon in drive letter
        assert!(
            result.valid
                || !result
                    .error
                    .as_deref()
                    .unwrap_or("")
                    .contains("invalid character"),
        );
    }
}

// ---------------------------------------------------------------------------
// Preservation tests (task 8.1)
//
// These tests LOCK the current behavior of `path_validation.rs` before task 8.2
// reuses this module for the bundled-payload copy step. They pin the existing
// validation contract so that any change made while wiring the copy step is
// detected by the test suite.
//
// Contract locked here:
//   - The empty / whitespace-only path is always rejected (never a copy target).
//   - Paths exceeding MAX_PATH_LENGTH are always rejected.
//   - Paths containing the invalid Windows characters (< > " | ? *) in the
//     non-drive-letter portion are always rejected.
//   - Paths containing control characters are always rejected.
//   - `validate_install_path` is total: it never panics and always returns a
//     `PathValidationResult` whose `error` presence agrees with `valid`.
//   - `default_install_path()` is the copy target recorded for uninstall
//     (Requirement 5.6): it is non-empty, ends with "LLM-Toolkit", and is
//     honored by LOCALAPPDATA when that variable is set.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod preservation_tests {
    use super::*;
    use proptest::prelude::*;
    use std::env;

    /// Invariant helper: `valid` and `error` must always agree.
    /// A valid result carries no error; an invalid result always carries one.
    fn result_shape_is_consistent(r: &PathValidationResult) -> bool {
        r.valid == r.error.is_none()
    }

    // -- default_install_path(): the recorded copy target for uninstall (Req 5.6) --

    #[test]
    fn preservation_default_install_path_is_nonempty_and_named() {
        let path = default_install_path();
        assert!(!path.trim().is_empty(), "default install path must not be empty");
        assert!(
            path.ends_with("LLM-Toolkit"),
            "default install path must end with the toolkit name: {path}"
        );
    }

    #[test]
    fn preservation_default_install_path_honors_localappdata() {
        match env::var("LOCALAPPDATA") {
            Ok(local_app_data) => {
                let expected = format!("{}\\LLM-Toolkit", local_app_data);
                assert_eq!(
                    default_install_path(),
                    expected,
                    "default install path must be derived from %LOCALAPPDATA%"
                );
            }
            Err(_) => {
                // Fallback contract when LOCALAPPDATA is unset (unlikely on Windows).
                assert_eq!(default_install_path(), "C:\\LLM-Toolkit");
            }
        }
    }

    #[test]
    fn preservation_default_install_path_is_stable() {
        // The recorded uninstall target must be deterministic across calls.
        assert_eq!(default_install_path(), default_install_path());
    }

    // -- Rejection contract: explicit, deterministic cases --

    #[test]
    fn preservation_empty_and_whitespace_always_rejected() {
        for p in ["", " ", "   ", "\t", "\t \n"] {
            let r = validate_install_path(p);
            assert!(!r.valid, "path {:?} must be rejected", p);
            assert!(result_shape_is_consistent(&r));
        }
    }

    #[test]
    fn preservation_invalid_windows_chars_always_rejected() {
        for ch in ['<', '>', '"', '|', '?', '*'] {
            let path = format!("C:\\install{}dir", ch);
            let r = validate_install_path(&path);
            assert!(!r.valid, "path with '{}' must be rejected", ch);
            assert!(
                r.error.as_deref().unwrap_or("").contains("invalid character"),
                "error for '{}' must mention invalid character",
                ch
            );
        }
    }

    #[test]
    fn preservation_control_characters_always_rejected() {
        let path = "C:\\install\u{0001}dir";
        let r = validate_install_path(path);
        assert!(!r.valid);
        assert!(r.error.as_deref().unwrap_or("").contains("control characters"));
    }

    // -- Property-based preservation of the validation contract --

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        /// The function is total: it never panics and its result shape is always
        /// consistent (valid <=> no error) for arbitrary input strings.
        #[test]
        fn prop_validate_is_total_and_shape_consistent(s in ".*") {
            let r = validate_install_path(&s);
            prop_assert!(result_shape_is_consistent(&r));
        }

        /// Any path whose length exceeds MAX_PATH_LENGTH is rejected, regardless
        /// of its contents.
        #[test]
        fn prop_overlong_paths_rejected(base in "[A-Za-z0-9_]+", extra in 1usize..300) {
            let path = format!("C:\\{}{}", base, "a".repeat(MAX_PATH_LENGTH + extra));
            let r = validate_install_path(&path);
            prop_assert!(!r.valid);
            prop_assert!(result_shape_is_consistent(&r));
        }

        /// A path containing any invalid Windows character in its non-drive-letter
        /// portion is always rejected with an "invalid character" error, for any
        /// surrounding safe segments within the length limit.
        #[test]
        fn prop_invalid_char_anywhere_rejected(
            prefix in "[A-Za-z0-9_\\\\]{0,40}",
            bad in prop::sample::select(vec!['<', '>', '"', '|', '?', '*']),
            suffix in "[A-Za-z0-9_\\\\]{0,40}",
        ) {
            let path = format!("C:\\{}{}{}", prefix, bad, suffix);
            // Stay within the length contract so the invalid-char check is the
            // deciding rejection.
            prop_assume!(path.len() <= MAX_PATH_LENGTH);
            let r = validate_install_path(&path);
            prop_assert!(!r.valid);
            prop_assert!(result_shape_is_consistent(&r));
            prop_assert!(r.error.as_deref().unwrap_or("").contains("invalid character"));
        }

        /// Any path containing a control character is always rejected.
        #[test]
        fn prop_control_char_rejected(
            prefix in "[A-Za-z0-9_\\\\]{0,40}",
            ctrl in 1u8..32,
            suffix in "[A-Za-z0-9_\\\\]{0,40}",
        ) {
            let path = format!("C:\\{}{}{}", prefix, ctrl as char, suffix);
            prop_assume!(path.len() <= MAX_PATH_LENGTH);
            let r = validate_install_path(&path);
            prop_assert!(!r.valid);
            prop_assert!(result_shape_is_consistent(&r));
        }

        /// Empty / whitespace-only paths are always rejected.
        #[test]
        fn prop_whitespace_only_rejected(s in "[ \\t\\n\\r]{0,20}") {
            let r = validate_install_path(&s);
            prop_assert!(!r.valid);
            prop_assert!(result_shape_is_consistent(&r));
        }
    }
}

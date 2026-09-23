use serde::Serialize;
use std::process::Command;

use crate::manifest::{self, DependencyEntry};
use crate::registry;

/// Status of a single dependency (e.g., Node.js, Git)
#[derive(Debug, Clone, Serialize)]
pub struct DependencyStatus {
    pub name: String,
    pub display_name: String,
    pub installed: bool,
    pub installed_version: Option<String>,
    pub minimum_version: String,
    pub needs_download: bool,
}

/// A parsed semantic version as (major, minor, patch)
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct SemVer {
    major: u64,
    minor: u64,
    patch: u64,
}

impl SemVer {
    /// Parse a version string into (major, minor, patch).
    /// Handles formats like "20.18.0", "v20.18.0", "2.47.0.windows.1"
    fn parse(version_str: &str) -> Option<SemVer> {
        let trimmed = version_str.trim().trim_start_matches('v');
        let parts: Vec<&str> = trimmed.split('.').collect();
        if parts.len() < 3 {
            return None;
        }
        let major = parts[0].parse::<u64>().ok()?;
        let minor = parts[1].parse::<u64>().ok()?;
        // patch may contain extra info (e.g. "0" from "2.47.0.windows.1"), just take digits
        let patch_str = parts[2];
        let patch = patch_str
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse::<u64>()
            .ok()?;
        Some(SemVer {
            major,
            minor,
            patch,
        })
    }

    /// Returns true if self >= other
    fn satisfies_minimum(&self, minimum: &SemVer) -> bool {
        self >= minimum
    }
}

/// Extract a version string from command output.
///
/// Handles:
/// - Node.js: "v20.18.0\n" -> "20.18.0"
/// - Git: "git version 2.47.0.windows.1\n" -> "2.47.0"
fn extract_version_from_output(output: &str) -> Option<String> {
    let trimmed = output.trim();
    // Look for a pattern like vX.Y.Z or X.Y.Z in the output
    for word in trimmed.split_whitespace() {
        let candidate = word.trim_start_matches('v');
        if let Some(ver) = SemVer::parse(candidate) {
            return Some(format!("{}.{}.{}", ver.major, ver.minor, ver.patch));
        }
    }
    None
}

/// Try to detect a dependency version by running its PATH command.
/// The `path_command` is the detection strategy path, e.g., "node --version" or "git --version".
fn detect_via_path(path_command: &str) -> Option<String> {
    let parts: Vec<&str> = path_command.split_whitespace().collect();
    if parts.is_empty() {
        return None;
    }

    let program = parts[0];
    let args = &parts[1..];

    let output = Command::new(program).args(args).output().ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    extract_version_from_output(&stdout)
}

/// Try to detect a dependency via the Windows registry.
/// The `registry_path` is the full registry key, e.g., "HKLM\\SOFTWARE\\Node.js\\InstallPath".
/// We parse the key path and value name from this string.
fn detect_via_registry(registry_path: &str) -> Option<String> {
    // The registry path format in the manifest is like:
    // "HKLM\\SOFTWARE\\Node.js\\InstallPath"
    // We strip the HKLM\\ prefix and use the last component as the value name,
    // with everything else as the key path.
    let path = registry_path
        .trim_start_matches("HKLM\\")
        .trim_start_matches("HKLM/");

    // Split into key path and value name
    // e.g., "SOFTWARE\\Node.js\\InstallPath" -> key="SOFTWARE\\Node.js", value="InstallPath"
    if let Some(last_sep) = path.rfind('\\').or_else(|| path.rfind('/')) {
        let key_path = &path[..last_sep];
        let value_name = &path[last_sep + 1..];
        registry::query_install_path(key_path, value_name)
    } else {
        // If there's no separator, try checking if the key itself exists
        if registry::key_exists(path) {
            Some(String::new()) // Key exists but we can't extract a version
        } else {
            None
        }
    }
}

/// Detect a single dependency using the manifest entry information.
/// First tries PATH detection (which gives us version info), then falls back to registry.
pub fn detect_dependency(name: &str, entry: &DependencyEntry) -> DependencyStatus {
    // Try PATH detection first - this gives us actual version output
    let version_from_path = detect_via_path(&entry.detection_strategy.path);

    // Try registry detection as a fallback to confirm installation exists
    let registry_path = detect_via_registry(&entry.detection_strategy.registry);

    // Determine installed version: prefer PATH output since it has the actual version
    let installed_version = version_from_path.clone();

    // Determine if installed: found via PATH (with version) or registry
    let installed = installed_version.is_some() || registry_path.is_some();

    // Determine if the version satisfies the minimum
    let needs_download = if let Some(ref ver_str) = installed_version {
        let minimum = SemVer::parse(&entry.minimum_version);
        let current = SemVer::parse(ver_str);
        match (current, minimum) {
            (Some(cur), Some(min)) => !cur.satisfies_minimum(&min),
            _ => true, // Can't parse version, assume we need download
        }
    } else {
        // No version detected via PATH; even if registry found something,
        // we can't confirm the version meets minimum, so need download
        true
    };

    DependencyStatus {
        name: name.to_string(),
        display_name: entry.display_name.clone(),
        installed,
        installed_version,
        minimum_version: entry.minimum_version.clone(),
        needs_download,
    }
}

/// Detect all required dependencies and return their status.
/// Loads the dependency manifest and checks each entry.
pub fn detect_all() -> Vec<DependencyStatus> {
    let manifest = match manifest::load_manifest() {
        Ok(m) => m,
        Err(err) => {
            eprintln!("Failed to load dependency manifest: {}", err);
            return vec![];
        }
    };

    let mut results: Vec<DependencyStatus> = manifest
        .dependencies
        .iter()
        .map(|(name, entry)| detect_dependency(name, entry))
        .collect();

    // Sort by name for deterministic output
    results.sort_by(|a, b| a.name.cmp(&b.name));
    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // ---------------------------------------------------------------------
    // Preservation property test — Feature: windows-installer-setup-exe,
    // Property 3: Runtime version decision and monotonicity
    //
    // This test captures the CURRENT behavior of `SemVer::parse` /
    // `SemVer::satisfies_minimum` and the runtime-provisioning decision it
    // drives, so that later edits (changing the detected-dependency set from
    // Git to Python in tasks 7.4/7.5) do not regress this logic.
    // Validates: Requirements 4.2, 4.3, 4.4.
    // ---------------------------------------------------------------------

    /// Model of the current provisioning decision as implemented in
    /// `detect_dependency`: a runtime needs provisioning (download) when it is
    /// absent OR its parsed version is strictly below the parsed minimum.
    ///
    /// `installed_version` is `None` when the runtime is absent.
    fn decide_needs_download(installed_version: Option<&str>, minimum_version: &str) -> bool {
        match installed_version {
            Some(ver_str) => {
                let minimum = SemVer::parse(minimum_version);
                let current = SemVer::parse(ver_str);
                match (current, minimum) {
                    (Some(cur), Some(min)) => !cur.satisfies_minimum(&min),
                    // Unparseable version or minimum: current code assumes download.
                    _ => true,
                }
            }
            // Absent runtime: current code always provisions.
            None => true,
        }
    }

    /// Generate a well-formed "major.minor.patch" version string within a
    /// constrained space so comparisons exercise all ordering positions.
    fn semver_string() -> impl Strategy<Value = String> {
        (0u64..50, 0u64..50, 0u64..50).prop_map(|(maj, min, pat)| format!("{}.{}.{}", maj, min, pat))
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        // Part A: Version decision.
        // Provision (needs_download) IFF the runtime is absent OR its parsed
        // version is strictly below the parsed minimum.
        #[test]
        fn prop_provision_iff_absent_or_below_minimum(
            present in any::<bool>(),
            current_str in semver_string(),
            minimum_str in semver_string(),
        ) {
            let installed = if present { Some(current_str.as_str()) } else { None };
            let needs_download = decide_needs_download(installed, &minimum_str);

            let cur = SemVer::parse(&current_str).expect("generated version parses");
            let min = SemVer::parse(&minimum_str).expect("generated minimum parses");
            // Both generated strings are well-formed, so the decision reduces
            // to: absent, or strictly below the minimum.
            let expected = !present || cur < min;

            prop_assert_eq!(needs_download, expected);
        }

        // Part A (corollary): an absent runtime always provisions, regardless
        // of the minimum requested.
        #[test]
        fn prop_absent_runtime_always_provisions(minimum_str in semver_string()) {
            prop_assert!(decide_needs_download(None, &minimum_str));
        }

        // Part B: Monotonicity.
        // If version `a` satisfies a minimum, then every version `b >= a`
        // also satisfies that minimum.
        #[test]
        fn prop_satisfies_minimum_is_monotonic(
            a_str in semver_string(),
            b_str in semver_string(),
            minimum_str in semver_string(),
        ) {
            let a = SemVer::parse(&a_str).expect("generated version parses");
            let b = SemVer::parse(&b_str).expect("generated version parses");
            let min = SemVer::parse(&minimum_str).expect("generated minimum parses");

            if b >= a && a.satisfies_minimum(&min) {
                prop_assert!(b.satisfies_minimum(&min));
            }
        }

        // Part B (corollary): `satisfies_minimum` agrees with `>=` ordering,
        // which is the invariant monotonicity rests on.
        #[test]
        fn prop_satisfies_minimum_matches_ordering(
            current_str in semver_string(),
            minimum_str in semver_string(),
        ) {
            let cur = SemVer::parse(&current_str).expect("generated version parses");
            let min = SemVer::parse(&minimum_str).expect("generated minimum parses");
            prop_assert_eq!(cur.satisfies_minimum(&min), cur >= min);
        }
    }

    #[test]
    fn test_semver_parse_basic() {
        let v = SemVer::parse("20.18.0").unwrap();
        assert_eq!(v.major, 20);
        assert_eq!(v.minor, 18);
        assert_eq!(v.patch, 0);
    }

    #[test]
    fn test_semver_parse_with_v_prefix() {
        let v = SemVer::parse("v20.18.0").unwrap();
        assert_eq!(v.major, 20);
        assert_eq!(v.minor, 18);
        assert_eq!(v.patch, 0);
    }

    #[test]
    fn test_semver_parse_git_style() {
        let v = SemVer::parse("2.47.0.windows.1").unwrap();
        assert_eq!(v.major, 2);
        assert_eq!(v.minor, 47);
        assert_eq!(v.patch, 0);
    }

    #[test]
    fn test_semver_parse_insufficient_parts() {
        assert!(SemVer::parse("20.18").is_none());
        assert!(SemVer::parse("20").is_none());
        assert!(SemVer::parse("").is_none());
    }

    #[test]
    fn test_semver_parse_non_numeric() {
        assert!(SemVer::parse("abc.def.ghi").is_none());
    }

    #[test]
    fn test_semver_comparison() {
        let v20_18_0 = SemVer::parse("20.18.0").unwrap();
        let v20_0_0 = SemVer::parse("20.0.0").unwrap();
        let v19_9_0 = SemVer::parse("19.9.0").unwrap();
        let v21_0_0 = SemVer::parse("21.0.0").unwrap();

        assert!(v20_18_0.satisfies_minimum(&v20_0_0));
        assert!(v20_18_0.satisfies_minimum(&v20_18_0)); // equal satisfies
        assert!(!v19_9_0.satisfies_minimum(&v20_0_0));
        assert!(v21_0_0.satisfies_minimum(&v20_0_0));
    }

    #[test]
    fn test_semver_comparison_patch_level() {
        let v2_47_0 = SemVer::parse("2.47.0").unwrap();
        let v2_40_0 = SemVer::parse("2.40.0").unwrap();
        let v2_39_9 = SemVer::parse("2.39.9").unwrap();

        assert!(v2_47_0.satisfies_minimum(&v2_40_0));
        assert!(!v2_39_9.satisfies_minimum(&v2_40_0));
    }

    #[test]
    fn test_extract_version_node_output() {
        let output = "v20.18.0\n";
        let version = extract_version_from_output(output).unwrap();
        assert_eq!(version, "20.18.0");
    }

    #[test]
    fn test_extract_version_git_output() {
        let output = "git version 2.47.0.windows.1\n";
        let version = extract_version_from_output(output).unwrap();
        assert_eq!(version, "2.47.0");
    }

    #[test]
    fn test_extract_version_empty_output() {
        assert!(extract_version_from_output("").is_none());
        assert!(extract_version_from_output("   ").is_none());
    }

    #[test]
    fn test_extract_version_no_version_found() {
        assert!(extract_version_from_output("no version here").is_none());
    }

    #[test]
    fn test_detect_all_loads_manifest() {
        // This test validates that detect_all() can load the embedded manifest
        // and returns results for each dependency entry.
        let results = detect_all();
        // Should have 2 entries (nodejs, python) from the manifest — Git was
        // dropped and Python added (tasks 7.4/7.5).
        assert_eq!(results.len(), 2);
        // Should be sorted alphabetically: nodejs, python
        assert_eq!(results[0].name, "nodejs");
        assert_eq!(results[1].name, "python");
        // Display names should match manifest
        assert_eq!(results[0].display_name, "Node.js");
        assert_eq!(results[1].display_name, "Python");
        // Minimum versions should match manifest
        assert_eq!(results[0].minimum_version, "20.0.0");
        assert_eq!(results[1].minimum_version, "3.10.0");
    }
}

use serde::Deserialize;
use std::collections::HashMap;

/// Expected schema version for the dependency manifest
const EXPECTED_SCHEMA_VERSION: u32 = 1;

/// Top-level manifest structure
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyManifest {
    pub schema_version: u32,
    pub dependencies: HashMap<String, DependencyEntry>,
}

/// A single dependency entry in the manifest
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyEntry {
    pub display_name: String,
    pub minimum_version: String,
    pub download_url: String,
    pub sha256: String,
    /// Declared payload size from the manifest schema. Deserialized for schema
    /// completeness; not read in-crate now that the Runtimes step performs no
    /// downloads.
    #[allow(dead_code)]
    pub size_bytes: u64,
    pub detection_strategy: DetectionStrategy,
}

/// How to detect if a dependency is already installed
#[derive(Debug, Clone, Deserialize)]
pub struct DetectionStrategy {
    pub path: String,
    pub registry: String,
}

/// Validate a parsed manifest for schema version and required field constraints.
/// Returns a list of all validation errors found (empty list means valid).
pub fn validate_manifest(manifest: &DependencyManifest) -> Vec<String> {
    let mut errors: Vec<String> = Vec::new();

    // Check schema version
    if manifest.schema_version != EXPECTED_SCHEMA_VERSION {
        errors.push(format!(
            "Unsupported schema version: expected {}, found {}",
            EXPECTED_SCHEMA_VERSION, manifest.schema_version
        ));
    }

    // Check that at least one dependency is defined
    if manifest.dependencies.is_empty() {
        errors.push("Manifest contains no dependencies".to_string());
    }

    // Validate each dependency entry
    for (key, entry) in &manifest.dependencies {
        if entry.display_name.trim().is_empty() {
            errors.push(format!(
                "Dependency '{}': displayName must be a non-empty string",
                key
            ));
        }

        if entry.minimum_version.trim().is_empty() {
            errors.push(format!(
                "Dependency '{}': minimumVersion must be a non-empty string",
                key
            ));
        }

        if entry.download_url.trim().is_empty() {
            errors.push(format!(
                "Dependency '{}': downloadUrl must be a non-empty string",
                key
            ));
        } else if !entry.download_url.starts_with("https://") {
            errors.push(format!(
                "Dependency '{}': downloadUrl must start with https:// (got '{}')",
                key, entry.download_url
            ));
        }

        if entry.sha256.trim().is_empty() {
            errors.push(format!(
                "Dependency '{}': sha256 must be a non-empty string",
                key
            ));
        }

        if entry.detection_strategy.path.trim().is_empty() {
            errors.push(format!(
                "Dependency '{}': detectionStrategy.path must be a non-empty string",
                key
            ));
        }

        if entry.detection_strategy.registry.trim().is_empty() {
            errors.push(format!(
                "Dependency '{}': detectionStrategy.registry must be a non-empty string",
                key
            ));
        }
    }

    errors
}

/// Load and validate the dependency manifest from the embedded JSON file.
/// Returns the parsed and validated manifest, or an error describing all issues found.
pub fn load_manifest() -> Result<DependencyManifest, String> {
    let manifest_json = include_str!("../../manifests/dependencies.json");
    let manifest: DependencyManifest = serde_json::from_str(manifest_json)
        .map_err(|e| format!("Failed to parse manifest: {}", e))?;

    let errors = validate_manifest(&manifest);
    if !errors.is_empty() {
        return Err(format!(
            "Manifest validation failed:\n  - {}",
            errors.join("\n  - ")
        ));
    }

    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_manifest_json() -> &'static str {
        r#"{
            "schemaVersion": 1,
            "dependencies": {
                "nodejs": {
                    "displayName": "Node.js",
                    "minimumVersion": "20.0.0",
                    "downloadUrl": "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi",
                    "sha256": "a1b2c3d4e5f6",
                    "sizeBytes": 30000000,
                    "detectionStrategy": {
                        "path": "node --version",
                        "registry": "HKLM\\SOFTWARE\\Node.js\\InstallPath"
                    }
                }
            }
        }"#
    }

    #[test]
    fn test_parse_valid_manifest() {
        let manifest: DependencyManifest =
            serde_json::from_str(valid_manifest_json()).expect("should parse");
        assert_eq!(manifest.schema_version, 1);
        assert_eq!(manifest.dependencies.len(), 1);

        let node = manifest.dependencies.get("nodejs").unwrap();
        assert_eq!(node.display_name, "Node.js");
        assert_eq!(node.minimum_version, "20.0.0");
        assert!(node.download_url.starts_with("https://"));
        assert_eq!(node.sha256, "a1b2c3d4e5f6");
        assert_eq!(node.size_bytes, 30000000);
        assert_eq!(node.detection_strategy.path, "node --version");
    }

    #[test]
    fn test_validate_valid_manifest() {
        let manifest: DependencyManifest =
            serde_json::from_str(valid_manifest_json()).expect("should parse");
        let errors = validate_manifest(&manifest);
        assert!(errors.is_empty(), "Expected no errors, got: {:?}", errors);
    }

    #[test]
    fn test_validate_wrong_schema_version() {
        let json = r#"{
            "schemaVersion": 99,
            "dependencies": {
                "nodejs": {
                    "displayName": "Node.js",
                    "minimumVersion": "20.0.0",
                    "downloadUrl": "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi",
                    "sha256": "abc123",
                    "sizeBytes": 30000000,
                    "detectionStrategy": {
                        "path": "node --version",
                        "registry": "HKLM\\SOFTWARE\\Node.js\\InstallPath"
                    }
                }
            }
        }"#;
        let manifest: DependencyManifest = serde_json::from_str(json).expect("should parse");
        let errors = validate_manifest(&manifest);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("Unsupported schema version"));
        assert!(errors[0].contains("expected 1"));
        assert!(errors[0].contains("found 99"));
    }

    #[test]
    fn test_validate_empty_dependencies() {
        let json = r#"{
            "schemaVersion": 1,
            "dependencies": {}
        }"#;
        let manifest: DependencyManifest = serde_json::from_str(json).expect("should parse");
        let errors = validate_manifest(&manifest);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("no dependencies"));
    }

    #[test]
    fn test_validate_empty_display_name() {
        let json = r#"{
            "schemaVersion": 1,
            "dependencies": {
                "nodejs": {
                    "displayName": "",
                    "minimumVersion": "20.0.0",
                    "downloadUrl": "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi",
                    "sha256": "abc123",
                    "sizeBytes": 30000000,
                    "detectionStrategy": {
                        "path": "node --version",
                        "registry": "HKLM\\SOFTWARE\\Node.js\\InstallPath"
                    }
                }
            }
        }"#;
        let manifest: DependencyManifest = serde_json::from_str(json).expect("should parse");
        let errors = validate_manifest(&manifest);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("displayName"));
        assert!(errors[0].contains("nodejs"));
    }

    #[test]
    fn test_validate_empty_minimum_version() {
        let json = r#"{
            "schemaVersion": 1,
            "dependencies": {
                "git": {
                    "displayName": "Git",
                    "minimumVersion": "   ",
                    "downloadUrl": "https://github.com/git/git.exe",
                    "sha256": "abc123",
                    "sizeBytes": 55000000,
                    "detectionStrategy": {
                        "path": "git --version",
                        "registry": "HKLM\\SOFTWARE\\GitForWindows\\InstallPath"
                    }
                }
            }
        }"#;
        let manifest: DependencyManifest = serde_json::from_str(json).expect("should parse");
        let errors = validate_manifest(&manifest);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("minimumVersion"));
        assert!(errors[0].contains("git"));
    }

    #[test]
    fn test_validate_non_https_url() {
        let json = r#"{
            "schemaVersion": 1,
            "dependencies": {
                "nodejs": {
                    "displayName": "Node.js",
                    "minimumVersion": "20.0.0",
                    "downloadUrl": "http://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi",
                    "sha256": "abc123",
                    "sizeBytes": 30000000,
                    "detectionStrategy": {
                        "path": "node --version",
                        "registry": "HKLM\\SOFTWARE\\Node.js\\InstallPath"
                    }
                }
            }
        }"#;
        let manifest: DependencyManifest = serde_json::from_str(json).expect("should parse");
        let errors = validate_manifest(&manifest);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("downloadUrl"));
        assert!(errors[0].contains("https://"));
    }

    #[test]
    fn test_validate_empty_sha256() {
        let json = r#"{
            "schemaVersion": 1,
            "dependencies": {
                "nodejs": {
                    "displayName": "Node.js",
                    "minimumVersion": "20.0.0",
                    "downloadUrl": "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi",
                    "sha256": "",
                    "sizeBytes": 30000000,
                    "detectionStrategy": {
                        "path": "node --version",
                        "registry": "HKLM\\SOFTWARE\\Node.js\\InstallPath"
                    }
                }
            }
        }"#;
        let manifest: DependencyManifest = serde_json::from_str(json).expect("should parse");
        let errors = validate_manifest(&manifest);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("sha256"));
    }

    #[test]
    fn test_validate_empty_detection_strategy_path() {
        let json = r#"{
            "schemaVersion": 1,
            "dependencies": {
                "nodejs": {
                    "displayName": "Node.js",
                    "minimumVersion": "20.0.0",
                    "downloadUrl": "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi",
                    "sha256": "abc123",
                    "sizeBytes": 30000000,
                    "detectionStrategy": {
                        "path": "",
                        "registry": "HKLM\\SOFTWARE\\Node.js\\InstallPath"
                    }
                }
            }
        }"#;
        let manifest: DependencyManifest = serde_json::from_str(json).expect("should parse");
        let errors = validate_manifest(&manifest);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("detectionStrategy.path"));
    }

    #[test]
    fn test_validate_empty_detection_strategy_registry() {
        let json = r#"{
            "schemaVersion": 1,
            "dependencies": {
                "nodejs": {
                    "displayName": "Node.js",
                    "minimumVersion": "20.0.0",
                    "downloadUrl": "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi",
                    "sha256": "abc123",
                    "sizeBytes": 30000000,
                    "detectionStrategy": {
                        "path": "node --version",
                        "registry": ""
                    }
                }
            }
        }"#;
        let manifest: DependencyManifest = serde_json::from_str(json).expect("should parse");
        let errors = validate_manifest(&manifest);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("detectionStrategy.registry"));
    }

    #[test]
    fn test_validate_multiple_errors_reported() {
        let json = r#"{
            "schemaVersion": 2,
            "dependencies": {
                "nodejs": {
                    "displayName": "",
                    "minimumVersion": "",
                    "downloadUrl": "http://bad-url.com/file",
                    "sha256": "",
                    "sizeBytes": 30000000,
                    "detectionStrategy": {
                        "path": "",
                        "registry": ""
                    }
                }
            }
        }"#;
        let manifest: DependencyManifest = serde_json::from_str(json).expect("should parse");
        let errors = validate_manifest(&manifest);

        // Should report schema version + all field errors (not stop at first)
        assert!(
            errors.len() >= 6,
            "Expected at least 6 errors, got: {:?}",
            errors
        );

        // Verify it reports the schema version error
        assert!(errors.iter().any(|e| e.contains("schema version")));
        // Verify it reports field-level errors
        assert!(errors.iter().any(|e| e.contains("displayName")));
        assert!(errors.iter().any(|e| e.contains("minimumVersion")));
        assert!(errors.iter().any(|e| e.contains("downloadUrl")));
        assert!(errors.iter().any(|e| e.contains("sha256")));
        assert!(errors.iter().any(|e| e.contains("detectionStrategy.path")));
        assert!(errors
            .iter()
            .any(|e| e.contains("detectionStrategy.registry")));
    }

    #[test]
    fn test_load_manifest_succeeds_with_embedded_file() {
        // This test validates that the actual embedded manifest parses and validates.
        // It uses the real dependencies.json via include_str!.
        let result = load_manifest();
        assert!(result.is_ok(), "load_manifest failed: {:?}", result.err());

        let manifest = result.unwrap();
        assert_eq!(manifest.schema_version, EXPECTED_SCHEMA_VERSION);
        assert!(!manifest.dependencies.is_empty());
    }

    #[test]
    fn test_parse_missing_required_field() {
        // Missing sha256 field entirely should fail at deserialization
        let json = r#"{
            "schemaVersion": 1,
            "dependencies": {
                "nodejs": {
                    "displayName": "Node.js",
                    "minimumVersion": "20.0.0",
                    "downloadUrl": "https://nodejs.org/node.msi",
                    "sizeBytes": 30000000,
                    "detectionStrategy": {
                        "path": "node --version",
                        "registry": "HKLM\\SOFTWARE\\Node.js"
                    }
                }
            }
        }"#;
        let result: Result<DependencyManifest, _> = serde_json::from_str(json);
        assert!(result.is_err(), "Should fail to parse without sha256 field");
    }
}

// ---------------------------------------------------------------------------
// Preservation property tests
//
// Feature: windows-installer-setup-exe
// Task 7.2 — Lock the manifest schema parse/validate behavior BEFORE editing
//            the dependency set (task 7.4 removes Git and adds Python).
//
// These properties assert the parse/validate CONTRACT independent of which
// specific dependencies are present, so that changing the dependency set in
// `manifests/dependencies.json` cannot silently alter the schema semantics.
//
// _Requirements: 4.1_
// ---------------------------------------------------------------------------
#[cfg(test)]
mod preservation_property_tests {
    use super::*;
    use proptest::collection::hash_map;
    use proptest::prelude::*;
    use serde_json::{json, Value};

    /// Non-empty, non-whitespace token generator (safe as a JSON string value
    /// and as a map key). Restricted to characters that don't need escaping.
    fn non_blank_token() -> impl Strategy<Value = String> {
        "[A-Za-z0-9_.\\- ]+"
            .prop_filter("must have non-whitespace content", |s| !s.trim().is_empty())
    }

    /// A single well-formed dependency entry as a JSON object.
    fn valid_entry_json() -> impl Strategy<Value = Value> {
        (
            non_blank_token(), // displayName
            non_blank_token(), // minimumVersion
            non_blank_token(), // downloadUrl suffix (prefixed with https://)
            non_blank_token(), // sha256
            any::<u64>(),      // sizeBytes
            non_blank_token(), // detectionStrategy.path
            non_blank_token(), // detectionStrategy.registry
        )
            .prop_map(|(name, min, url, sha, size, path, reg)| {
                json!({
                    "displayName": name,
                    "minimumVersion": min,
                    "downloadUrl": format!("https://{}", url),
                    "sha256": sha,
                    "sizeBytes": size,
                    "detectionStrategy": { "path": path, "registry": reg }
                })
            })
    }

    /// A well-formed manifest with an arbitrary (non-empty) set of dependencies.
    fn valid_manifest_json_value() -> impl Strategy<Value = Value> {
        hash_map(non_blank_token(), valid_entry_json(), 1..6).prop_map(|deps| {
            json!({
                "schemaVersion": 1,
                "dependencies": Value::Object(deps.into_iter().collect())
            })
        })
    }

    fn parse(value: &Value) -> DependencyManifest {
        serde_json::from_value(value.clone()).expect("well-formed manifest should parse")
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        /// Property: any well-formed manifest with schemaVersion 1 and at least
        /// one dependency parses AND validates with zero errors, regardless of
        /// which dependency keys/values are present.
        #[test]
        fn wellformed_manifest_parses_and_validates_clean(value in valid_manifest_json_value()) {
            let manifest = parse(&value);
            prop_assert_eq!(manifest.schema_version, EXPECTED_SCHEMA_VERSION);
            prop_assert!(!manifest.dependencies.is_empty());
            let errors = validate_manifest(&manifest);
            prop_assert!(errors.is_empty(), "expected no errors, got: {:?}", errors);
        }

        /// Property: an unexpected schema version always yields exactly one
        /// schema-version error, independent of the dependency set (which is
        /// otherwise well-formed and would produce no field errors).
        #[test]
        fn wrong_schema_version_reports_single_schema_error(
            value in valid_manifest_json_value(),
            bad_version in (2u32..1000),
        ) {
            let mut value = value;
            value["schemaVersion"] = json!(bad_version);
            let manifest = parse(&value);
            let errors = validate_manifest(&manifest);
            prop_assert_eq!(errors.len(), 1);
            prop_assert!(errors[0].contains("Unsupported schema version"));
            prop_assert!(errors[0].contains("found"));
        }

        /// Property: an empty dependency set always yields exactly the
        /// "no dependencies" error under a valid schema version.
        #[test]
        fn empty_dependencies_reports_no_dependencies(schema in prop::sample::select(vec![1u32])) {
            let value = json!({ "schemaVersion": schema, "dependencies": {} });
            let manifest = parse(&value);
            let errors = validate_manifest(&manifest);
            prop_assert_eq!(errors.len(), 1);
            prop_assert!(errors[0].contains("no dependencies"));
        }

        /// Property: blanking any single required string field of any single
        /// dependency yields an error that both names the offending dependency
        /// key and identifies the offending field — for any dependency set.
        #[test]
        fn blank_required_field_is_attributed_to_dependency(
            value in valid_manifest_json_value(),
            field_choice in 0usize..6,
        ) {
            // Field selectors and the substring the error must contain.
            let (json_path, needle): (&[&str], &str) = match field_choice {
                0 => (&["displayName"], "displayName"),
                1 => (&["minimumVersion"], "minimumVersion"),
                2 => (&["sha256"], "sha256"),
                3 => (&["detectionStrategy", "path"], "detectionStrategy.path"),
                4 => (&["detectionStrategy", "registry"], "detectionStrategy.registry"),
                _ => (&["downloadUrl"], "downloadUrl"),
            };

            let mut value = value;
            // Pick the first dependency key deterministically.
            let dep_key: String = value["dependencies"]
                .as_object()
                .unwrap()
                .keys()
                .next()
                .unwrap()
                .clone();

            {
                let entry = value["dependencies"]
                    .get_mut(&dep_key)
                    .unwrap();
                let mut cursor = entry;
                for seg in &json_path[..json_path.len() - 1] {
                    cursor = cursor.get_mut(*seg).unwrap();
                }
                cursor[json_path[json_path.len() - 1]] = json!("   ");
            }

            let manifest = parse(&value);
            let errors = validate_manifest(&manifest);
            prop_assert!(
                errors.iter().any(|e| e.contains(needle) && e.contains(&dep_key)),
                "expected an error naming field '{}' and dependency '{}', got: {:?}",
                needle, dep_key, errors
            );
        }

        /// Property: a non-https downloadUrl on any single dependency always
        /// produces the https-scheme error attributed to that dependency,
        /// regardless of the rest of the dependency set.
        #[test]
        fn non_https_download_url_is_rejected(
            value in valid_manifest_json_value(),
            host in non_blank_token(),
        ) {
            let mut value = value;
            let dep_key: String = value["dependencies"]
                .as_object()
                .unwrap()
                .keys()
                .next()
                .unwrap()
                .clone();
            value["dependencies"][&dep_key]["downloadUrl"] =
                json!(format!("http://{}", host));

            let manifest = parse(&value);
            let errors = validate_manifest(&manifest);
            prop_assert!(
                errors.iter().any(|e| e.contains("downloadUrl")
                    && e.contains("https://")
                    && e.contains(&dep_key)),
                "expected an https error for dependency '{}', got: {:?}",
                dep_key, errors
            );
        }

        /// Property: dropping any required field from an entry makes the
        /// manifest fail to PARSE (before validation), for any dependency set.
        #[test]
        fn missing_required_field_fails_to_parse(
            value in valid_manifest_json_value(),
            field_choice in 0usize..5,
        ) {
            let field = ["displayName", "minimumVersion", "downloadUrl", "sha256", "detectionStrategy"][field_choice];
            let mut value = value;
            let dep_key: String = value["dependencies"]
                .as_object()
                .unwrap()
                .keys()
                .next()
                .unwrap()
                .clone();
            value["dependencies"][&dep_key]
                .as_object_mut()
                .unwrap()
                .remove(field);

            let result: Result<DependencyManifest, _> = serde_json::from_value(value);
            prop_assert!(result.is_err(), "removing '{}' should fail parsing", field);
        }
    }
}

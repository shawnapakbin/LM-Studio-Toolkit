//! Canonical MCP tool payload descriptor.
//!
//! This module is the single, checked-in source of truth for *which* MCP tools
//! ship inside the installer and *where* each tool's prebuilt `dist` output
//! lives relative to the repository root. It is shared by:
//!
//! - the build-time completeness check (payload staging must find all 9 trees),
//! - the install-time copy verification (all 9 outputs must be present after copy).
//!
//! The list mirrors `scripts/workspace/mcp-config.js` exactly. Each `dist_root`
//! is the parent directory of that server's emitted entry script
//! (`relativeScript` with the trailing `mcp-server.js` / `schema-proxy.js`
//! removed). Keeping this list here — rather than re-deriving it at runtime —
//! prevents drift between the bundled payload and the LM Studio provisioning
//! step, both of which key off the same 9 server names.
//!
//! Requirements: 3.1 (payload embeds the 9 tool dist trees), 3.2 (single
//! canonical source shared by build-time and install-time paths).

// The bundle planner (task 3.1) and install-time verifier are the first
// consumers of this data. Until they land, the public list is referenced only
// by tests, so silence dead-code warnings for this source-of-truth module.
#![allow(dead_code)]

/// A single MCP tool's contribution to the bundled payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolPayload {
    /// The MCP server name, e.g. `"terminal"`, `"3dtool"`, `"file-editor"`.
    /// Matches the server key in `scripts/workspace/mcp-config.js` and the
    /// per-server LM Studio plugin directory name.
    pub server_name: &'static str,
    /// The tool's prebuilt output directory, relative to the repository root,
    /// e.g. `"Terminal/dist"`, `"FileEditor/dist/FileEditor/src"`.
    pub dist_root: &'static str,
}

/// The number of canonical MCP tools bundled into the installer.
pub const CANONICAL_TOOL_COUNT: usize = 9;

/// The canonical 9 MCP tools: server name -> relative `dist` root.
///
/// Derived from `scripts/workspace/mcp-config.js`. The order matches the source
/// config for readability; consumers that need a deterministic ordering (e.g.
/// the `missing` set) sort explicitly rather than relying on this order.
pub const CANONICAL_TOOL_PAYLOADS: [ToolPayload; CANONICAL_TOOL_COUNT] = [
    ToolPayload { server_name: "terminal", dist_root: "Terminal/dist" },
    ToolPayload { server_name: "web-browser", dist_root: "WebBrowser/dist" },
    ToolPayload { server_name: "common", dist_root: "mcp/common/dist" },
    ToolPayload { server_name: "browserless", dist_root: "Browserless/scripts" },
    ToolPayload { server_name: "python-shell", dist_root: "PythonShell/dist" },
    ToolPayload { server_name: "skills", dist_root: "Skills/dist" },
    ToolPayload { server_name: "blender-bridge", dist_root: "BlenderBridge/dist" },
    ToolPayload { server_name: "3dtool", dist_root: "3DTool/dist" },
    ToolPayload {
        server_name: "lan-sub-agent",
        dist_root: "LanSubAgent/dist/LanSubAgent/src",
    },
];

/// Returns the canonical list of the 9 MCP tool payloads.
///
/// This is the entry point other modules (bundle planner, install-time
/// verifier) call so they never hard-code the list themselves.
pub fn canonical_payloads() -> &'static [ToolPayload] {
    &CANONICAL_TOOL_PAYLOADS
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn canonical_list_has_exactly_nine_tools() {
        assert_eq!(CANONICAL_TOOL_PAYLOADS.len(), CANONICAL_TOOL_COUNT);
        assert_eq!(canonical_payloads().len(), 9);
    }

    #[test]
    fn server_names_are_unique() {
        let names: HashSet<&str> = canonical_payloads().iter().map(|t| t.server_name).collect();
        assert_eq!(
            names.len(),
            CANONICAL_TOOL_COUNT,
            "server names must be unique"
        );
    }

    #[test]
    fn dist_roots_are_unique() {
        let roots: HashSet<&str> = canonical_payloads().iter().map(|t| t.dist_root).collect();
        assert_eq!(
            roots.len(),
            CANONICAL_TOOL_COUNT,
            "dist roots must be unique"
        );
    }

    #[test]
    fn server_names_match_mcp_config() {
        // Cross-source assertion (feature retire-and-gate-mcp-servers, Property 1):
        // the Rust_Payload_List must agree with BOTH the Registration_Source
        // (`scripts/workspace/mcp-config.js`) AND the live Env_Key_Map
        // (`config_gen.rs` `CANONICAL_ENV_KEYS`). Comparing against the live env-key
        // mirror as well as the hardcoded registration mirror turns this from a
        // single-source check into a genuine cross-source agreement check.
        //
        // The `expected` set mirrors the nine Shipped server names in
        // `mcp-config.js` (Retired + Unshipped entries pruned in lock-step with
        // that file).
        let expected: HashSet<&str> = [
            "terminal",
            "web-browser",
            "common",
            "browserless",
            "python-shell",
            "skills",
            "blender-bridge",
            "3dtool",
            "lan-sub-agent",
        ]
        .into_iter()
        .collect();

        let rust_payload_names: HashSet<&str> =
            canonical_payloads().iter().map(|t| t.server_name).collect();
        assert_eq!(
            rust_payload_names, expected,
            "Rust_Payload_List names must match the Registration_Source (mcp-config.js)"
        );

        let env_key_names: HashSet<&str> = crate::config_gen::CANONICAL_ENV_KEYS
            .iter()
            .map(|(name, _)| *name)
            .collect();
        assert_eq!(
            env_key_names, expected,
            "Env_Key_Map (config_gen.rs CANONICAL_ENV_KEYS) must match the Registration_Source"
        );
    }

    #[test]
    fn dist_roots_match_mcp_config_relative_scripts() {
        // dist_root is the parent dir of each server's relativeScript in
        // scripts/workspace/mcp-config.js (trailing entry file removed).
        let expected: &[(&str, &str)] = &[
            ("terminal", "Terminal/dist"),
            ("web-browser", "WebBrowser/dist"),
            ("common", "mcp/common/dist"),
            ("browserless", "Browserless/scripts"),
            ("python-shell", "PythonShell/dist"),
            ("skills", "Skills/dist"),
            ("blender-bridge", "BlenderBridge/dist"),
            ("3dtool", "3DTool/dist"),
            ("lan-sub-agent", "LanSubAgent/dist/LanSubAgent/src"),
        ];

        for (server_name, dist_root) in expected {
            let found = canonical_payloads()
                .iter()
                .find(|t| t.server_name == *server_name)
                .unwrap_or_else(|| panic!("missing server {server_name}"));
            assert_eq!(
                found.dist_root, *dist_root,
                "dist_root mismatch for {server_name}"
            );
        }
    }
}

/// Property 1 — source-of-truth set agreement (feature `retire-and-gate-mcp-servers`).
///
/// This module holds the single cross-source property test for the feature's
/// central invariant: the four canonical source-of-truth mirrors must all
/// define the *same* server-name set, and that set must be exactly the nine
/// Shipped servers.
///
/// The four mirrors (per `requirements.md` glossary / `design.md` §Architecture):
///   1. Registration_Source — `scripts/workspace/mcp-config.js` `servers` keys.
///   2. Payload_Manifest     — `Installer/scripts/payload-manifest.ts`
///                              `CANONICAL_TOOL_PAYLOADS[].serverName`.
///   3. Rust_Payload_List    — this crate's `CANONICAL_TOOL_PAYLOADS[].server_name`.
///   4. Env_Key_Map          — `Installer/src-tauri/src/config_gen.rs`
///                              `CANONICAL_ENV_KEYS` names.
///
/// Mirrors 3 and 4 are *live* (imported and read directly, so drift is caught).
/// Mirrors 1 and 2 live in JS/TS files that Rust cannot import, so they are
/// represented here as checked-in literal sets that must be kept byte-for-byte
/// in step with their source files (the existing `server_names_match_mcp_config`
/// test already relies on this same mirroring convention for `mcp-config.js`).
///
/// ── Sequencing note (post-prune, tasks 2.1–2.4) ─────────────────────────────
/// All four mirrors are being pruned to the nine Shipped names in lock-step:
/// this crate's Rust_Payload_List and the two literal mirrors below
/// (`REGISTRATION_SOURCE_NAMES`, `PAYLOAD_MANIFEST_NAMES`) reflect the nine, as
/// does the Env_Key_Map (`config_gen.rs` `CANONICAL_ENV_KEYS`, pruned by task
/// 2.4). Therefore:
///
///   * `all_four_mirrors_agree_with_each_other` holds once every mirror has been
///     trimmed to the same nine names (until task 2.4 lands, the live Env_Key_Map
///     may still list more, and this test surfaces that drift by design).
///   * `agreed_set_equals_the_nine_shipped` holds once each mirror defines exactly
///     the nine Shipped names — no Retired/Unshipped name present, none missing.
///
/// The two literal mirrors (`REGISTRATION_SOURCE_NAMES`, `PAYLOAD_MANIFEST_NAMES`)
/// MUST stay in lock-step with their JS/TS source files, exactly as
/// `server_names_match_mcp_config` mirrors `mcp-config.js`.
#[cfg(test)]
mod property_source_of_truth_agreement {
    use super::*;
    use crate::config_gen::CANONICAL_ENV_KEYS;
    use proptest::prelude::*;
    use std::collections::BTreeSet;

    /// The nine Shipped server names — the canonical target set the four mirrors
    /// must agree on after the prune (design.md §Data Models "Final SHIPPED list").
    const SHIPPED_NINE: [&str; 9] = [
        "terminal",
        "web-browser",
        "common",
        "browserless",
        "python-shell",
        "skills",
        "blender-bridge",
        "3dtool",
        "lan-sub-agent",
    ];

    /// Literal mirror of `scripts/workspace/mcp-config.js` `servers` keys.
    /// KEEP IN SYNC with that file. Trimmed to `SHIPPED_NINE` in lock-step with
    /// the registration-source prune (Retired + Unshipped removed).
    const REGISTRATION_SOURCE_NAMES: &[&str] = &[
        "terminal",
        "web-browser",
        "common",
        "browserless",
        "python-shell",
        "skills",
        "blender-bridge",
        "3dtool",
        "lan-sub-agent",
    ];

    /// Literal mirror of `Installer/scripts/payload-manifest.ts`
    /// `CANONICAL_TOOL_PAYLOADS[].serverName`.
    /// KEEP IN SYNC with that file. Trimmed to `SHIPPED_NINE` in lock-step with
    /// the payload-manifest prune (Retired + Unshipped removed).
    const PAYLOAD_MANIFEST_NAMES: &[&str] = &[
        "terminal",
        "web-browser",
        "common",
        "browserless",
        "python-shell",
        "skills",
        "blender-bridge",
        "3dtool",
        "lan-sub-agent",
    ];

    fn registration_source_set() -> BTreeSet<&'static str> {
        REGISTRATION_SOURCE_NAMES.iter().copied().collect()
    }

    fn payload_manifest_set() -> BTreeSet<&'static str> {
        PAYLOAD_MANIFEST_NAMES.iter().copied().collect()
    }

    fn rust_payload_list_set() -> BTreeSet<&'static str> {
        canonical_payloads().iter().map(|t| t.server_name).collect()
    }

    fn env_key_map_set() -> BTreeSet<&'static str> {
        CANONICAL_ENV_KEYS.iter().map(|(name, _)| *name).collect()
    }

    /// The four mirrors, indexable so the property can range over every pair.
    fn all_mirrors() -> [(&'static str, BTreeSet<&'static str>); 4] {
        [
            ("Registration_Source", registration_source_set()),
            ("Payload_Manifest", payload_manifest_set()),
            ("Rust_Payload_List", rust_payload_list_set()),
            ("Env_Key_Map", env_key_map_set()),
        ]
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        // Feature: retire-and-gate-mcp-servers, Property 1: source-of-truth set
        // agreement equals the nine Shipped servers.
        //
        // For all ordered pairs (i, j) of the four mirrors, mirror i's server-name
        // set equals mirror j's — i.e. all four define one identical set. Ranging
        // the property over arbitrary index pairs (rather than a single equality
        // chain) exercises the pairwise-agreement invariant across >=100 cases.
        //
        // EXPECTED STATE: PASSES once every mirror is pruned to the same nine
        // (may transiently fail against the live Env_Key_Map until task 2.4 lands).
        #[test]
        fn all_four_mirrors_agree_with_each_other(i in 0usize..4, j in 0usize..4) {
            let mirrors = all_mirrors();
            let (name_i, set_i) = &mirrors[i];
            let (name_j, set_j) = &mirrors[j];
            prop_assert_eq!(
                set_i,
                set_j,
                "source-of-truth mirror disagreement: {} defines {:?} but {} defines {:?}",
                name_i,
                set_i,
                name_j,
                set_j
            );
        }

        // Feature: retire-and-gate-mcp-servers, Property 1: source-of-truth set
        // agreement equals the nine Shipped servers.
        //
        // For all four mirrors (ranged by arbitrary index), the mirror's set equals
        // exactly the nine Shipped names — no Retired/Unshipped name present, none of
        // the nine missing.
        //
        // EXPECTED STATE: PASSES once tasks 2.1–2.4 prune every mirror to the nine
        // Shipped names (the live Env_Key_Map lands with task 2.4).
        #[test]
        fn agreed_set_equals_the_nine_shipped(i in 0usize..4) {
            let expected: BTreeSet<&str> = SHIPPED_NINE.into_iter().collect();
            let mirrors = all_mirrors();
            let (name, set) = &mirrors[i];
            prop_assert_eq!(
                set,
                &expected,
                "{} must define exactly the nine Shipped servers, but defines {:?}",
                name,
                set
            );
        }
    }
}

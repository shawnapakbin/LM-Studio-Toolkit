//! Canonical MCP tool payload descriptor.
//!
//! This module is the single, checked-in source of truth for *which* MCP tools
//! ship inside the installer and *where* each tool's prebuilt `dist` output
//! lives relative to the repository root. It is shared by:
//!
//! - the build-time completeness check (payload staging must find all 16 trees),
//! - the install-time copy verification (all 16 outputs must be present after copy).
//!
//! The list mirrors `scripts/workspace/mcp-config.js` exactly. Each `dist_root`
//! is the parent directory of that server's emitted entry script
//! (`relativeScript` with the trailing `mcp-server.js` / `schema-proxy.js`
//! removed). Keeping this list here — rather than re-deriving it at runtime —
//! prevents drift between the bundled payload and the LM Studio provisioning
//! step, both of which key off the same 16 server names.
//!
//! Requirements: 3.1 (payload embeds the 16 tool dist trees), 3.2 (single
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
pub const CANONICAL_TOOL_COUNT: usize = 16;

/// The canonical 16 MCP tools: server name -> relative `dist` root.
///
/// Derived from `scripts/workspace/mcp-config.js`. The order matches the source
/// config for readability; consumers that need a deterministic ordering (e.g.
/// the `missing` set) sort explicitly rather than relying on this order.
pub const CANONICAL_TOOL_PAYLOADS: [ToolPayload; CANONICAL_TOOL_COUNT] = [
    ToolPayload { server_name: "terminal", dist_root: "Terminal/dist" },
    ToolPayload { server_name: "web-browser", dist_root: "WebBrowser/dist" },
    ToolPayload { server_name: "common", dist_root: "mcp/common/dist" },
    ToolPayload { server_name: "browserless", dist_root: "Browserless/scripts" },
    ToolPayload { server_name: "rag", dist_root: "RAG/dist" },
    ToolPayload { server_name: "python-shell", dist_root: "PythonShell/dist" },
    ToolPayload { server_name: "skills", dist_root: "Skills/dist" },
    ToolPayload { server_name: "slash-commands", dist_root: "SlashCommands/dist" },
    ToolPayload { server_name: "blender-bridge", dist_root: "BlenderBridge/dist" },
    ToolPayload { server_name: "3dtool", dist_root: "3DTool/dist" },
    ToolPayload { server_name: "sub-agent", dist_root: "SubAgent/dist" },
    ToolPayload {
        server_name: "lan-sub-agent",
        dist_root: "LanSubAgent/dist/LanSubAgent/src",
    },
    ToolPayload { server_name: "git", dist_root: "Git/dist/Git/src" },
    ToolPayload {
        server_name: "package-manager",
        dist_root: "PackageManager/dist/PackageManager/src",
    },
    ToolPayload { server_name: "csv-exporter", dist_root: "CSVExporter/dist" },
    ToolPayload {
        server_name: "file-editor",
        dist_root: "FileEditor/dist/FileEditor/src",
    },
];

/// Returns the canonical list of the 16 MCP tool payloads.
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
    fn canonical_list_has_exactly_sixteen_tools() {
        assert_eq!(CANONICAL_TOOL_PAYLOADS.len(), CANONICAL_TOOL_COUNT);
        assert_eq!(canonical_payloads().len(), 16);
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
        // The exact 16 server names from scripts/workspace/mcp-config.js.
        let expected: HashSet<&str> = [
            "terminal",
            "web-browser",
            "common",
            "browserless",
            "rag",
            "python-shell",
            "skills",
            "slash-commands",
            "blender-bridge",
            "3dtool",
            "sub-agent",
            "lan-sub-agent",
            "git",
            "package-manager",
            "csv-exporter",
            "file-editor",
        ]
        .into_iter()
        .collect();

        let actual: HashSet<&str> = canonical_payloads().iter().map(|t| t.server_name).collect();
        assert_eq!(actual, expected);
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
            ("rag", "RAG/dist"),
            ("python-shell", "PythonShell/dist"),
            ("skills", "Skills/dist"),
            ("slash-commands", "SlashCommands/dist"),
            ("blender-bridge", "BlenderBridge/dist"),
            ("3dtool", "3DTool/dist"),
            ("sub-agent", "SubAgent/dist"),
            ("lan-sub-agent", "LanSubAgent/dist/LanSubAgent/src"),
            ("git", "Git/dist/Git/src"),
            ("package-manager", "PackageManager/dist/PackageManager/src"),
            ("csv-exporter", "CSVExporter/dist"),
            ("file-editor", "FileEditor/dist/FileEditor/src"),
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

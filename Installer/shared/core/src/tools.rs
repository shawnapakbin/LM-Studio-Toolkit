use serde::{Deserialize, Serialize};

/// A single MCP tool ported from the legacy installer's `TOOL_DESCRIPTORS`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDescriptor {
    pub id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "relativeScript")]
    pub relative_script: String,
    #[serde(default)]
    pub env: std::collections::BTreeMap<String, String>,
}

/// Loads the bundled `tools.json` shipped next to the installer binary.
pub fn load_bundled() -> Result<Vec<ToolDescriptor>, anyhow::Error> {
    let raw = include_str!("../../tools.json");
    let parsed: Vec<ToolDescriptor> = serde_json::from_str(raw)?;
    Ok(parsed)
}

/// The bridge config written into LM Studio's `mcp.json` and per-plugin folders.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeConfig {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub env: std::collections::BTreeMap<String, String>,
}

pub fn build_bridge_config(
    install_root: &std::path::Path,
    tool: &ToolDescriptor,
    node_path: &str,
) -> BridgeConfig {
    let script = install_root.join(&tool.relative_script);
    BridgeConfig {
        command: node_path.replace('\\', "/"),
        args: vec![script.to_string_lossy().replace('\\', "/")],
        cwd: install_root.to_string_lossy().replace('\\', "/"),
        env: tool.env.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_tools_parse() {
        let tools = load_bundled().expect("tools.json must parse");
        assert!(!tools.is_empty(), "expected at least one tool");
        for t in &tools {
            assert!(!t.id.is_empty());
            assert!(!t.relative_script.is_empty());
        }
    }

    #[test]
    fn bridge_config_uses_forward_slashes() {
        let tool = ToolDescriptor {
            id: "terminal".into(),
            display_name: "Terminal".into(),
            relative_script: "Terminal/dist/mcp-server.js".into(),
            env: Default::default(),
        };
        let cfg = build_bridge_config(
            std::path::Path::new(r"C:\Program Files\expDigit Studio\LLM Toolkit"),
            &tool,
            r"C:\Program Files\nodejs\node.exe",
        );
        assert!(!cfg.command.contains('\\'));
        assert!(!cfg.args[0].contains('\\'));
        assert!(!cfg.cwd.contains('\\'));
    }
}

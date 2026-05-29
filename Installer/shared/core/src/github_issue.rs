use crate::diagnostics::DiagnosticReport;
use crate::{ISSUE_REPO_NAME, ISSUE_REPO_OWNER};

/// GitHub caps issue URL body at ~8 KB once URL-encoded; we conservatively
/// truncate the embedded body to leave headroom for the title + scaffolding.
const MAX_BODY_LEN: usize = 6000;

pub fn build_issue_url(report: &DiagnosticReport, report_path: Option<&std::path::Path>) -> String {
    let phase = report
        .current_phase
        .map(|p| format!("{:?}", p))
        .unwrap_or_else(|| "unknown".into());
    let title = format!("Installer failure: {phase}");
    let body = compose_body(report, report_path);

    let mut url = format!(
        "https://github.com/{}/{}/issues/new",
        ISSUE_REPO_OWNER, ISSUE_REPO_NAME
    );
    url.push_str("?title=");
    url.push_str(&urlencode(&title));
    url.push_str("&body=");
    url.push_str(&urlencode(&body));
    url.push_str("&labels=installer,bug");
    url
}

fn compose_body(report: &DiagnosticReport, report_path: Option<&std::path::Path>) -> String {
    let mut body = String::new();
    body.push_str("## Installer crash report\n\n");
    body.push_str(&format!("- **Installer version:** {}\n", report.installer_version));
    body.push_str(&format!("- **OS:** {} ({}) {}\n", report.os, report.arch, report.os_version));
    body.push_str(&format!("- **Generated:** {}\n", report.generated_at));
    if let Some(scope) = &report.install_scope {
        body.push_str(&format!("- **Scope:** {scope}\n"));
    }
    if let Some(root) = &report.install_root {
        body.push_str(&format!("- **Install root:** `{}`\n", root.display()));
    }
    if let Some(err) = &report.error {
        body.push_str("\n## Error\n");
        body.push_str(&format!(
            "- **Phase:** {:?}\n- **Kind:** {:?}\n- **Message:** {}\n",
            err.phase, err.kind, err.message
        ));
        if !err.cause_chain.is_empty() {
            body.push_str("\n**Causes:**\n");
            for cause in &err.cause_chain {
                body.push_str(&format!("- {cause}\n"));
            }
        }
    }
    if let Some(p) = report_path {
        body.push_str(&format!(
            "\n## Diagnostic file\n\nPlease attach this file when submitting:\n\n`{}`\n",
            p.display()
        ));
    }
    body.push_str("\n## Recent logs (tail)\n\n```\n");
    let tail: Vec<&String> = report.logs.iter().rev().take(40).collect();
    for line in tail.iter().rev() {
        body.push_str(line);
        body.push('\n');
    }
    body.push_str("```\n");

    if body.len() > MAX_BODY_LEN {
        body.truncate(MAX_BODY_LEN);
        body.push_str("\n…(truncated; see attached diagnostic file)\n");
    }
    body
}

fn urlencode(input: &str) -> String {
    // Minimal RFC 3986 encoder for issue title/body. Avoids pulling in `url` crate at call site.
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics;

    #[test]
    fn url_contains_repo_and_title() {
        let report = diagnostics::build_report(None, Some(crate::error::Phase::Build), None, None);
        let url = build_issue_url(&report, None);
        assert!(url.contains("shawnapakbin/llm-toolkit-by-shawna"));
        assert!(url.contains("title=Installer%20failure%3A%20Build"));
        assert!(url.contains("labels=installer"));
    }

    #[test]
    fn encoder_handles_special_chars() {
        assert_eq!(urlencode("a b/c?"), "a%20b%2Fc%3F");
    }
}

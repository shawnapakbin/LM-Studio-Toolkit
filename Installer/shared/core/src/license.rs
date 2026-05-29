use crate::error::{InstallError, InstallErrorKind, Phase};

/// Bundled license text. Updated by the build script copying `repo/LICENSE`
/// into `Installer/shared/assets/LICENSE`.
const LICENSE_TEXT: &str = include_str!("../../assets/LICENSE");

pub fn get_license_text() -> &'static str {
    LICENSE_TEXT
}

/// Acceptance gate. The UI must record both the user's checkbox AND a
/// scroll-to-bottom event before invoking this. Backend re-checks to prevent
/// a renderer bypass.
#[derive(Debug, Clone, Copy, Default, serde::Serialize, serde::Deserialize)]
pub struct LicenseAcceptance {
    pub checkbox_checked: bool,
    pub scrolled_to_bottom: bool,
}

pub fn validate(acceptance: &LicenseAcceptance) -> Result<(), InstallError> {
    if !(acceptance.checkbox_checked && acceptance.scrolled_to_bottom) {
        return Err(InstallError::fatal(
            Phase::License,
            InstallErrorKind::InvalidInput,
            "License must be scrolled to the end and explicitly accepted before continuing.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn license_text_is_non_empty() {
        assert!(!get_license_text().trim().is_empty());
    }

    #[test]
    fn rejects_unchecked() {
        let acc = LicenseAcceptance {
            checkbox_checked: false,
            scrolled_to_bottom: true,
        };
        assert!(validate(&acc).is_err());
    }

    #[test]
    fn rejects_unscrolled() {
        let acc = LicenseAcceptance {
            checkbox_checked: true,
            scrolled_to_bottom: false,
        };
        assert!(validate(&acc).is_err());
    }

    #[test]
    fn accepts_both() {
        let acc = LicenseAcceptance {
            checkbox_checked: true,
            scrolled_to_bottom: true,
        };
        assert!(validate(&acc).is_ok());
    }
}

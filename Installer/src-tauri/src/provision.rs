//! Runtimes provisioning decision core + IO seam (Req 4, 5, 6).
//!
//! This module holds the *pure* decision core for the installer's Runtimes
//! step — the data types describing the host's runtime dependencies, how they
//! classify against a minimum version, and the ordered plan of provisioning
//! actions derived from that classification — together with the injectable
//! [`ElevatedShell`] IO seam.
//!
//! The seam exists so the decision core (and the tests that exercise it) never
//! touch the network or require administrator rights: probing the host, running
//! elevated provisioning commands, and spawning plugins for post-install
//! verification are all funnelled through the trait. Production code supplies a
//! real (PowerShell-backed) implementation; tests supply a recording shell with
//! an injected clock.
//!
//! This file (task 7.1) declares the data types and the trait seam. The pure
//! functions that consume them — `classify_dependency` (7.2),
//! `plan_provisioning` (7.4), and `aggregate_verification` (7.7) — are
//! implemented in their own follow-up tasks.

use std::path::Path;
use std::time::Duration;

use crate::dependency::SemVer;
use crate::tool_payload::CANONICAL_TOOL_COUNT;

/// One dependency's identity — the three Runtime_Dependency classes the
/// installer probes and, when missing, provisions (Req 4.1–4.3).
///
/// * [`Node`](RuntimeDependency::Node) — the Node.js runtime.
/// * [`NpmDeps`](RuntimeDependency::NpmDeps) — the toolkit's production npm
///   dependencies under `install_dir`.
/// * [`PlaywrightChromium`](RuntimeDependency::PlaywrightChromium) — the
///   Chromium browser Playwright drives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeDependency {
    Node,
    NpmDeps,
    PlaywrightChromium,
}

/// The raw result of probing the host for one [`RuntimeDependency`].
///
/// Produced by the [`ElevatedShell`] IO seam and consumed by the pure
/// classification core. A [`Version`](ProbeResult::Version) carries the
/// detected version string (compared against the manifest minimum);
/// [`Present`](ProbeResult::Present) means detected without a comparable
/// version (e.g. an installed tree); [`Absent`](ProbeResult::Absent) means not
/// found; [`Timeout`](ProbeResult::Timeout) means detection exceeded its 30s
/// budget (Req 4.7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProbeResult {
    Version(String),
    Present,
    Absent,
    Timeout,
}

/// Why a [`RuntimeDependency`] classified as
/// [`Missing`](RuntimeDependencyClass::Missing) (Req 4.5, 4.7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MissingReason {
    /// Not detected on the host at all.
    Absent,
    /// Detected, but its version is below the manifest minimum.
    BelowMinimum { found: String, minimum: String },
    /// Detected but its version could not be resolved/parsed.
    Unresolvable,
    /// Detection exceeded its timeout budget (Req 4.7).
    Timeout,
}

/// Classification of a single [`RuntimeDependency`] against its minimum
/// version (Req 4.4, 4.5).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeDependencyClass {
    /// Detected and satisfies its minimum version — leave unchanged
    /// (Req 4.4, 5.4).
    PresentAndSufficient,
    /// Absent, unresolvable, below-minimum, or detection timed out
    /// (Req 4.5, 4.7).
    Missing { reason: MissingReason },
}

/// A single provisioning action executed via the [`ElevatedShell`] seam.
///
/// Each variant maps one-to-one from a [`Missing`](RuntimeDependencyClass::Missing)
/// [`RuntimeDependency`] (see `plan_provisioning`, task 7.4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProvisioningAction {
    /// Silent Node.js install (MSI/winget) followed by a re-probe (Req 5.1).
    InstallNode,
    /// `npm install --omit=dev` with `cwd = install_dir` (Req 5.2).
    NpmInstallOmitDev,
    /// `npx playwright install chromium` (Req 5.3).
    PlaywrightInstallChromium,
}

/// A pure, ordered provisioning plan: exactly the actions needed for the
/// Missing set (Req 5). An all-sufficient input yields an empty plan (Req 5.5).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProvisioningPlan {
    pub actions: Vec<ProvisioningAction>,
}

/// The outcome of running one provisioning action through the seam.
///
/// [`Success`](ExecOutcome::Success) means the command completed; the other
/// variants attribute a failure so `step_runtimes` can name the affected
/// dependency + operation (Req 5.6) and drive fail-fast rollback (Req 5.7).
/// [`Timeout`](ExecOutcome::Timeout) covers the network in-progress budget
/// (Req 11.4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecOutcome {
    /// The command completed successfully.
    Success,
    /// The command ran but exited with a non-zero status / reported an error.
    Failed { message: String },
    /// The command exceeded its in-progress timeout budget (Req 11.4).
    Timeout,
}

/// The result of spawning one plugin to verify it resolves the Required_Package
/// during post-install verification (Req 6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PluginVerifyOutcome {
    /// The plugin resolved the SDK / Required_Package.
    Resolved,
    /// The plugin failed to resolve the SDK.
    Unresolved,
    /// Verification exceeded its budget.
    Timeout,
}

/// The aggregate result of post-install verification across the Canonical
/// Plugin Set (Req 6.1, 6.2, 6.4).
///
/// Passes ([`AllResolved`](VerificationOutcome::AllResolved)) iff all nine
/// plugins resolved; otherwise names exactly the failing plugins.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerificationOutcome {
    AllResolved,
    Failed { plugins: Vec<String> },
}

/// Injectable IO seam for the Runtimes step (Req 4, 5, 6).
///
/// All host interaction — detection probes, elevated provisioning commands, and
/// per-plugin verification spawns — is funnelled through this trait so the pure
/// decision core and its tests need no network access or administrator rights.
/// Timeouts are driven by an injected [`Duration`] (an injected clock in the
/// recording test implementation).
pub trait ElevatedShell {
    /// Probe the host for a single dependency, bounded by `timeout`
    /// (30s detection budget, Req 4.7).
    fn probe(&mut self, dep: &RuntimeDependency, timeout: Duration) -> ProbeResult;

    /// Execute one provisioning action, bounded by the network in-progress
    /// timeout (Req 11.4). `install_dir` is the working directory for
    /// install-dir-scoped actions (e.g. `NpmInstallOmitDev`, Req 5.2).
    fn run(
        &mut self,
        action: &ProvisioningAction,
        install_dir: &Path,
        timeout: Duration,
    ) -> ExecOutcome;

    /// Spawn a single plugin by `server_name` to verify it resolves the
    /// Required_Package, bounded by `timeout` (Req 6).
    fn spawn_plugin(
        &mut self,
        server_name: &str,
        install_dir: &Path,
        timeout: Duration,
    ) -> PluginVerifyOutcome;
}

/// Classify a single [`RuntimeDependency`] from its probe result against an
/// optional minimum version (Req 4.1–4.5, 4.7).
///
/// The dependency classifies [`PresentAndSufficient`](RuntimeDependencyClass::PresentAndSufficient)
/// iff it is detected/resolvable **and** its version is at or above `minimum`:
///
/// * [`ProbeResult::Version`] — parse the detected version and compare against
///   `minimum` (reusing [`dependency::SemVer`](crate::dependency::SemVer)):
///   * no `minimum` → sufficient;
///   * parses and `≥ minimum` → sufficient;
///   * parses and `< minimum` →
///     [`Missing`](RuntimeDependencyClass::Missing) with
///     [`BelowMinimum`](MissingReason::BelowMinimum);
///   * unparseable version (or unparseable `minimum`) →
///     [`Missing`](RuntimeDependencyClass::Missing) with
///     [`Unresolvable`](MissingReason::Unresolvable).
/// * [`ProbeResult::Present`] — detected without a comparable version (e.g. a
///   resolvable `node_modules` tree or a Chromium build): sufficient when no
///   `minimum` is required; when a `minimum` is required there is no version to
///   compare, so it is [`Missing`](RuntimeDependencyClass::Missing) with
///   [`Unresolvable`](MissingReason::Unresolvable).
/// * [`ProbeResult::Absent`] → [`Missing`](RuntimeDependencyClass::Missing)
///   with [`Absent`](MissingReason::Absent) (Req 4.5).
/// * [`ProbeResult::Timeout`] → [`Missing`](RuntimeDependencyClass::Missing)
///   with [`Timeout`](MissingReason::Timeout) (Req 4.7).
pub fn classify_dependency(
    probe: ProbeResult,
    minimum: Option<&SemVer>,
) -> RuntimeDependencyClass {
    match probe {
        ProbeResult::Version(found) => match minimum {
            // Nothing to compare against — any detected version is sufficient.
            None => RuntimeDependencyClass::PresentAndSufficient,
            Some(min) => match SemVer::parse(&found) {
                Some(current) => {
                    if current.satisfies_minimum(min) {
                        RuntimeDependencyClass::PresentAndSufficient
                    } else {
                        RuntimeDependencyClass::Missing {
                            reason: MissingReason::BelowMinimum {
                                found: found.clone(),
                                minimum: format!("{}.{}.{}", min.major, min.minor, min.patch),
                            },
                        }
                    }
                }
                // Detected but the reported version could not be parsed.
                None => RuntimeDependencyClass::Missing {
                    reason: MissingReason::Unresolvable,
                },
            },
        },
        // Detected without a comparable version. Sufficient only when the
        // dependency has no minimum-version requirement; otherwise we cannot
        // confirm it meets the minimum, so it is treated as unresolvable.
        ProbeResult::Present => match minimum {
            None => RuntimeDependencyClass::PresentAndSufficient,
            Some(_) => RuntimeDependencyClass::Missing {
                reason: MissingReason::Unresolvable,
            },
        },
        ProbeResult::Absent => RuntimeDependencyClass::Missing {
            reason: MissingReason::Absent,
        },
        ProbeResult::Timeout => RuntimeDependencyClass::Missing {
            reason: MissingReason::Timeout,
        },
    }
}

/// Derive the ordered provisioning plan from a set of classified dependencies
/// (Req 5).
///
/// This is the pure decision core for provisioning: it maps each
/// [`Missing`](RuntimeDependencyClass::Missing) [`RuntimeDependency`] to its
/// one provisioning [`ProvisioningAction`] and drops every
/// [`PresentAndSufficient`](RuntimeDependencyClass::PresentAndSufficient) one,
/// preserving input order.
///
/// * [`Node`](RuntimeDependency::Node) missing → [`InstallNode`](ProvisioningAction::InstallNode) (Req 5.1).
/// * [`NpmDeps`](RuntimeDependency::NpmDeps) missing → [`NpmInstallOmitDev`](ProvisioningAction::NpmInstallOmitDev) (Req 5.2).
/// * [`PlaywrightChromium`](RuntimeDependency::PlaywrightChromium) missing → [`PlaywrightInstallChromium`](ProvisioningAction::PlaywrightInstallChromium) (Req 5.3).
///
/// A [`PresentAndSufficient`](RuntimeDependencyClass::PresentAndSufficient)
/// dependency contributes no action, so no install/`npm install`/browser-download
/// command runs for it (Req 5.4). When every dependency is
/// [`PresentAndSufficient`](RuntimeDependencyClass::PresentAndSufficient) the
/// plan is empty and no provisioning command runs (Req 5.5).
pub fn plan_provisioning(
    classes: &[(RuntimeDependency, RuntimeDependencyClass)],
) -> ProvisioningPlan {
    let actions = classes
        .iter()
        .filter_map(|(dep, class)| match class {
            RuntimeDependencyClass::PresentAndSufficient => None,
            RuntimeDependencyClass::Missing { .. } => Some(match dep {
                RuntimeDependency::Node => ProvisioningAction::InstallNode,
                RuntimeDependency::NpmDeps => ProvisioningAction::NpmInstallOmitDev,
                RuntimeDependency::PlaywrightChromium => {
                    ProvisioningAction::PlaywrightInstallChromium
                }
            }),
        })
        .collect();

    ProvisioningPlan { actions }
}

/// Aggregate per-plugin post-install verification outcomes into a single
/// [`VerificationOutcome`] (Req 6.1, 6.2, 6.4).
///
/// This is the pure decision core for post-install verification. Given the
/// per-plugin `(server_name, outcome)` results produced by
/// [`ElevatedShell::spawn_plugin`], it reports
/// [`AllResolved`](VerificationOutcome::AllResolved) **iff** all nine plugins in
/// the Canonical_Plugin_Set resolved the Required_Package (Req 6.4); otherwise
/// it reports [`Failed`](VerificationOutcome::Failed) naming exactly the plugins
/// that did not resolve (Req 6.2).
///
/// A plugin counts as failing when its outcome is anything other than
/// [`Resolved`](PluginVerifyOutcome::Resolved) — i.e. both
/// [`Unresolved`](PluginVerifyOutcome::Unresolved) and
/// [`Timeout`](PluginVerifyOutcome::Timeout) are failures. The failing plugins
/// are named in the order they appear in `results`.
///
/// Because verification must cover all nine plugins (Req 6.1), a result set that
/// does **not** contain exactly the nine canonical plugins can never be
/// [`AllResolved`](VerificationOutcome::AllResolved): any missing plugin has not
/// been shown to resolve the SDK. When the result set is short (fewer than nine
/// distinct plugins reported), the outcome is
/// [`Failed`](VerificationOutcome::Failed) — the named plugins are those whose
/// reported outcome failed (an absent plugin cannot be named, but its absence
/// alone prevents an all-resolved result).
pub fn aggregate_verification(
    results: &[(String, PluginVerifyOutcome)],
) -> VerificationOutcome {
    let failing: Vec<String> = results
        .iter()
        .filter(|(_, outcome)| !matches!(outcome, PluginVerifyOutcome::Resolved))
        .map(|(name, _)| name.clone())
        .collect();

    // Count distinct plugins that resolved. All nine must resolve for success
    // (Req 6.1, 6.4); a short or over-full result set with no failures still is
    // not an all-resolved verification of the nine.
    let all_nine_resolved = failing.is_empty() && results.len() == CANONICAL_TOOL_COUNT;

    if all_nine_resolved {
        VerificationOutcome::AllResolved
    } else {
        VerificationOutcome::Failed { plugins: failing }
    }
}

#[cfg(test)]
mod aggregate_verification_tests {
    use super::*;

    fn resolved(name: &str) -> (String, PluginVerifyOutcome) {
        (name.to_string(), PluginVerifyOutcome::Resolved)
    }

    fn all_nine_resolved() -> Vec<(String, PluginVerifyOutcome)> {
        [
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
        .iter()
        .map(|n| resolved(n))
        .collect()
    }

    #[test]
    fn all_nine_resolved_yields_all_resolved() {
        // Req 6.4: success iff all nine plugins resolved the Required_Package.
        assert_eq!(
            aggregate_verification(&all_nine_resolved()),
            VerificationOutcome::AllResolved
        );
    }

    #[test]
    fn one_unresolved_names_exactly_that_plugin() {
        // Req 6.2: name exactly the failing plugin.
        let mut results = all_nine_resolved();
        results[3] = ("browserless".to_string(), PluginVerifyOutcome::Unresolved);
        assert_eq!(
            aggregate_verification(&results),
            VerificationOutcome::Failed {
                plugins: vec!["browserless".to_string()]
            }
        );
    }

    #[test]
    fn timeout_counts_as_a_failure() {
        // Req 6.2: a timed-out plugin is a failure and is named.
        let mut results = all_nine_resolved();
        results[8] = ("lan-sub-agent".to_string(), PluginVerifyOutcome::Timeout);
        assert_eq!(
            aggregate_verification(&results),
            VerificationOutcome::Failed {
                plugins: vec!["lan-sub-agent".to_string()]
            }
        );
    }

    #[test]
    fn multiple_failures_named_in_input_order() {
        let mut results = all_nine_resolved();
        results[0] = ("terminal".to_string(), PluginVerifyOutcome::Unresolved);
        results[5] = ("skills".to_string(), PluginVerifyOutcome::Timeout);
        assert_eq!(
            aggregate_verification(&results),
            VerificationOutcome::Failed {
                plugins: vec!["terminal".to_string(), "skills".to_string()]
            }
        );
    }

    #[test]
    fn all_failing_names_every_plugin() {
        let results: Vec<(String, PluginVerifyOutcome)> = all_nine_resolved()
            .into_iter()
            .map(|(name, _)| (name, PluginVerifyOutcome::Unresolved))
            .collect();
        let VerificationOutcome::Failed { plugins } = aggregate_verification(&results) else {
            panic!("expected Failed when every plugin is unresolved");
        };
        assert_eq!(plugins.len(), CANONICAL_TOOL_COUNT);
    }

    #[test]
    fn short_result_set_with_no_failures_is_not_all_resolved() {
        // Req 6.1: verification must cover all nine; fewer than nine resolved
        // plugins cannot be AllResolved even with no reported failures.
        let results = &all_nine_resolved()[..8];
        assert_eq!(
            aggregate_verification(results),
            VerificationOutcome::Failed { plugins: vec![] }
        );
    }

    #[test]
    fn empty_result_set_is_failed() {
        assert_eq!(
            aggregate_verification(&[]),
            VerificationOutcome::Failed { plugins: vec![] }
        );
    }
}

#[cfg(test)]
mod plan_provisioning_tests {
    use super::*;

    fn missing() -> RuntimeDependencyClass {
        RuntimeDependencyClass::Missing {
            reason: MissingReason::Absent,
        }
    }

    fn sufficient() -> RuntimeDependencyClass {
        RuntimeDependencyClass::PresentAndSufficient
    }

    #[test]
    fn all_sufficient_yields_empty_plan() {
        // Req 5.4, 5.5: no dependency is provisioned when all are sufficient.
        let classes = [
            (RuntimeDependency::Node, sufficient()),
            (RuntimeDependency::NpmDeps, sufficient()),
            (RuntimeDependency::PlaywrightChromium, sufficient()),
        ];
        assert_eq!(plan_provisioning(&classes), ProvisioningPlan::default());
    }

    #[test]
    fn empty_input_yields_empty_plan() {
        assert_eq!(plan_provisioning(&[]), ProvisioningPlan::default());
    }

    #[test]
    fn node_missing_maps_to_install_node() {
        // Req 5.1
        let classes = [(RuntimeDependency::Node, missing())];
        assert_eq!(
            plan_provisioning(&classes).actions,
            vec![ProvisioningAction::InstallNode]
        );
    }

    #[test]
    fn npm_deps_missing_maps_to_npm_install_omit_dev() {
        // Req 5.2
        let classes = [(RuntimeDependency::NpmDeps, missing())];
        assert_eq!(
            plan_provisioning(&classes).actions,
            vec![ProvisioningAction::NpmInstallOmitDev]
        );
    }

    #[test]
    fn playwright_missing_maps_to_playwright_install_chromium() {
        // Req 5.3
        let classes = [(RuntimeDependency::PlaywrightChromium, missing())];
        assert_eq!(
            plan_provisioning(&classes).actions,
            vec![ProvisioningAction::PlaywrightInstallChromium]
        );
    }

    #[test]
    fn missing_reason_does_not_change_the_action() {
        // Any MissingReason variant yields the same action for the dependency.
        for reason in [
            MissingReason::Absent,
            MissingReason::BelowMinimum {
                found: "18.0.0".into(),
                minimum: "24.0.0".into(),
            },
            MissingReason::Unresolvable,
            MissingReason::Timeout,
        ] {
            let classes = [(RuntimeDependency::Node, RuntimeDependencyClass::Missing {
                reason,
            })];
            assert_eq!(
                plan_provisioning(&classes).actions,
                vec![ProvisioningAction::InstallNode]
            );
        }
    }

    #[test]
    fn mixed_set_preserves_input_order_and_skips_sufficient() {
        // Req 5.1, 5.2, 5.3, 5.4: only the missing ones contribute, in order.
        let classes = [
            (RuntimeDependency::Node, sufficient()),
            (RuntimeDependency::NpmDeps, missing()),
            (RuntimeDependency::PlaywrightChromium, missing()),
        ];
        assert_eq!(
            plan_provisioning(&classes).actions,
            vec![
                ProvisioningAction::NpmInstallOmitDev,
                ProvisioningAction::PlaywrightInstallChromium,
            ]
        );
    }

    #[test]
    fn all_missing_yields_one_action_each_in_input_order() {
        let classes = [
            (RuntimeDependency::Node, missing()),
            (RuntimeDependency::NpmDeps, missing()),
            (RuntimeDependency::PlaywrightChromium, missing()),
        ];
        assert_eq!(
            plan_provisioning(&classes).actions,
            vec![
                ProvisioningAction::InstallNode,
                ProvisioningAction::NpmInstallOmitDev,
                ProvisioningAction::PlaywrightInstallChromium,
            ]
        );
    }
}

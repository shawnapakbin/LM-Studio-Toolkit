import { useEffect, useState } from "react";
import { WelcomePage } from "./pages/WelcomePage";
import { LicensePage } from "./pages/LicensePage";
import { LocationPage } from "./pages/LocationPage";
import { OptionsPage } from "./pages/OptionsPage";
import { ProgressPage } from "./pages/ProgressPage";
import { DonePage } from "./pages/DonePage";
import { ErrorPage } from "./pages/ErrorPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { tauriApi, type SystemInfo, type InstallOptions, type InstallErrorEvent, type InstallPaths } from "./lib/tauri";

export type WizardStep = "welcome" | "license" | "location" | "options" | "progress" | "done" | "error";

export interface WizardState {
  step: WizardStep;
  systemInfo: SystemInfo | null;
  options: Partial<InstallOptions>;
  errorEvent: InstallErrorEvent | null;
  donePaths: InstallPaths | null;
}

export function App() {
  const [state, setState] = useState<WizardState>({
    step: "welcome",
    systemInfo: null,
    options: {
      install_playwright_browsers: false,
      sync_lm_studio: true,
      create_start_menu_shortcut: true,
      license: { checkbox_checked: false, scrolled_to_bottom: false },
    },
    errorEvent: null,
    donePaths: null,
  });

  useEffect(() => {
    let cancelled = false;
    tauriApi
      .getSystemInfo()
      .then((info) => {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          systemInfo: info,
          options: {
            ...s.options,
            scope: info.default_scope,
            install_root:
              info.default_scope === "system"
                ? info.default_install_root_system
                : info.default_install_root_user,
          },
        }));
      })
      .catch((err) => {
        console.error("Failed to get system info:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const goTo = (step: WizardStep) => setState((s) => ({ ...s, step }));
  const updateOptions = (patch: Partial<InstallOptions>) =>
    setState((s) => ({ ...s, options: { ...s.options, ...patch } }));

  const onError = (evt: InstallErrorEvent) =>
    setState((s) => ({ ...s, step: "error", errorEvent: evt }));
  const onDone = (paths: InstallPaths) =>
    setState((s) => ({ ...s, step: "done", donePaths: paths }));

  return (
    <ErrorBoundary onError={(message) =>
      onError({
        error: {
          phase: "done",
          kind: "internal",
          message,
          recoverable: false,
          cause_chain: [],
        },
        report_path: null,
        issue_url: "",
      })
    }>
      <main className="h-full flex flex-col">
        {state.step === "welcome" && (
          <WelcomePage systemInfo={state.systemInfo} onNext={() => goTo("license")} />
        )}
        {state.step === "license" && (
          <LicensePage
            acceptance={state.options.license!}
            onChange={(a) => updateOptions({ license: a })}
            onBack={() => goTo("welcome")}
            onNext={() => goTo("location")}
          />
        )}
        {state.step === "location" && state.systemInfo && (
          <LocationPage
            systemInfo={state.systemInfo}
            scope={state.options.scope!}
            installRoot={state.options.install_root!}
            onChange={(scope, root) => updateOptions({ scope, install_root: root })}
            onBack={() => goTo("license")}
            onNext={() => goTo("options")}
          />
        )}
        {state.step === "options" && (
          <OptionsPage
            options={state.options}
            onChange={updateOptions}
            onBack={() => goTo("location")}
            onNext={() => goTo("progress")}
          />
        )}
        {state.step === "progress" && (
          <ProgressPage
            options={state.options as InstallOptions}
            onError={onError}
            onDone={onDone}
            onCancel={() => goTo("options")}
          />
        )}
        {state.step === "done" && state.donePaths && (
          <DonePage paths={state.donePaths} onRestart={() =>
            setState({ ...state, step: "welcome", donePaths: null })
          } />
        )}
        {state.step === "error" && state.errorEvent && (
          <ErrorPage
            event={state.errorEvent}
            onRetry={() => goTo("progress")}
            onCancel={() => goTo("welcome")}
          />
        )}
      </main>
    </ErrorBoundary>
  );
}

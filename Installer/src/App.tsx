import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import CompletePhase from "./phases/CompletePhase";
import InstallingPhase from "./phases/InstallingPhase";
import WelcomePhase from "./phases/WelcomePhase";
import { InstallError, InstallProgress, WizardPhase } from "./types";
import "./styles.css";

function App() {
  const [wizardPhase, setWizardPhase] = useState<WizardPhase>("welcome");
  const [installDir, setInstallDir] = useState("");
  const [progress, setProgress] = useState<InstallProgress>({
    currentPhase: "runtimes",
    percent: 0,
  });
  const [error, setError] = useState<InstallError | null>(null);

  const handleStart = useCallback(
    async (dir: string) => {
      setInstallDir(dir);
      setWizardPhase("installing");
      setError(null);
      setProgress({ currentPhase: "runtimes", percent: 0 });

      try {
        const result = await invoke<{
          success: boolean;
          step: string;
          message: string;
        }>("start_installation", { installPath: dir });

        if (result.success) {
          // success === true means all five provisioning steps passed (Req 9.2).
          setProgress({ currentPhase: "uninstall-registration", percent: 100 });
          setWizardPhase("complete");
        } else {
          setError({
            phase: mapPhaseString(result.step),
            message: result.message,
            isNetworkError: result.message.toLowerCase().includes("network"),
          });
        }
      } catch (err) {
        setError({
          phase: progress.currentPhase,
          message: err instanceof Error ? err.message : String(err),
          isNetworkError: false,
        });
      }
    },
    [progress.currentPhase],
  );

  const handleCancel = useCallback(async () => {
    try {
      await invoke("cancel_installation");
    } catch {
      // Best-effort cancellation
    }
    setWizardPhase("welcome");
    setError(null);
    setProgress({ currentPhase: "runtimes", percent: 0 });
  }, []);

  const handleRetry = useCallback(() => {
    setError(null);
    // Re-trigger from where we left off
    handleStart(installDir);
  }, [installDir, handleStart]);

  return (
    <div className="installer-app">
      <header className="installer-header">
        <h1>LLM Toolkit Installer</h1>
      </header>

      <main className="installer-content">
        {wizardPhase === "welcome" && <WelcomePhase onStart={handleStart} />}

        {wizardPhase === "installing" && (
          <InstallingPhase
            progress={progress}
            error={error}
            onCancel={handleCancel}
            onRetry={handleRetry}
          />
        )}

        {wizardPhase === "complete" && <CompletePhase installDir={installDir} />}
      </main>
    </div>
  );
}

/**
 * Map the step string from the Rust backend to our typed provisioning step.
 * The backend emits the canonical `Step::name()` values; underscore variants
 * are accepted defensively.
 */
function mapPhaseString(step: string): InstallProgress["currentPhase"] {
  const mapping: Record<string, InstallProgress["currentPhase"]> = {
    runtimes: "runtimes",
    "copy-tools": "copy-tools",
    copy_tools: "copy-tools",
    "lm-studio-plugin-dirs": "lm-studio-plugin-dirs",
    lm_studio_plugin_dirs: "lm-studio-plugin-dirs",
    "env-config": "env-config",
    env_config: "env-config",
    "uninstall-registration": "uninstall-registration",
    uninstall_registration: "uninstall-registration",
  };
  return mapping[step] ?? "runtimes";
}

export default App;

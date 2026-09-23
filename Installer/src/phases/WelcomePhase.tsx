import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { PathValidationResult } from "../types";
import { validateInstallPath } from "../utils/path-validation";

interface WelcomePhaseProps {
  onStart: (installDir: string) => void;
}

function WelcomePhase({ onStart }: WelcomePhaseProps) {
  const [installDir, setInstallDir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  // Load default install path from the backend on mount
  useEffect(() => {
    invoke<string>("get_default_install_path")
      .then((defaultPath) => {
        setInstallDir(defaultPath);
      })
      .catch(() => {
        // Fallback if backend isn't available
        setInstallDir("%LOCALAPPDATA%\\LLM-Toolkit");
      });
  }, []);

  function handlePathChange(value: string) {
    setInstallDir(value);
    setError(validateInstallPath(value));
  }

  async function handleBrowse() {
    try {
      // Dynamic import — may fail if plugin-dialog isn't available at runtime.
      // We use a variable to bypass TypeScript module resolution.
      const moduleName = "@tauri-apps/plugin-dialog";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dialog: any = await (Function(`return import("${moduleName}")`)() as Promise<any>);
      const selected = await dialog.open({
        directory: true,
        multiple: false,
        title: "Choose Installation Directory",
      });
      if (selected) {
        const dir = typeof selected === "string" ? selected : String(selected);
        handlePathChange(dir);
      }
    } catch {
      // If plugin-dialog is not available, silently skip
      // The user can still type the path manually
    }
  }

  async function handleStart() {
    // Client-side validation first
    const localErr = validateInstallPath(installDir);
    if (localErr) {
      setError(localErr);
      return;
    }

    // Backend validation (writable check, etc.)
    setValidating(true);
    try {
      const result = await invoke<PathValidationResult>("validate_install_path", {
        path: installDir,
      });
      if (!result.valid) {
        setError(result.error ?? "Path is not valid.");
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to validate path.");
      return;
    } finally {
      setValidating(false);
    }

    onStart(installDir);
  }

  return (
    <div className="phase welcome-phase">
      <h2>Welcome to LLM Toolkit</h2>
      <p>
        This wizard will install LLM Toolkit on your system. It will download required dependencies
        (Node.js, Git) if not already present, clone the repository, and configure the environment.
      </p>

      <div className="install-path-section">
        <label htmlFor="install-dir">Installation Directory</label>
        <div className="path-input-row">
          <input
            id="install-dir"
            type="text"
            value={installDir}
            onChange={(e) => handlePathChange(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? "path-error" : undefined}
          />
          <button type="button" className="browse-btn" onClick={handleBrowse}>
            Browse\u2026
          </button>
        </div>
        {error && (
          <p id="path-error" className="error-message" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="phase-actions">
        <button className="primary-btn" onClick={handleStart} disabled={!!error || validating}>
          {validating ? "Validating\u2026" : "Start Installation"}
        </button>
      </div>
    </div>
  );
}

export default WelcomePhase;

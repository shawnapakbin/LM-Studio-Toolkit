import { invoke } from "@tauri-apps/api/core";

interface CompletePhaseProps {
  installDir: string;
}

/**
 * Success screen shown after all five provisioning steps complete (Req 9.2).
 * The backend returns `success: true` only when every step passed, so reaching
 * this phase already implies overall success — no separate readiness string is
 * emitted (the old readiness check was removed in the orchestrator rewrite).
 */
function CompletePhase({ installDir }: CompletePhaseProps) {
  const handleClose = async () => {
    try {
      // Exit through the Tauri backend. The browser `window.close()` is a no-op
      // in a Tauri webview without the `core:window:allow-close` capability
      // (this installer ships none), which is why the window stayed open after
      // a successful install. `invoke` is already permitted, so this reliably
      // tears the single-window app down.
      await invoke("exit_installer");
    } catch {
      // Last-resort fallback if the command is somehow unavailable.
      window.close();
    }
  };

  return (
    <div className="phase complete-phase">
      <div className="success-icon" aria-hidden="true">
        &#x2705;
      </div>
      <h2>Installation Complete</h2>
      <p>All setup steps finished successfully. LLM Toolkit has been installed to:</p>
      <p>
        <code>{installDir}</code>
      </p>

      <div className="phase-actions">
        <button className="primary-btn" onClick={handleClose}>
          Close Installer
        </button>
      </div>
    </div>
  );
}

export default CompletePhase;

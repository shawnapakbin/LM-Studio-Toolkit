import { InstallError, InstallProgress, STEP_LABELS, STEP_ORDER } from "../types";
import { getStatusIcon, getStepStatus } from "./stepStatus";

interface InstallingPhaseProps {
  progress: InstallProgress;
  error: InstallError | null;
  onCancel: () => void;
  onRetry: () => void;
}

function InstallingPhase({ progress, error, onCancel, onRetry }: InstallingPhaseProps) {
  return (
    <div className="phase installing-phase">
      <h2>Installing LLM Toolkit</h2>

      {/* Step dots */}
      <div
        className="step-indicators"
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {STEP_ORDER.map((step, idx) => {
          const status = getStepStatus(step, progress.currentPhase, !!error, error?.phase);
          return (
            <span key={step}>
              {idx > 0 && (
                <span className={`step-connector ${status === "completed" ? "completed" : ""}`} />
              )}
              <span
                className={`step-dot ${status === "completed" ? "completed" : ""} ${status === "active" ? "active" : ""}`}
                title={STEP_LABELS[step]}
              />
            </span>
          );
        })}
      </div>

      {/* Progress bar for current phase */}
      {!error && (
        <div className="progress-section">
          <div className="progress-header">
            <span className="progress-phase-name">{STEP_LABELS[progress.currentPhase]}</span>
            <span className="progress-percent">{progress.percent}%</span>
          </div>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${progress.percent}%` }} />
          </div>
          {progress.message && <p className="progress-message">{progress.message}</p>}
        </div>
      )}

      {/* Step status list */}
      <div className="phase-status-list">
        {STEP_ORDER.map((step) => {
          const status = getStepStatus(step, progress.currentPhase, !!error, error?.phase);
          return (
            <div key={step} className={`phase-status-item ${status}`}>
              <span className="phase-status-icon">{getStatusIcon(status)}</span>
              <span>{STEP_LABELS[step]}</span>
            </div>
          );
        })}
      </div>

      {/* Error panel */}
      {error && (
        <div className="error-panel" role="alert">
          <h3>{error.isNetworkError ? "Network Error" : "Installation Error"}</h3>
          <p className="error-step-name">Failed step: {STEP_LABELS[error.phase]}</p>
          <p>{error.message}</p>
          <div className="phase-actions">
            <button className="primary-btn" onClick={onRetry}>
              Retry
            </button>
            <button className="danger-btn" onClick={onCancel}>
              Cancel Installation
            </button>
          </div>
        </div>
      )}

      {/* Cancel button (only visible when no error shown) */}
      {!error && (
        <div className="phase-actions">
          <button className="danger-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export default InstallingPhase;

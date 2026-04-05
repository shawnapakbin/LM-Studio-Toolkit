import { useEffect, useState } from "react";
import { ArrowRight, FolderOpen, Wrench } from "lucide-react";

import { Panel } from "@renderer/components/ui/Panel";
import { useSetup } from "@renderer/hooks/useSetup";

interface WizardPageProps {
  onComplete: () => void;
  onOpenDashboard: () => void;
}

interface RuntimeStatus {
  mode: "bundled" | "downloaded" | "system" | "missing";
}

interface LmStudioInstallationStatus {
  appInstalled: boolean;
  appPath: string | null;
  pluginRoot: string;
  pluginRootExists: boolean;
  message: string;
}

function formatPhaseLabel(phase: string) {
  const labels: Record<string, string> = {
    bootstrap: "Bootstrap",
    env: "Environment",
    install: "Dependency install",
    build: "Build",
    verify: "Verification",
    lmstudio: "LM Studio sync",
  };

  return labels[phase] ?? phase;
}

export function WizardPage({ onComplete, onOpenDashboard }: WizardPageProps) {
  const [installRoot, setInstallRoot] = useState("");
  const [mode, setMode] = useState<"install" | "repair">("install");
  const [allowDownloads, setAllowDownloads] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [lmStudioInstallation, setLmStudioInstallation] = useState<LmStudioInstallationStatus | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const { cancel, error, isRunning, logs, progress, start } = useSetup();

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) {
      setBootstrapError("Electron preload API was not available.");
      return;
    }

    Promise.allSettled([
      api.getInstallRoot().then((value) => setInstallRoot(value)),
      api.getRuntimeStatus().then((value) => setRuntimeStatus(value as RuntimeStatus)),
      typeof api.getLmStudioStatus === "function"
        ? api.getLmStudioStatus().then((value) => setLmStudioInstallation(value as LmStudioInstallationStatus))
        : Promise.reject(new Error("getLmStudioStatus is missing from preload API")),
    ]).then((results) => {
      const firstRejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
      if (firstRejected) {
        const reason = firstRejected.reason instanceof Error ? firstRejected.reason.message : String(firstRejected.reason);
        setBootstrapError(reason);
      }
    });
  }, []);

  const currentEvent = progress.at(-1);
  const totalSteps = currentEvent?.totalSteps ?? 7;
  const currentStep = currentEvent?.step ?? 0;
  const totalProgressPercent = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;
  const currentPhasePercent = currentEvent?.phaseProgress ?? 0;
  const runtimeDownloadNeeded = runtimeStatus?.mode === "missing";

  return (
    <div className="grid flex-1 gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <Panel className="flex flex-col gap-8 bg-[radial-gradient(circle_at_top_left,rgba(181,255,214,0.18),transparent_35%),rgba(255,255,255,0.04)]">
        <div className="space-y-4">
          <span className="eyebrow">Self-Sufficient Installer</span>
          <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-white">
            Install LLM Toolkit without relying on a preconfigured machine.
          </h1>
          <p className="max-w-2xl text-lg text-app-muted">
            This installer ships with payload extraction, runtime bootstrap, and graceful LM Studio sync behavior so
            setup can complete even when the machine starts with missing prerequisites.
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
          <div className="text-sm uppercase tracking-[0.24em] text-app-muted">Current Request</div>
          <p className="mt-3 text-sm text-white">
            {mode === "repair"
              ? "Repair this LLM Toolkit installation, verify binaries, and refresh LM Studio MCP bridge settings."
              : "Install LLM Toolkit, bootstrap dependencies, build all tool packages, and set up LM Studio MCP bridge settings."}
          </p>
          <ul className="mt-3 grid gap-2 text-sm text-app-muted">
            <li>LM Studio app detection: {lmStudioInstallation?.appInstalled ? "Detected" : "Not detected"}</li>
            <li>
              LM Studio plugin root: {lmStudioInstallation?.pluginRootExists ? "Detected" : "Not detected yet"}
            </li>
            <li>Runtime status: {runtimeStatus?.mode ?? "Checking..."}</li>
            <li>
              Download requirement: {runtimeDownloadNeeded ? "Portable Node runtime download required" : "Package download may still occur during npm install"}
            </li>
          </ul>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <button className={mode === "install" ? "mode-card mode-card--active" : "mode-card"} onClick={() => setMode("install")} type="button">
            <ArrowRight className="h-5 w-5" />
            <div>
              <div className="font-medium text-white">Fresh install</div>
              <div className="text-sm text-app-muted">Extract payload, install dependencies, build tools.</div>
            </div>
          </button>
          <button className={mode === "repair" ? "mode-card mode-card--active" : "mode-card"} onClick={() => setMode("repair")} type="button">
            <Wrench className="h-5 w-5" />
            <div>
              <div className="font-medium text-white">Repair existing install</div>
              <div className="text-sm text-app-muted">Re-run dependency, build, verification, and sync flows.</div>
            </div>
          </button>
        </div>

        <div className="grid gap-4 rounded-3xl border border-white/10 bg-black/20 p-5">
          <div>
            <div className="text-sm uppercase tracking-[0.24em] text-app-muted">Install Root</div>
            <div className="mt-2 break-all text-sm text-white">{installRoot || "No folder selected yet."}</div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              className="action-button action-button--secondary"
              onClick={() => void window.electronAPI.selectDirectory().then((value) => value && setInstallRoot(value))}
              type="button"
            >
              <FolderOpen className="h-4 w-4" />
              Choose folder
            </button>
            <button
              className="action-button"
              disabled={!installRoot || isRunning || !allowDownloads}
              onClick={() => {
                void start(installRoot, mode === "repair", { allowDownloads })
                  .then(() => onComplete())
                  .catch(() => {
                    // Error state is surfaced by useSetup.
                  });
              }}
              type="button"
            >
              {isRunning ? "Running..." : mode === "repair" ? "Start repair" : "Start install"}
            </button>
            {isRunning ? (
              <button
                className="action-button action-button--ghost"
                onClick={() => {
                  void cancel();
                }}
                type="button"
              >
                Cancel
              </button>
            ) : null}
            <button className="action-button action-button--ghost" onClick={onOpenDashboard} type="button">
              Open dashboard
            </button>
          </div>
          <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-app-muted">
            <input
              checked={allowDownloads}
              className="mt-0.5 h-4 w-4 accent-[#8bd8a8]"
              onChange={(event) => setAllowDownloads(event.target.checked)}
              type="checkbox"
            />
            <span>
              I approve downloads needed by this installer (portable Node runtime when missing and npm package dependencies).
              {!allowDownloads ? " Granting permission is required before setup can run." : " Permission granted for this run."}
            </span>
          </label>
          <p className="text-xs text-app-muted">
            {lmStudioInstallation?.message ?? "Checking LM Studio installation..."}
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm text-app-muted">
            <span>Total installation progress</span>
            <span>
              Step {currentStep} / {totalSteps}
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-[linear-gradient(90deg,#8bd8a8,#f5d06d)] transition-all"
              style={{ width: `${totalProgressPercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-sm text-app-muted">
            <span>Current process progress</span>
            <span>
              {currentEvent ? `${formatPhaseLabel(currentEvent.phase)}: ${Math.round(currentPhasePercent)}%` : "Waiting to start"}
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-[linear-gradient(90deg,#69c9ff,#8bd8a8)] transition-all"
              style={{ width: `${currentPhasePercent}%` }}
            />
          </div>
          {bootstrapError ? <p className="text-sm text-[#fca5a5]">{bootstrapError}</p> : null}
          {error ? <p className="text-sm text-[#fca5a5]">{error}</p> : null}
          <div className="grid gap-2">
            {progress.length === 0 ? (
              <p className="text-sm text-app-muted">No setup activity yet.</p>
            ) : (
              progress.map((event, index) => (
                <div className="flex items-center gap-3 text-sm" key={`${event.phase}-${index}`}>
                  <span className={`status-dot status-dot--${event.level}`} />
                  <span className="text-white">{event.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </Panel>

      <Panel className="flex flex-col gap-5">
        <div>
          <span className="eyebrow">Live Log</span>
          <h2 className="mt-3 text-2xl font-semibold text-white">Command stream</h2>
          <p className="mt-2 text-sm text-app-muted">Main-process setup events and child-process output are streamed here.</p>
        </div>
        <div className="min-h-[420px] flex-1 overflow-auto rounded-2xl border border-white/10 bg-[#09100e] p-4 font-mono text-xs leading-6 text-[#dcf7e6]">
          {logs.length === 0 ? (
            <span className="text-app-muted">Waiting for setup output...</span>
          ) : (
            logs.map((entry, index) => (
              <div key={`${entry.stream}-${index}`}>
                <span className={entry.stream === "stderr" ? "text-[#fca5a5]" : "text-[#dcf7e6]"}>{entry.line}</span>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}
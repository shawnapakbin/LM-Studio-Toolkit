import { useEffect, useRef, useState } from "react";
import { WizardShell } from "../components/WizardShell";
import {
  onInstallError,
  onInstallEvent,
  tauriApi,
  type InstallErrorEvent,
  type InstallOptions,
  type InstallPaths,
  type InstallProgress,
} from "../lib/tauri";

interface Props {
  options: InstallOptions;
  onError: (evt: InstallErrorEvent) => void;
  onDone: (paths: InstallPaths) => void;
  onCancel: () => void;
}

export function ProgressPage({ options, onError, onDone, onCancel }: Props) {
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let unlistenEvt: (() => void) | undefined;
    let unlistenErr: (() => void) | undefined;

    (async () => {
      unlistenEvt = await onInstallEvent((evt) => {
        if (evt.kind === "progress") {
          setProgress({
            phase: evt.phase,
            step: evt.step,
            total: evt.total,
            label: evt.label,
          });
        } else if (evt.kind === "log") {
          setLogs((prev) => [...prev.slice(-499), `[${evt.level}] ${evt.line}`]);
        } else if (evt.kind === "done") {
          onDone(evt.paths);
        }
      });
      unlistenErr = await onInstallError((evt) => onError(evt));

      tauriApi.startInstall(options).catch((message) => {
        // The install:error event will fire with structured detail; this fallback covers IPC errors.
        if (typeof message === "string") {
          setLogs((prev) => [...prev, `[error] ${message}`]);
        }
      });
    })();

    return () => {
      unlistenEvt?.();
      unlistenErr?.();
    };
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const handleCancel = async () => {
    await tauriApi.cancelInstall().catch(() => undefined);
    onCancel();
  };

  const percent = progress ? Math.round((progress.step / progress.total) * 100) : 0;

  return (
    <WizardShell
      title="Installing"
      subtitle={progress ? `${progress.label} (${progress.step}/${progress.total})` : "Starting…"}
      secondary={{ label: "Cancel", onClick: handleCancel }}
    >
      <div className="max-w-3xl space-y-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex items-center justify-between text-sm text-slate-300">
            <span>{progress?.label ?? "Preparing"}</span>
            <span className="text-slate-500">{percent}%</span>
          </div>
          <div className="mt-3 h-2 rounded bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-brand-500 transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Log</div>
          <div
            ref={logRef}
            className="h-72 overflow-auto font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed"
          >
            {logs.length === 0 ? <span className="text-slate-600">(waiting for output…)</span> : logs.join("\n")}
          </div>
        </div>
      </div>
    </WizardShell>
  );
}

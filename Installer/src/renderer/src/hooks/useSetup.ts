import { useEffect, useState } from "react";

export interface SetupProgressEvent {
  level: "info" | "ok" | "warn" | "error" | "section";
  message: string;
  phase: string;
  step: number;
  totalSteps: number;
  phaseProgress: number;
}

export interface SetupLogEvent {
  stream: "stdout" | "stderr";
  line: string;
}

export function useSetup() {
  const [progress, setProgress] = useState<SetupProgressEvent[]>([]);
  const [logs, setLogs] = useState<SetupLogEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.onSetupProgress || !window.electronAPI?.onSetupLog) {
      setError("Installer preload event APIs are unavailable.");
      return;
    }

    const disposeProgress = window.electronAPI.onSetupProgress((payload) => {
      setProgress((current) => [...current, payload as SetupProgressEvent]);
    });
    const disposeLogs = window.electronAPI.onSetupLog((payload) => {
      setLogs((current) => [...current, payload as SetupLogEvent]);
    });

    return () => {
      disposeProgress();
      disposeLogs();
    };
  }, []);

  async function start(
    installRoot: string,
    repair = false,
    options?: { allowDownloads?: boolean; installPlaywrightBrowsers?: boolean },
  ) {
    setIsRunning(true);
    setError(null);
    setProgress([]);
    setLogs([]);

    try {
      if (repair) {
        await window.electronAPI.repairSetup(installRoot, options);
      } else {
        await window.electronAPI.startSetup(installRoot, options);
      }
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Setup failed.");
      throw setupError;
    } finally {
      setIsRunning(false);
    }
  }

  async function cancel() {
    return window.electronAPI.cancelSetup();
  }

  return {
    cancel,
    error,
    isRunning,
    logs,
    progress,
    start,
  };
}
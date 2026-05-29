import { useState } from "react";
import { openUrl, openPath } from "@tauri-apps/plugin-opener";
import { WizardShell } from "../components/WizardShell";
import type { InstallErrorEvent } from "../lib/tauri";

interface Props {
  event: InstallErrorEvent;
  onRetry: () => void;
  onCancel: () => void;
}

export function ErrorPage({ event, onRetry, onCancel }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const recoverable = event.error.recoverable;

  return (
    <WizardShell
      title="Installation failed"
      subtitle={`Phase: ${event.error.phase} — ${event.error.kind}`}
      primary={
        recoverable
          ? { label: "Retry", onClick: onRetry }
          : { label: "Close", onClick: () => window.close() }
      }
      secondary={{ label: "Cancel", onClick: onCancel }}
    >
      <div className="max-w-3xl space-y-4">
        <div className="rounded-lg border border-rose-900/40 bg-rose-950/30 p-4 text-sm text-rose-200">
          <p className="font-medium">{event.error.message}</p>
          {event.error.cause_chain.length > 0 && (
            <ul className="mt-2 list-disc list-inside text-rose-300/80 text-xs">
              {event.error.cause_chain.map((cause, i) => <li key={i}>{cause}</li>)}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => openUrl(event.issue_url).catch(() => undefined)}
            disabled={!event.issue_url}
            className="px-4 py-2 rounded bg-brand-600 hover:bg-brand-500 text-sm font-medium text-white disabled:opacity-40"
          >
            Report on GitHub
          </button>
          {event.report_path && (
            <button
              onClick={() => openPath(event.report_path!).catch(() => undefined)}
              className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-sm text-slate-200"
            >
              Open diagnostic report
            </button>
          )}
          <button
            onClick={() => setShowDetails((v) => !v)}
            className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-sm text-slate-200"
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>
        </div>

        {showDetails && (
          <pre className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300 overflow-auto max-h-64 whitespace-pre-wrap">
{JSON.stringify(event, null, 2)}
          </pre>
        )}

        {event.report_path && (
          <p className="text-xs text-slate-500">
            Diagnostic report saved at <code className="text-slate-400">{event.report_path}</code>.
            Secrets in environment variables were redacted.
          </p>
        )}
      </div>
    </WizardShell>
  );
}

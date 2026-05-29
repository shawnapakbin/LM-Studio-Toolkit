import { openPath } from "@tauri-apps/plugin-opener";
import { WizardShell } from "../components/WizardShell";
import type { InstallPaths } from "../lib/tauri";

interface Props {
  paths: InstallPaths;
  onRestart: () => void;
}

export function DonePage({ paths, onRestart }: Props) {
  return (
    <WizardShell
      title="Installation complete"
      subtitle="The LLM Toolkit is ready to use with LM Studio."
      primary={{ label: "Finish", onClick: () => window.close() }}
      secondary={{ label: "Open install folder", onClick: () => openPath(paths.install_root).catch(() => undefined) }}
      tertiary={{ label: "Run again", onClick: onRestart }}
    >
      <div className="max-w-2xl space-y-4 text-slate-300">
        <p>Everything is installed and LM Studio's MCP config has been updated.</p>
        <dl className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm grid grid-cols-1 gap-y-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Scope</dt>
            <dd className="mt-1">{paths.scope === "system" ? "Per-machine (system)" : "Per-user"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Install root</dt>
            <dd className="mt-1 font-mono text-xs break-all">{paths.install_root}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">App data</dt>
            <dd className="mt-1 font-mono text-xs break-all">{paths.app_data}</dd>
          </div>
        </dl>
        <p className="text-sm text-slate-400">
          Next: open LM Studio. The MCP tools should appear under the model's tool palette.
        </p>
      </div>
    </WizardShell>
  );
}

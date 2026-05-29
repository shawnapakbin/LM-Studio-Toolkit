import { open } from "@tauri-apps/plugin-dialog";
import { WizardShell } from "../components/WizardShell";
import type { InstallScope, SystemInfo } from "../lib/tauri";

interface Props {
  systemInfo: SystemInfo;
  scope: InstallScope;
  installRoot: string;
  onChange: (scope: InstallScope, installRoot: string) => void;
  onBack: () => void;
  onNext: () => void;
}

export function LocationPage({ systemInfo, scope, installRoot, onChange, onBack, onNext }: Props) {
  const systemBlocked = !systemInfo.elevated && scope === "system";

  const pickFolder = async () => {
    const result = await open({ directory: true, multiple: false, defaultPath: installRoot });
    if (typeof result === "string") {
      onChange(scope, result);
    }
  };

  const setScope = (next: InstallScope) => {
    const root =
      next === "system" ? systemInfo.default_install_root_system : systemInfo.default_install_root_user;
    onChange(next, root);
  };

  return (
    <WizardShell
      title="Choose install location"
      subtitle="Select where the toolkit should live on this machine."
      primary={{ label: "Continue", onClick: onNext, disabled: systemBlocked || !installRoot }}
      secondary={{ label: "Back", onClick: onBack }}
    >
      <div className="max-w-2xl space-y-5">
        <fieldset className="space-y-3">
          <label className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4 cursor-pointer hover:bg-slate-900/70">
            <input
              type="radio"
              name="scope"
              className="mt-1 accent-brand-600"
              checked={scope === "system"}
              onChange={() => setScope("system")}
            />
            <div>
              <div className="font-medium text-slate-100">Install for all users (recommended)</div>
              <div className="text-sm text-slate-400 mt-1">
                Installs under <code className="text-brand-500">{systemInfo.default_install_root_system}</code>.
                Requires administrator privileges.
              </div>
              {!systemInfo.elevated && (
                <div className="mt-2 text-xs text-amber-400">
                  ⚠ This installer is not running as administrator. Re-launch elevated to choose this option,
                  or switch to per-user install below.
                </div>
              )}
            </div>
          </label>

          <label className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4 cursor-pointer hover:bg-slate-900/70">
            <input
              type="radio"
              name="scope"
              className="mt-1 accent-brand-600"
              checked={scope === "user"}
              onChange={() => setScope("user")}
            />
            <div>
              <div className="font-medium text-slate-100">Install for me only</div>
              <div className="text-sm text-slate-400 mt-1">
                Installs under <code className="text-brand-500">{systemInfo.default_install_root_user}</code>.
                No administrator prompt required.
              </div>
            </div>
          </label>
        </fieldset>

        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <label className="text-xs text-slate-500 uppercase tracking-wide">Install directory</label>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={installRoot}
              onChange={(e) => onChange(scope, e.target.value)}
              className="flex-1 rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100"
            />
            <button
              onClick={pickFolder}
              className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-sm text-slate-200"
            >
              Browse…
            </button>
          </div>
        </div>
      </div>
    </WizardShell>
  );
}

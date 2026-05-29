import { WizardShell } from "../components/WizardShell";
import type { InstallOptions } from "../lib/tauri";

interface Props {
  options: Partial<InstallOptions>;
  onChange: (patch: Partial<InstallOptions>) => void;
  onBack: () => void;
  onNext: () => void;
}

export function OptionsPage({ options, onChange, onBack, onNext }: Props) {
  return (
    <WizardShell
      title="Options"
      subtitle="Pick which extras to set up. Defaults are recommended."
      primary={{ label: "Install", onClick: onNext }}
      secondary={{ label: "Back", onClick: onBack }}
    >
      <div className="max-w-2xl space-y-3">
        <Toggle
          label="Install Playwright browsers"
          description="Adds Chromium for the WebBrowser tool (~400 MB download)."
          checked={options.install_playwright_browsers ?? false}
          onChange={(v) => onChange({ install_playwright_browsers: v })}
        />
        <Toggle
          label="Sync LM Studio configuration"
          description="Writes ~/.lmstudio/mcp.json so the tools appear in LM Studio."
          checked={options.sync_lm_studio ?? true}
          onChange={(v) => onChange({ sync_lm_studio: v })}
        />
        <Toggle
          label="Create Start Menu shortcut"
          description="Adds an entry under expDigit Studio › LLM Toolkit."
          checked={options.create_start_menu_shortcut ?? true}
          onChange={(v) => onChange({ create_start_menu_shortcut: v })}
        />
      </div>
    </WizardShell>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4 cursor-pointer hover:bg-slate-900/70">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 accent-brand-600"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div>
        <div className="font-medium text-slate-100">{label}</div>
        <div className="text-sm text-slate-400 mt-1">{description}</div>
      </div>
    </label>
  );
}

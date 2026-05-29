import { useEffect, useRef, useState } from "react";
import { WizardShell } from "../components/WizardShell";
import { tauriApi, type LicenseAcceptance } from "../lib/tauri";

interface Props {
  acceptance: LicenseAcceptance;
  onChange: (a: LicenseAcceptance) => void;
  onBack: () => void;
  onNext: () => void;
}

export function LicensePage({ acceptance, onChange, onBack, onNext }: Props) {
  const [licenseText, setLicenseText] = useState<string>("Loading…");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    tauriApi.getLicenseText().then(setLicenseText).catch((e) => setLicenseText(`Failed to load: ${e}`));
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    if (atBottom && !acceptance.scrolled_to_bottom) {
      onChange({ ...acceptance, scrolled_to_bottom: true });
    }
  };

  const canProceed = acceptance.checkbox_checked && acceptance.scrolled_to_bottom;

  return (
    <WizardShell
      title="License agreement"
      subtitle="Please read and accept the license before continuing."
      primary={{ label: "I agree", onClick: onNext, disabled: !canProceed }}
      secondary={{ label: "Back", onClick: onBack }}
    >
      <div className="max-w-3xl">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-80 overflow-auto rounded border border-slate-800 bg-slate-900/60 p-4 text-xs leading-relaxed font-mono whitespace-pre-wrap text-slate-300"
        >
          {licenseText}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
          <span>
            {acceptance.scrolled_to_bottom ? "✓ Reviewed" : "Scroll to the end to enable acceptance"}
          </span>
        </div>
        <label className="mt-4 flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-brand-600"
            checked={acceptance.checkbox_checked}
            disabled={!acceptance.scrolled_to_bottom}
            onChange={(e) =>
              onChange({ ...acceptance, checkbox_checked: e.target.checked })
            }
          />
          <span className="text-sm text-slate-200">
            I have read and agree to the terms of the license above.
          </span>
        </label>
      </div>
    </WizardShell>
  );
}

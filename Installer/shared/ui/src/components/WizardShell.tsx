import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
  primary?: { label: string; onClick: () => void; disabled?: boolean };
  secondary?: { label: string; onClick: () => void };
  tertiary?: { label: string; onClick: () => void };
}

export function WizardShell({ title, subtitle, children, primary, secondary, tertiary }: Props) {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-800 bg-slate-900/60 px-8 py-5">
        <h1 className="text-2xl font-semibold text-slate-50">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </header>
      <div className="flex-1 overflow-auto px-8 py-6">{children}</div>
      <footer className="border-t border-slate-800 bg-slate-900/60 px-8 py-4 flex items-center justify-between">
        <div>
          {tertiary && (
            <button
              className="text-sm text-slate-400 hover:text-slate-200"
              onClick={tertiary.onClick}
            >
              {tertiary.label}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {secondary && (
            <button
              className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-sm text-slate-200"
              onClick={secondary.onClick}
            >
              {secondary.label}
            </button>
          )}
          {primary && (
            <button
              className="px-5 py-2 rounded bg-brand-600 hover:bg-brand-500 text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={primary.onClick}
              disabled={primary.disabled}
            >
              {primary.label}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

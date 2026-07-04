import { WizardShell } from "../components/WizardShell";
import type { SystemInfo } from "../lib/tauri";

interface Props {
  systemInfo: SystemInfo | null;
  onNext: () => void;
}

export function WelcomePage({ systemInfo, onNext }: Props) {
  return (
    <WizardShell
      title="Welcome to LLM Toolkit"
      subtitle="A lightweight installer for the MCP server suite by expDigit Studio."
      primary={{ label: "Get started", onClick: onNext, disabled: !systemInfo }}
    >
      <div className="space-y-6 text-slate-300 max-w-2xl">
        <section>
          <h2 className="text-lg font-medium text-slate-100">What gets installed</h2>
          <ul className="mt-3 list-disc list-inside space-y-1 text-sm">
            <li>11 MCP tools (Terminal, WebBrowser, RAG, Skills, and more)</li>
            <li>Node.js {systemInfo?.elevated !== undefined ? "(downloaded if not present)" : ""}</li>
            <li>LM Studio MCP configuration (~/.lmstudio/mcp.json)</li>
          </ul>
        </section>
        <section>
          <h2 className="text-lg font-medium text-slate-100">How it works</h2>
          <p className="mt-2 text-sm">
            Dependencies are downloaded on demand from <code className="text-brand-500">nodejs.org</code> and
            GitHub to keep this installer small. Internet access is required.
          </p>
        </section>
        {systemInfo && (
          <section className="rounded-lg bg-slate-900/60 border border-slate-800 p-4 text-xs text-slate-400 grid grid-cols-2 gap-2">
            <div><span className="text-slate-500">Installer version</span><br />{systemInfo.installer_version}</div>
            <div><span className="text-slate-500">OS</span><br />{systemInfo.os} ({systemInfo.arch})</div>
            <div><span className="text-slate-500">Elevation</span><br />{systemInfo.elevated ? "Administrator" : "Standard user"}</div>
            <div><span className="text-slate-500">Default scope</span><br />{systemInfo.default_scope === "system" ? "Per-machine" : "Per-user"}</div>
          </section>
        )}
      </div>
    </WizardShell>
  );
}

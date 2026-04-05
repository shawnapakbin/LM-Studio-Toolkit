import { useEffect, useState } from "react";
import { House, RefreshCw } from "lucide-react";

import { ToolCard } from "@renderer/components/dashboard/ToolCard";
import { Panel } from "@renderer/components/ui/Panel";
import { useToolStatus } from "@renderer/hooks/useToolStatus";

interface DashboardPageProps {
  onBackToWizard: () => void;
}

interface RuntimeStatus {
  bundledNodePath: string | null;
  bundledNpmCliPath: string | null;
  systemNodePath: string | null;
  systemNodeVersion: string | null;
  systemNpmVersion: string | null;
  isBundledRuntimeReady: boolean;
  mode: "bundled" | "system" | "missing";
}

interface LmStudioStatus {
  pluginRoot: string;
  exists: boolean;
  mode: "ready" | "skipped";
  updated: number;
  skipped: number;
  message: string;
}

export function DashboardPage({ onBackToWizard }: DashboardPageProps) {
  const [installRoot, setInstallRoot] = useState("");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [lmStudioStatus, setLmStudioStatus] = useState<LmStudioStatus | null>(null);
  const { isLoading, toolStatuses } = useToolStatus(installRoot);

  useEffect(() => {
    void window.electronAPI.getInstallRoot().then((value) => setInstallRoot(value));
    void window.electronAPI.getRuntimeStatus().then((value) => setRuntimeStatus(value as RuntimeStatus));
  }, []);

  useEffect(() => {
    if (!installRoot) {
      return;
    }

    void window.electronAPI.verifyLmStudio(installRoot).then((value) => setLmStudioStatus(value as LmStudioStatus));
  }, [installRoot]);

  return (
    <div className="space-y-6">
      <Panel className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="eyebrow">Dashboard</span>
          <h1 className="mt-3 text-4xl font-semibold text-white">Installer control surface</h1>
          <p className="mt-2 max-w-3xl text-sm text-app-muted">
            This dashboard is the post-install home for runtime health, tool binaries, and LM Studio bridge status.
          </p>
        </div>
        <div className="flex gap-3">
          <button className="action-button action-button--secondary" onClick={onBackToWizard} type="button">
            <House className="h-4 w-4" />
            Wizard
          </button>
          <button
            className="action-button"
            onClick={() => {
              void window.electronAPI.getRuntimeStatus().then((value) => setRuntimeStatus(value as RuntimeStatus));
              if (installRoot) {
                void window.electronAPI
                  .verifyLmStudio(installRoot)
                  .then((value) => setLmStudioStatus(value as LmStudioStatus));
              }
            }}
            type="button"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh status
          </button>
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel className="space-y-5">
          <div>
            <h2 className="text-xl font-semibold text-white">Runtime</h2>
            <p className="mt-2 text-sm text-app-muted">Bundled runtime state for self-sufficient installs.</p>
          </div>
          <dl className="grid gap-4 text-sm">
            <div>
              <dt className="text-app-muted">Mode</dt>
              <dd className="mt-1 text-white">{runtimeStatus?.mode ?? "Loading..."}</dd>
            </div>
            <div>
              <dt className="text-app-muted">Bundled runtime ready</dt>
              <dd className="mt-1 text-white">{runtimeStatus?.isBundledRuntimeReady ? "Yes" : "Not yet"}</dd>
            </div>
            <div>
              <dt className="text-app-muted">Node binary</dt>
              <dd className="mt-1 break-all text-white">{runtimeStatus?.bundledNodePath ?? "Not packaged yet"}</dd>
            </div>
            <div>
              <dt className="text-app-muted">npm CLI</dt>
              <dd className="mt-1 break-all text-white">{runtimeStatus?.bundledNpmCliPath ?? "Not packaged yet"}</dd>
            </div>
            <div>
              <dt className="text-app-muted">System node path</dt>
              <dd className="mt-1 break-all text-white">{runtimeStatus?.systemNodePath ?? "Not detected"}</dd>
            </div>
            <div>
              <dt className="text-app-muted">System node/npm versions</dt>
              <dd className="mt-1 text-white">
                {runtimeStatus?.systemNodeVersion ?? "n/a"} / {runtimeStatus?.systemNpmVersion ?? "n/a"}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel className="space-y-5">
          <div>
            <h2 className="text-xl font-semibold text-white">LM Studio</h2>
            <p className="mt-2 text-sm text-app-muted">Bridge sync is non-blocking and can be retried later.</p>
          </div>
          <dl className="grid gap-4 text-sm">
            <div>
              <dt className="text-app-muted">Plugin root</dt>
              <dd className="mt-1 break-all text-white">{lmStudioStatus?.pluginRoot ?? "Loading..."}</dd>
            </div>
            <div>
              <dt className="text-app-muted">Status</dt>
              <dd className="mt-1 text-white">{lmStudioStatus?.message ?? "Checking..."}</dd>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-app-muted">Updated</div>
                <div className="mt-2 text-3xl font-semibold text-white">{lmStudioStatus?.updated ?? 0}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-app-muted">Skipped</div>
                <div className="mt-2 text-3xl font-semibold text-white">{lmStudioStatus?.skipped ?? 0}</div>
              </div>
            </div>
          </dl>
        </Panel>
      </div>

      <Panel className="space-y-5">
        <div>
          <h2 className="text-xl font-semibold text-white">Tool binaries</h2>
          <p className="mt-2 text-sm text-app-muted">
            {isLoading ? "Refreshing tool status..." : `${toolStatuses.length} tool definitions loaded from the MCP registry.`}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {toolStatuses.map((tool) => (
            <ToolCard key={tool.toolId} tool={tool} />
          ))}
        </div>
      </Panel>
    </div>
  );
}
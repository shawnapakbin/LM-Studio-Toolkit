import type { ToolStatus } from "@renderer/hooks/useToolStatus";

import { Panel } from "@renderer/components/ui/Panel";

interface ToolCardProps {
  tool: ToolStatus;
}

export function ToolCard({ tool }: ToolCardProps) {
  return (
    <Panel className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">{tool.displayName}</h3>
          <p className="mt-1 text-sm text-app-muted">{tool.scriptPath}</p>
        </div>
        <span
          className={tool.binaryExists ? "status-pill status-pill--ok" : "status-pill status-pill--error"}
        >
          {tool.binaryExists ? "Ready" : "Missing"}
        </span>
      </div>
      <div className="mt-auto text-sm text-app-muted">
        {tool.lastModifiedAt ? `Last built: ${new Date(tool.lastModifiedAt).toLocaleString()}` : "Not built yet"}
      </div>
    </Panel>
  );
}
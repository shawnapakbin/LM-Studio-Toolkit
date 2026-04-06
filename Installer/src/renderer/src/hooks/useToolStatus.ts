import { useEffect, useState } from "react";

export interface ToolStatus {
  toolId: string;
  displayName: string;
  scriptPath: string;
  binaryExists: boolean;
  lastModifiedAt: string | null;
}

export function useToolStatus(installRoot: string) {
  const [toolStatuses, setToolStatuses] = useState<ToolStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!installRoot) {
      return;
    }

    setIsLoading(true);
    void window.electronAPI
      .getToolStatuses(installRoot)
      .then((value) => setToolStatuses(value as ToolStatus[]))
      .finally(() => setIsLoading(false));
  }, [installRoot]);

  return {
    isLoading,
    toolStatuses,
  };
}

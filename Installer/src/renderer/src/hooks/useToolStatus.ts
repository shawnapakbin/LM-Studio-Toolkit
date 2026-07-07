/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

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

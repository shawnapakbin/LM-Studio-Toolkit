import type { PropsWithChildren } from "react";

import { cn } from "@renderer/lib/utils";

interface PanelProps extends PropsWithChildren {
  className?: string;
}

export function Panel({ children, className }: PanelProps) {
  return <section className={cn("rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.2)]", className)}>{children}</section>;
}
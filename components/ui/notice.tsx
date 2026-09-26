import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

type Tone = "info" | "success" | "warning" | "error";

const TONES: Record<Tone, string> = {
  info: "border-accent/30 bg-accent/[0.06] text-ink",
  success: "border-success/35 bg-success/[0.07] text-ink",
  warning: "border-warning/35 bg-warning/[0.07] text-ink",
  error: "border-danger/40 bg-danger/[0.08] text-ink",
};

// Errors are announced immediately; other messages politely.
export function Notice({
  tone = "info",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-md border px-3 py-2.5 text-[13px] leading-5", TONES[tone], className)}
    >
      {children}
    </div>
  );
}

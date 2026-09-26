"use client";

import type { PointerEvent, ReactNode } from "react";
import { cn } from "@/components/ui/cn";

// A card whose border and background light up around the pointer. Pure CSS variables, no re-renders.
export function Spotlight({ children, className }: { children: ReactNode; className?: string }) {
  function move(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--spot-x", `${event.clientX - box.left}px`);
    event.currentTarget.style.setProperty("--spot-y", `${event.clientY - box.top}px`);
  }
  return (
    <div
      onPointerMove={move}
      className={cn(
        "group/spot relative overflow-hidden rounded-2xl border border-line bg-surface/60 transition-colors hover:border-line-strong",
        "before:pointer-events-none before:absolute before:inset-0 before:opacity-0 before:transition-opacity before:duration-300 hover:before:opacity-100",
        "before:[background:radial-gradient(420px_circle_at_var(--spot-x,50%)_var(--spot-y,50%),color-mix(in_oklch,var(--color-accent)_12%,transparent),transparent_70%)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

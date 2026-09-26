import { site } from "@/content/site";
import { cn } from "@/components/ui/cn";

export function Availability({ className }: { className?: string }) {
  const { open, label } = site.availability;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface/70 px-3 py-1 text-xs text-muted backdrop-blur",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", open ? "pulse-dot bg-success" : "bg-warning")}
      />
      {open ? label : "Fully booked at the moment"}
    </span>
  );
}

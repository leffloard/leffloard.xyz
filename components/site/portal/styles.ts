import { cn } from "@/components/ui/cn";

// The portal's form controls, in the site's style.
export const portalInput = cn(
  "w-full rounded-xl border border-line-strong bg-canvas px-4 text-base text-ink transition-colors",
  "placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none",
  "aria-invalid:border-danger disabled:opacity-60",
);

export const portalButton = cn(
  "inline-flex h-11 items-center justify-center rounded-full px-5 text-sm font-medium transition-colors",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60",
);

export const primaryButton = cn(portalButton, "bg-accent text-accent-ink hover:bg-accent-hover");
export const quietButton = cn(portalButton, "border border-line-strong text-ink hover:bg-ink/[0.05]");

export const card = "rounded-3xl border border-line bg-surface p-6";

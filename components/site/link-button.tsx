import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

type Variant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-canvas hover:bg-ink/85",
  secondary: "border border-line-strong text-ink hover:border-ink/40 hover:bg-ink/[0.04]",
  ghost: "text-muted hover:text-ink",
};

export function LinkButton({
  href,
  children,
  variant = "primary",
  size = "md",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: Variant;
  size?: "sm" | "md";
  className?: string;
}) {
  const classes = cn(
    "group inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    size === "sm" ? "h-9 px-4 text-[13px]" : "h-11 px-5 text-sm",
    VARIANTS[variant],
    className,
  );
  const external = /^(https?:|mailto:)/.test(href);
  return external ? (
    <a href={href} className={classes} {...(href.startsWith("http") ? { rel: "noopener noreferrer" } : {})}>
      {children}
    </a>
  ) : (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}

export function Arrow({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={cn("size-3.5 transition-transform group-hover:translate-x-0.5", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

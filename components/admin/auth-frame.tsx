import type { ReactNode } from "react";

// The centered card used by the sign-in pages.
export function AuthFrame({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,var(--color-line)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-line)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)] [background-size:48px_48px]"
      />
      <div className="relative w-full max-w-[380px]">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo />
          <span className="font-mono text-xs tracking-[0.08em] text-muted uppercase">
            leffloard.xyz · admin
          </span>
        </div>
        <div className="rounded-xl border border-line bg-surface/90 p-6 shadow-2xl shadow-black/40 backdrop-blur">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="mt-1 text-[13px] leading-5 text-muted">{description}</p> : null}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </main>
  );
}

export function Logo({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="7" className="fill-surface-2 stroke-line-strong" strokeWidth="1" />
      <path d="M11 8v16h11" fill="none" className="stroke-accent" strokeWidth="3.5" strokeLinecap="square" />
    </svg>
  );
}

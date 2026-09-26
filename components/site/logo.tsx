export function LogoMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="7" className="fill-ink" />
      <path d="M11 8v16h11" fill="none" className="stroke-canvas" strokeWidth="3.5" strokeLinecap="square" />
    </svg>
  );
}

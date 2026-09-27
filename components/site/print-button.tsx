"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-9 items-center rounded-full border border-line-strong px-4 text-[13px] font-medium text-ink hover:bg-ink/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      Print
    </button>
  );
}

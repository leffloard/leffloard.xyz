"use client";

export default function PublicError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="px-5 py-24 sm:px-10 sm:py-32">
      <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Error</p>
      <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-6xl">Something went wrong.</h1>
      <p className="mt-5 max-w-xl text-lg text-muted">
        The page could not be shown. Trying again usually helps.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-10 inline-flex h-11 items-center rounded-full bg-ink px-5 text-sm font-medium text-canvas"
      >
        Try again
      </button>
    </div>
  );
}

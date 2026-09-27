"use client";

import { Button } from "@/components/ui/button";

// Unexpected errors in the admin: say so plainly, offer a retry, never show internals.
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col justify-center gap-3 px-6">
      <p className="font-mono text-xs tracking-[0.08em] text-muted uppercase">Something went wrong</p>
      <h1 className="text-2xl font-semibold tracking-tight">This page could not be loaded.</h1>
      <p className="text-sm text-muted">
        Nothing was changed. Try again; if it keeps happening, the server log has the details
        {error.digest ? (
          <>
            {" "}
            under reference <code className="font-mono text-xs text-ink">{error.digest}</code>
          </>
        ) : null}
        .
      </p>
      <Button variant="primary" className="justify-self-start" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}

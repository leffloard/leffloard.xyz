export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6">
      <p className="font-mono text-xs tracking-[0.08em] text-muted uppercase">Error 403</p>
      <h1 className="text-2xl font-semibold tracking-tight">Access denied</h1>
      <p className="text-sm text-muted">
        This area is only reachable through the site&apos;s access check. Open it again from the usual
        address.
      </p>
    </main>
  );
}

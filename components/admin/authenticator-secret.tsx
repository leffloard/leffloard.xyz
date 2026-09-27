"use client";

import { CopyButton } from "@/components/admin/copy-button";

// QR code plus the same key as text, for apps on the same device that cannot scan.
export function AuthenticatorSecret({ qrCode, secret }: { qrCode: string; secret: string }) {
  const grouped = secret.match(/.{1,4}/g)?.join(" ") ?? secret;
  return (
    <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, nothing to optimise */}
      <img
        src={qrCode}
        alt="QR code for the authenticator app"
        width={148}
        height={148}
        className="size-[148px] rounded-lg bg-white p-2"
      />
      <div className="grid gap-2 text-[13px]">
        <p className="text-muted">Scan the code with the app, or enter this key:</p>
        <code
          data-testid="totp-secret"
          className="rounded-md border border-line bg-canvas px-2.5 py-2 font-mono text-xs break-all text-ink"
        >
          {grouped}
        </code>
        <CopyButton value={secret} label="Copy key" />
      </div>
    </div>
  );
}

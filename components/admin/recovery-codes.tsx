"use client";

import { useState } from "react";
import { CopyButton } from "@/components/admin/copy-button";
import { Button } from "@/components/ui/button";

// Shown once, right after the codes are made. The server keeps only hashes, so this is the only chance to
// save them.
export function RecoveryCodes({ codes, account }: { codes: string[]; account: string }) {
  const [saved, setSaved] = useState(false);
  const text = [
    `leffloard.xyz admin recovery codes for ${account}`,
    `Created ${new Date().toISOString().slice(0, 10)}. Each code works once.`,
    "",
    ...codes,
    "",
  ].join("\n");

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "leffloard-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  }

  return (
    <div className="grid gap-3">
      <div>
        <h2 className="text-sm font-semibold">Recovery codes</h2>
        <p className="mt-0.5 text-[13px] text-muted">
          If you lose your phone, each of these signs you in once. Store them in your password manager. They
          will not be shown again.
        </p>
      </div>
      <ol
        data-testid="recovery-codes"
        className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-line bg-canvas p-3 font-mono text-[13px]"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={download}>
          Download .txt
        </Button>
        <span onClick={() => setSaved(true)}>
          <CopyButton value={codes.join("\n")} label="Copy all" />
        </span>
      </div>
      <p className="text-xs text-muted" aria-live="polite">
        {saved ? "Saved. Keep them somewhere other than this computer." : "Save them before you continue."}
      </p>
    </div>
  );
}

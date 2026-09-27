"use client";

import { useState } from "react";
import { previewDigestAction, sendDigestNowAction } from "@/app/(admin)/admin/(shell)/notifications/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

// See today's digest as it would be sent, or send it now.
export function DigestActions({ canSend }: { canSend: boolean }) {
  const { run, pending, message } = useActionRunner();
  const [preview, setPreview] = useState<{ subject: string; text: string } | null>(null);

  async function show() {
    const result = await run("preview", () => previewDigestAction({}));
    if (result.ok) setPreview(result.data);
  }

  return (
    <div className="grid gap-3">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" pending={pending === "preview"} onClick={show}>
          Preview today&apos;s digest
        </Button>
        <Button
          size="sm"
          disabled={!canSend || pending !== null}
          pending={pending === "send"}
          onClick={() => run("send", () => sendDigestNowAction({}))}
        >
          Send it now
        </Button>
      </div>
      {preview ? (
        <figure className="m-0 rounded-lg border border-line bg-canvas/60 p-3">
          <figcaption className="mb-2 text-xs font-medium">{preview.subject}</figcaption>
          <pre className="font-mono text-xs whitespace-pre-wrap text-muted">{preview.text}</pre>
        </figure>
      ) : null}
    </div>
  );
}

"use client";

import { clearLockoutAction } from "@/app/(admin)/admin/(shell)/security/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export function LockoutNotice({ until }: { until: string }) {
  const { run, pending, message } = useActionRunner();
  if (message?.tone === "success") return <Notice tone="success">{message.text}</Notice>;
  return (
    <Notice tone="warning" className="flex flex-wrap items-center justify-between gap-3">
      <span>
        Password sign-in for your account is locked until {until} after repeated failed attempts. If that was
        not you, someone is guessing your password.
      </span>
      <Button
        size="sm"
        pending={pending === "clear"}
        onClick={() => run("clear", () => clearLockoutAction({}))}
      >
        Unlock now
      </Button>
    </Notice>
  );
}

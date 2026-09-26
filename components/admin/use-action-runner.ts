"use client";

import { useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { useSudo } from "@/components/admin/sudo";

// Runs an admin action with the sudo retry, and keeps its pending state and last message for the UI.
export function useActionRunner() {
  const withSudo = useSudo();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function run<T>(key: string, action: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
    setPending(key);
    setMessage(null);
    try {
      const result = await withSudo(action);
      if (result.ok) {
        if (result.message) setMessage({ tone: "success", text: result.message });
      } else if (result.code !== "sudo_required") {
        setMessage({ tone: "error", text: result.error });
      }
      return result;
    } finally {
      setPending(null);
    }
  }

  return { run, pending, message, setMessage };
}

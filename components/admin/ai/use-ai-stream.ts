"use client";

import { useRef, useState } from "react";

// Streams a draft from /admin/ai-stream (server-sent events): "thinking", "text" pieces, then "done" or
// "error". Stopping only stops the display: the server finishes the draft and records it on the AI page.
// Only a finished draft ("done") may be used; a stopped or failed one stays to read.

export type AiStreamStatus = "idle" | "thinking" | "writing" | "done" | "stopped" | "error";

export type AiStreamState = {
  status: AiStreamStatus;
  text: string;
  message: string | null;
  cost: string | null;
  truncated: boolean;
  fallback: boolean;
};

const IDLE: AiStreamState = {
  status: "idle",
  text: "",
  message: null,
  cost: null,
  truncated: false,
  fallback: false,
};

type Event =
  | { type: "thinking" }
  | { type: "text"; text: string }
  | { type: "done"; cost: string; truncated: boolean; fallback: boolean }
  | { type: "error"; message: string };

export function useAiStream() {
  const [state, setState] = useState<AiStreamState>(IDLE);
  const controller = useRef<AbortController | null>(null);

  function apply(event: Event) {
    setState((current) => {
      switch (event.type) {
        case "thinking":
          return current.text ? current : { ...current, status: "thinking" };
        case "text":
          return { ...current, status: "writing", text: current.text + event.text };
        case "done":
          return {
            ...current,
            status: "done",
            cost: event.cost,
            truncated: event.truncated,
            fallback: event.fallback,
          };
        case "error":
          return { ...current, status: "error", message: event.message };
      }
    });
  }

  async function start(body: Record<string, unknown>) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setState({ ...IDLE, status: "thinking" });
    try {
      const response = await fetch("/admin/ai-stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        const answer = (await response.json().catch(() => null)) as { error?: string } | null;
        apply({ type: "error", message: answer?.error ?? "The draft could not be started." });
        return;
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let end = buffer.indexOf("\n\n");
        while (end !== -1) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          end = buffer.indexOf("\n\n");
          if (!chunk.startsWith("data: ")) continue;
          const event = JSON.parse(chunk.slice(6)) as Event;
          if (event.type === "done" || event.type === "error") finished = true;
          apply(event);
        }
      }
      if (!finished) apply({ type: "error", message: "The connection ended before the draft was finished." });
    } catch {
      if (abort.signal.aborted) {
        setState((current) => ({
          ...current,
          status: current.text ? "stopped" : "idle",
          message: "Stopped here. The full draft is still written, and kept on the AI page.",
        }));
        return;
      }
      apply({ type: "error", message: "The connection was lost. Check the AI page for the draft." });
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  }

  function stop() {
    controller.current?.abort();
  }

  function reset() {
    controller.current?.abort();
    setState(IDLE);
  }

  const busy = state.status === "thinking" || state.status === "writing";
  return { ...state, busy, start, stop, reset };
}

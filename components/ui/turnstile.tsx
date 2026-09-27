"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { TURNSTILE_ORIGIN } from "@/lib/csp";

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// Cloudflare Turnstile bot check. The token goes into a hidden "turnstileToken" field; `resetKey` changes
// after every submit, because each token can be checked only once.
export function Turnstile({
  siteKey,
  action,
  nonce,
  resetKey,
  theme = "dark",
}: {
  siteKey: string;
  action: string;
  nonce?: string;
  resetKey?: unknown;
  theme?: "dark" | "light" | "auto";
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState("");

  const render = useCallback(() => {
    if (!window.turnstile || !container.current || widget.current) return;
    widget.current = window.turnstile.render(container.current, {
      sitekey: siteKey,
      action,
      theme,
      size: "flexible",
      callback: (value: string) => setToken(value),
      "expired-callback": () => setToken(""),
      "error-callback": () => setToken(""),
    });
  }, [siteKey, action, theme]);

  useEffect(() => {
    render();
    return () => {
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [render]);

  useEffect(() => {
    if (resetKey === undefined || !widget.current) return;
    window.turnstile?.reset(widget.current);
    setToken("");
  }, [resetKey]);

  return (
    <>
      <Script
        src={`${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`}
        nonce={nonce}
        onReady={render}
      />
      <div ref={container} className="min-h-[65px]" />
      <input type="hidden" name="turnstileToken" value={token} />
    </>
  );
}

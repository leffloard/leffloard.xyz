"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Renders the page again every so often while it is on screen, for live numbers.
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [router, seconds]);
  return null;
}

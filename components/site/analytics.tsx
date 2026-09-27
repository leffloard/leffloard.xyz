"use client";

import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { useEffect } from "react";
import { ANALYTICS_PATH, deviceFor, VITALS, type Vital } from "@/lib/analytics/model";
import { isPrivatePath } from "@/lib/csp";

// The public site's visitor statistics: one small beacon per page view, and the page load's loading timings
// when the visitor leaves it. No cookies and nothing stored in the browser; nothing is sent when the browser
// asks sites not to track (Do Not Track, Global Privacy Control), or on private pages (the portal and
// quote, invoice and meeting links). What happens to it on the server: server/analytics/record.ts.

type Metric = { name: string; value: number };

// Per page load, so kept outside React: the first view carries where the visitor came from; loading
// timings belong to the page the load started on (none are sent when that was a private page), and each
// is sent once.
const load = {
  entrySent: false,
  lastPath: null as string | null,
  landing: null as string | null,
  landingMissing: false, // the load started on the "page does not exist" page: its timings aren't kept
  pending: {} as Partial<Record<Vital, number>>,
  sent: new Set<string>(),
};

function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1";
}

function send(body: Record<string, unknown>): void {
  const data = JSON.stringify(body);
  try {
    if (navigator.sendBeacon?.(ANALYTICS_PATH, new Blob([data], { type: "application/json" }))) return;
  } catch {
    // Falls back to fetch below.
  }
  void fetch(ANALYTICS_PATH, {
    method: "POST",
    body: data,
    headers: { "content-type": "application/json" },
    keepalive: true,
  }).catch(() => undefined);
}

function flushVitals(): void {
  if (!load.landing || load.landingMissing || isPrivatePath(load.landing) || optedOut()) return;
  if (Object.keys(load.pending).length === 0) return;
  send({ type: "vitals", path: load.landing, device: deviceFor(window.innerWidth), metrics: load.pending });
  for (const name of Object.keys(load.pending)) load.sent.add(name);
  load.pending = {};
}

function reportVital(metric: Metric): void {
  if (!(VITALS as readonly string[]).includes(metric.name) || !Number.isFinite(metric.value)) return;
  if (load.sent.has(metric.name)) return;
  load.pending[metric.name as Vital] = metric.value;
  // The last timings arrive as the page is hidden, when there is no later chance to send them.
  if (document.visibilityState === "hidden") flushVitals();
}

export function Analytics() {
  const pathname = usePathname();
  useReportWebVitals(reportVital);

  useEffect(() => {
    const notFound = document.querySelector("[data-not-found]") !== null;
    if (load.landing === null) {
      load.landing = pathname;
      load.landingMissing = notFound;
    }
    if (optedOut() || isPrivatePath(pathname) || pathname === load.lastPath) return;
    load.lastPath = pathname;
    const entry = !load.entrySent;
    load.entrySent = true;
    const params = entry ? new URLSearchParams(window.location.search) : null;
    send({
      type: "view",
      path: pathname,
      entry,
      ...(entry
        ? {
            referrer: document.referrer || undefined,
            source: params?.get("utm_source") ?? params?.get("ref") ?? undefined,
            campaign: params?.get("utm_campaign") ?? undefined,
          }
        : {}),
      device: deviceFor(window.innerWidth),
      notFound,
    });
  }, [pathname]);

  useEffect(() => {
    if (optedOut()) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") flushVitals();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushVitals);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushVitals);
    };
  }, []);

  return null;
}

import { z } from "zod";
import { DEVICES, VITAL_INFO } from "@/lib/analytics/model";

// What a browser sends is cleaned before it is counted: only a plain page path, the referring site's name,
// campaign tags, the device type and loading timings are kept. Never a query string or an address.

const MAX_PATH = 200;
// Control, format and bidirectional characters, which could make a list in the admin read wrong.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;
const HAS_INVISIBLE = new RegExp(INVISIBLE.source);

// "/work/tirego/" → "/work/tirego"; null for anything that isn't a path on this site.
export function cleanPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = (value.split(/[?#]/)[0] ?? "").replace(/\/{2,}/g, "/");
  if (!path.startsWith("/") || /[\s\\]/.test(path) || HAS_INVISIBLE.test(path)) return null;
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
  return trimmed.length <= MAX_PATH ? trimmed : null;
}

function hostOf(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:", "android-app:"].includes(url.protocol)) return null;
    return url.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

// Whether a referrer is this site itself: a full page load from one of its own pages.
export function isOwnReferrer(value: unknown, siteHost: string): boolean {
  const host = hostOf(value);
  return host !== null && host === siteHost.toLowerCase().replace(/^www\./, "");
}

// The referring site's name ("news.ycombinator.com"), without "www."; null when there was none or it was
// this site.
export function referrerHost(value: unknown, siteHost: string): string | null {
  const host = hostOf(value);
  if (!host || isOwnReferrer(value, siteHost)) return null;
  return host.slice(0, 100);
}

// A campaign tag (utm_source, utm_campaign): printable, lower-case, at most 60 characters.
export function cleanTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFKC").replace(INVISIBLE, "").trim().toLowerCase().slice(0, 60).trim();
  return text || null;
}

// Crawlers, link previews, uptime checks and scripts. Browsers that run the site's JavaScript mostly say who
// they are; the rest are rare enough not to matter for a personal site.
const BOTS =
  /bot\b|bot\/|crawl|spider|slurp|archiver|facebookexternalhit|embedly|preview|headless|lighthouse|pagespeed|pingdom|uptime|monitor|curl\/|wget|python|httpclient|okhttp|go-http|java\/|axios|node-fetch|undici|scrapy|phantomjs|selenium|puppeteer|playwright/i;

export function isBot(userAgent: string): boolean {
  return userAgent.length < 20 || BOTS.test(userAgent);
}

// The nearest-rank percentile of a list of numbers (p between 0 and 100); null for an empty list.
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

const tag = z.string().max(500).optional();
const metric = (max: number) => z.number().finite().min(0).max(max).optional();

export const viewPayload = z
  .object({
    type: z.literal("view"),
    path: z.string().max(1000),
    // The first page of a page load: it carries where the visitor came from.
    entry: z.boolean(),
    referrer: z.string().max(2000).optional(),
    source: tag,
    campaign: tag,
    device: z.enum(DEVICES).optional(),
    notFound: z.boolean().optional(),
  })
  .strict();

export const vitalsPayload = z
  .object({
    type: z.literal("vitals"),
    path: z.string().max(1000),
    device: z.enum(DEVICES).optional(),
    metrics: z
      .object({
        LCP: metric(VITAL_INFO.LCP.max),
        INP: metric(VITAL_INFO.INP.max),
        CLS: metric(VITAL_INFO.CLS.max),
        FCP: metric(VITAL_INFO.FCP.max),
        TTFB: metric(VITAL_INFO.TTFB.max),
      })
      .strict(),
  })
  .strict();

export const analyticsPayload = z.discriminatedUnion("type", [viewPayload, vitalsPayload]);
export type ViewPayload = z.infer<typeof viewPayload>;
export type VitalsPayload = z.infer<typeof vitalsPayload>;

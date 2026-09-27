import "server-only";
import { ObjectId, type Db } from "mongodb";
import {
  cleanPath,
  cleanTag,
  isBot,
  isOwnReferrer,
  referrerHost,
  type ViewPayload,
  type VitalsPayload,
} from "@/lib/analytics/clean";
import { VITALS, type Goal, type Vital } from "@/lib/analytics/model";
import { inPageSection, isPrivatePath } from "@/lib/csp";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { clientIp, ipKey, type ClientIpSource } from "@/lib/ip";
import { analyticsEvents, analyticsVitals } from "@/server/analytics/collections";
import { daySalt, visitorId } from "@/server/analytics/visitor";
import { cookieName } from "@/server/auth/cookies";
import { now } from "@/server/clock";

export type TrackingContext = { siteUrl: string; ipSource: ClientIpSource };

// Addresses that aren't pages people read. Private pages (the portal, quote and invoice links) are left out
// too: their addresses hold secret links.
const NOT_PAGES = /^\/(api|_next|media|admin)(\/|$)/;

function isPage(path: string): boolean {
  return !NOT_PAGES.test(path) && !isPrivatePath(path);
}

function hasCookie(header: string, name: string): boolean {
  return header.split(";").some((part) => part.trim().startsWith(`${name}=`));
}

// Requests that aren't counted: the visitor asked not to be tracked (Do Not Track, Global Privacy Control),
// a bot or a prefetch, or the owner (signed in to the admin, or previewing drafts).
export function untracked(headers: Headers): boolean {
  if (headers.get("dnt") === "1" || headers.get("sec-gpc") === "1") return true;
  if (isBot(headers.get("user-agent") ?? "")) return true;
  const purpose = `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""}`;
  if (/prefetch|prerender/i.test(purpose) || headers.has("next-router-prefetch") || headers.has("rsc")) {
    return true;
  }
  const cookies = headers.get("cookie") ?? "";
  return hasCookie(cookies, cookieName("session")) || hasCookie(cookies, cookieName("preview"));
}

// Cloudflare's guess of the visitor's country; only behind Cloudflare, where nobody else can set the header.
function countryOf(headers: Headers, source: ClientIpSource): string | null {
  if (source !== "cloudflare") return null;
  const code = (headers.get("cf-ipcountry") ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== "XX" ? code : null;
}

async function visitorOf(
  db: Db,
  headers: Headers,
  context: TrackingContext,
  day: string,
  at: Date,
): Promise<string> {
  const salt = await daySalt(db, day, at);
  return visitorId(salt, {
    ip: ipKey(clientIp(headers, context.ipSource)) ?? "unknown",
    userAgent: (headers.get("user-agent") ?? "").slice(0, 500),
    host: new URL(context.siteUrl).host,
  });
}

export async function recordView(
  db: Db,
  headers: Headers,
  view: ViewPayload,
  context: TrackingContext,
): Promise<boolean> {
  const path = cleanPath(view.path);
  if (!path || !isPage(path)) return false;
  const at = now();
  const day = todayIn(ADMIN_TIME_ZONE, at);
  const siteHost = new URL(context.siteUrl).hostname;
  const source = cleanTag(view.source);
  const campaign = cleanTag(view.campaign);
  // A full page load from one of the site's own pages continues a visit instead of starting one.
  const entry =
    view.entry && (source !== null || campaign !== null || !isOwnReferrer(view.referrer, siteHost));
  await analyticsEvents(db).insertOne({
    _id: new ObjectId(),
    type: "view",
    at,
    day,
    visitor: await visitorOf(db, headers, context, day, at),
    path,
    entry,
    source: entry ? (source ?? referrerHost(view.referrer, siteHost)) : null,
    campaign: entry ? campaign : null,
    country: countryOf(headers, context.ipSource),
    device: view.device ?? null,
    // An address outside the site's sections is the 404 page, whatever the browser said.
    notFound: view.notFound === true || !inPageSection(path),
    goal: null,
  });
  return true;
}

// Loading timings carry no visitor id: they only say how fast a page was.
export async function recordVitals(db: Db, vitals: VitalsPayload): Promise<boolean> {
  const path = cleanPath(vitals.path);
  if (!path || !isPage(path) || !inPageSection(path)) return false;
  const metrics: Partial<Record<Vital, number>> = {};
  for (const name of VITALS) {
    const value = vitals.metrics[name];
    if (value === undefined) continue;
    metrics[name] = name === "CLS" ? Math.round(value * 1000) / 1000 : Math.round(value);
  }
  if (Object.keys(metrics).length === 0) return false;
  const at = now();
  await analyticsVitals(db).insertOne({
    _id: new ObjectId(),
    at,
    day: todayIn(ADMIN_TIME_ZONE, at),
    path,
    device: vitals.device ?? null,
    metrics,
  });
  return true;
}

// A goal, recorded by the server when it happens (a message sent, a call booked), with the same visitor id
// the visitor's page views have.
export async function recordGoal(
  db: Db,
  headers: Headers,
  goal: Goal,
  context: TrackingContext,
): Promise<boolean> {
  if (untracked(headers)) return false;
  const at = now();
  const day = todayIn(ADMIN_TIME_ZONE, at);
  await analyticsEvents(db).insertOne({
    _id: new ObjectId(),
    type: "goal",
    at,
    day,
    visitor: await visitorOf(db, headers, context, day, at),
    path: null,
    entry: false,
    source: null,
    campaign: null,
    country: countryOf(headers, context.ipSource),
    device: null,
    notFound: false,
    goal,
  });
  return true;
}

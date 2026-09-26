import "server-only";
import type { Db } from "mongodb";
import {
  BULLETIN_MAX_AGE_DAYS,
  bulletinFor,
  parseTcmbBulletin,
  type Bulletin,
  type RateBook,
} from "@/lib/finance/fx";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { addDays, wallDateTime } from "@/lib/intake/time";
import { weekdayIndex } from "@/lib/work/dates";
import { payments } from "@/server/billing/collections";
import { now } from "@/server/clock";
import { getEnv } from "@/server/env";
import { expenses, fxRates } from "@/server/finance/collections";
import { dayOf, daySpan, paymentDay } from "@/server/finance/days";
import { runJob, type JobOutcome } from "@/server/jobs/runner";

// TCMB's exchange rate bulletins: the latest one twice a day (see the scheduler), and any older one a
// transaction needs from TCMB's archive. Each is stored under its date; a day TCMB published nothing is
// remembered too, so the archive isn't asked about it again.

const LOOKBACK_DAYS = 400; // how far back transactions get their rates filled in
const FETCHES_PER_RUN = 25; // archive requests per run, to be gentle with TCMB

export class RatesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RatesUnavailableError";
  }
}

async function fetchBulletin(url: string): Promise<Bulletin | "none"> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/xml, text/xml" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (error) {
    throw new RatesUnavailableError(`TCMB did not answer: ${(error as Error).message}`);
  }
  if (response.status === 404) return "none";
  if (!response.ok) throw new RatesUnavailableError(`TCMB answered ${response.status}.`);
  const bulletin = parseTcmbBulletin((await response.text()).slice(0, 500_000));
  if (!bulletin) throw new RatesUnavailableError("TCMB's answer was not a rates bulletin.");
  return bulletin;
}

// A day's file in TCMB's archive: /kurlar/202609/25092026.xml
function archiveUrl(day: string): string {
  const [year, month, date] = day.split("-");
  return `${getEnv().TCMB_RATES_URL}/${year}${month}/${date}${month}${year}.xml`;
}

async function storeBulletin(db: Db, bulletin: Bulletin, at: Date): Promise<void> {
  await fxRates(db).updateOne(
    { _id: bulletin.date },
    { $set: { source: "TCMB", rates: bulletin.rates, fetchedAt: at } },
    { upsert: true },
  );
}

// A day without a bulletin; never over one that exists.
async function storeNone(db: Db, day: string, at: Date): Promise<void> {
  await fxRates(db).updateOne(
    { _id: day },
    { $setOnInsert: { source: "TCMB", rates: null, fetchedAt: at } },
    { upsert: true },
  );
}

// The bulletins transactions between two days can use (oldest first), and the days known to have none.
export async function loadBulletins(db: Db, from: string, to: string): Promise<RateBook> {
  const docs = await fxRates(db)
    .find({ _id: { $gte: addDays(from, -BULLETIN_MAX_AGE_DAYS), $lte: to } })
    .sort({ _id: 1 })
    .toArray();
  return {
    bulletins: docs.flatMap((doc) => (doc.rates ? [{ date: doc._id, rates: doc.rates }] : [])),
    empty: new Set(docs.filter((doc) => !doc.rates).map((doc) => doc._id)),
  };
}

export async function latestBulletin(db: Db): Promise<(Bulletin & { fetchedAt: Date }) | null> {
  const doc = await fxRates(db).findOne({ rates: { $ne: null } }, { sort: { _id: -1 } });
  return doc ? { date: doc._id, rates: doc.rates!, fetchedAt: doc.fetchedAt } : null;
}

export async function recentBulletins(db: Db, limit = 30): Promise<(Bulletin & { fetchedAt: Date })[]> {
  const docs = await fxRates(db)
    .find({ rates: { $ne: null } })
    .sort({ _id: -1 })
    .limit(limit)
    .toArray();
  return docs.map((doc) => ({ date: doc._id, rates: doc.rates!, fetchedAt: doc.fetchedAt }));
}

// The days money moved on recently (payments, refunds, expenses), and today.
async function transactionDays(db: Db, today: string): Promise<string[]> {
  const from = addDays(today, -LOOKBACK_DAYS);
  const { start } = daySpan(from, today);
  const [paid, spent] = await Promise.all([
    payments(db)
      .find(
        { status: { $in: ["confirmed", "refunded"] }, confirmedAt: { $gte: start } },
        { projection: { receivedOn: 1, confirmedAt: 1, createdAt: 1, refundedAt: 1 } },
      )
      .toArray(),
    expenses(db)
      .find({ date: { $gte: from, $lte: today } }, { projection: { date: 1 } })
      .toArray(),
  ]);
  const days = new Set([today, ...spent.map((expense) => expense.date)]);
  for (const payment of paid) {
    days.add(paymentDay(payment));
    if (payment.refundedAt) days.add(dayOf(payment.refundedAt));
  }
  return [...days].filter((day) => day >= from && day <= today).sort();
}

export type RatesRefresh = { latest: string | null; filled: number; missing: number };

// The latest bulletin, then the archive for days whose bulletin is missing (newest first, a few per run): from
// the day before, back to the first weekday that had one. Weekends are skipped; days without one are
// remembered.
export async function refreshRates(db: Db, at: Date = now()): Promise<RatesRefresh> {
  const today = dayOf(at);
  const latest = await fetchBulletin(`${getEnv().TCMB_RATES_URL}/today.xml`);
  if (latest !== "none") await storeBulletin(db, latest, at);

  const loaded = await loadBulletins(db, addDays(today, -LOOKBACK_DAYS), today);
  const bulletins = loaded.bulletins;
  const empty = new Set(loaded.empty);
  const book: RateBook = { bulletins, empty };
  const dated = () => new Set(bulletins.map((bulletin) => bulletin.date));
  let have = dated();
  const days = (await transactionDays(db, today)).reverse();
  let fetches = 0;
  let filled = 0;
  search: for (const day of days) {
    if (bulletinFor(book, day)) continue;
    for (let back = 1; back <= BULLETIN_MAX_AGE_DAYS; back++) {
      const candidate = addDays(day, -back);
      if (weekdayIndex(candidate) >= 5 || empty.has(candidate)) continue;
      if (have.has(candidate)) break; // the gap before it is now known
      if (fetches >= FETCHES_PER_RUN) break search;
      fetches++;
      const found = await fetchBulletin(archiveUrl(candidate));
      if (found === "none" || found.date !== candidate) {
        await storeNone(db, candidate, at);
        empty.add(candidate);
        if (found === "none") continue;
      }
      await storeBulletin(db, found, at);
      bulletins.push(found);
      bulletins.sort((a, b) => a.date.localeCompare(b.date));
      have = dated();
      filled++;
      if (found.date === candidate) break;
    }
  }
  const missing = days.filter((day) => !bulletinFor(book, day)).length;
  return { latest: latest === "none" ? null : latest.date, filled, missing };
}

export function describeRefresh(result: RatesRefresh): string {
  return [
    result.latest ? `latest bulletin ${result.latest}` : "no bulletin today",
    result.filled ? `${result.filled} older ones filled in` : "",
    result.missing ? `${result.missing} days still without a rate` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

// Twice a day: once in the morning (catching up after a night the server was off) and once after TCMB
// publishes at 15:30.
export function ratesPeriodKey(at: Date): string {
  const { date, time } = wallDateTime(at, ADMIN_TIME_ZONE);
  return `${date}:${time >= "15:45" ? "afternoon" : "morning"}`;
}

export async function runRatesJob(db: Db, at: Date = now()): Promise<JobOutcome> {
  return runJob(db, "fx-rates", async () => describeRefresh(await refreshRates(db, at)), {
    periodKey: ratesPeriodKey(at),
    lockMs: 5 * 60_000,
    retryAfterFailureMs: 30 * 60_000,
  });
}

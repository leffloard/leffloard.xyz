import "server-only";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { addDays, todayIn, zonedInstant } from "@/lib/intake/time";
import type { PaymentDoc } from "@/server/billing/types";

// The owner's calendar days that money moved on, in the admin's time zone.

// A bank transfer counts on the day it arrived (as on the statement); a crypto payment on the day it was
// confirmed.
export function paymentDay(payment: Pick<PaymentDoc, "receivedOn" | "confirmedAt" | "createdAt">): string {
  return payment.receivedOn ?? todayIn(ADMIN_TIME_ZONE, payment.confirmedAt ?? payment.createdAt);
}

export function dayOf(at: Date): string {
  return todayIn(ADMIN_TIME_ZONE, at);
}

// The instants a span of days runs between: from the first day's start to the day after the last one.
export function daySpan(from: string, to: string): { start: Date; end: Date } {
  return {
    start: zonedInstant(from, "00:00", ADMIN_TIME_ZONE)!,
    end: zonedInstant(addDays(to, 1), "00:00", ADMIN_TIME_ZONE)!,
  };
}

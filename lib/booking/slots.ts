import { CELL_MINUTES, intervalsOn, minutesOf, timeOf, type Availability } from "@/lib/booking/availability";
import { addDays, todayIn, zonedInstant } from "@/lib/intake/time";
import { weekdayIndex } from "@/lib/work/dates";

// The slot engine: which start times a booking type offers, given the owner's hours, the meetings and
// blocks already in the calendar, and the rules (notice, horizon, daily cap, buffer). Hours are read in the
// owner's time zone on each date, so a daylight-saving change moves nothing it should not; slots are
// returned as instants for the visitor's browser to show in their own zone.

export type Busy = { start: Date; end: Date };

const MINUTE = 60_000;

// The moment a wall-clock time happens on a date ("24:00" is the next midnight).
function instantAt(date: string, minutes: number, zone: string): Date | null {
  if (minutes >= 24 * 60) return zonedInstant(addDays(date, 1), "00:00", zone);
  return zonedInstant(date, timeOf(minutes), zone);
}

// What a meeting keeps for itself: its own time and the buffer after it. Two meetings' held ranges never
// overlap, which keeps them at least a buffer apart.
export function heldRange(start: Date, durationMinutes: number, bufferMinutes: number): Busy {
  return { start, end: new Date(start.getTime() + (durationMinutes + bufferMinutes) * MINUTE) };
}

// A block (school, an exam) is held like a meeting: its own time and the buffer after it. The buffer before
// it comes from the held range of the meeting that would end there.
export function blockedRange(block: Busy, bufferMinutes: number): Busy {
  return { start: block.start, end: new Date(block.end.getTime() + bufferMinutes * MINUTE) };
}

export type SlotQuery = {
  availability: Availability;
  durationMinutes: number;
  busy: Busy[]; // held ranges of meetings and blocked ranges of blocks
  dayCounts: Record<string, number>; // meetings per date in the owner's time zone
  now: Date;
};

export function availableSlots(query: SlotQuery): Date[] {
  const { availability, durationMinutes, now } = query;
  const zone = availability.timeZone;
  const earliest = now.getTime() + availability.minNoticeMinutes * MINUTE;
  const latest = now.getTime() + availability.horizonDays * 24 * 60 * MINUTE;
  const length = (durationMinutes + availability.bufferMinutes) * MINUTE;
  const busy = query.busy.map((range) => [range.start.getTime(), range.end.getTime()] as const);
  const slots: Date[] = [];
  const first = todayIn(zone, now);

  for (let offset = 0; offset <= availability.horizonDays; offset++) {
    const date = addDays(first, offset);
    if (availability.dailyCap > 0 && (query.dayCounts[date] ?? 0) >= availability.dailyCap) continue;
    for (const interval of intervalsOn(availability, date, weekdayIndex(date))) {
      const from = instantAt(date, minutesOf(interval.start) ?? 0, zone);
      const to = instantAt(date, minutesOf(interval.end) ?? 0, zone);
      if (!from || !to) continue;
      const step = availability.stepMinutes * MINUTE;
      for (let start = from.getTime(); start + durationMinutes * MINUTE <= to.getTime(); start += step) {
        if (start < earliest || start >= latest) continue;
        const end = start + length;
        if (busy.some(([busyStart, busyEnd]) => busyStart < end && start < busyEnd)) continue;
        slots.push(new Date(start));
      }
    }
  }
  return slots;
}

export function offersSlot(slots: readonly Date[], start: Date): boolean {
  return slots.some((slot) => slot.getTime() === start.getTime());
}

/**
 * The 15-minute cells a meeting holds ("2026-10-01T14:15Z"), used as the ids of its slot locks: a second
 * meeting on any of them is refused by the database, so two bookings can never overlap.
 */
export function cellsFor(start: Date, durationMinutes: number, bufferMinutes: number): string[] {
  if (start.getTime() % (CELL_MINUTES * MINUTE) !== 0)
    throw new RangeError("Meetings start on a quarter hour.");
  const cells: string[] = [];
  for (let minutes = 0; minutes < durationMinutes + bufferMinutes; minutes += CELL_MINUTES) {
    cells.push(`${new Date(start.getTime() + minutes * MINUTE).toISOString().slice(0, 16)}Z`);
  }
  return cells;
}

// The date a meeting counts towards for the daily cap: its start, on the owner's calendar.
export function ownerDateOf(start: Date, availability: Pick<Availability, "timeZone">): string {
  return todayIn(availability.timeZone, start);
}

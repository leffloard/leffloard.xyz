import { ADMIN_TIME_ZONE } from "@/lib/format";
import { addDays, todayIn, zonedInstant } from "@/lib/intake/time";

// Snoozed messages leave the inbox and come back at 09:00 (the owner's time) on the chosen day.

export const SNOOZE_PRESETS = [
  { value: "tomorrow", label: "Tomorrow morning" },
  { value: "3-days", label: "In three days" },
  { value: "next-week", label: "Next Monday" },
] as const;
export type SnoozePreset = (typeof SNOOZE_PRESETS)[number]["value"];

function daysUntilMonday(date: string): number {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 is Sunday
  return (8 - weekday) % 7 || 7;
}

export function snoozeUntil(preset: SnoozePreset, at: Date, zone: string = ADMIN_TIME_ZONE): Date {
  const today = todayIn(zone, at);
  const days = preset === "tomorrow" ? 1 : preset === "3-days" ? 3 : daysUntilMonday(today);
  return zonedInstant(addDays(today, days), "09:00", zone) ?? new Date(at.getTime() + days * 86_400_000);
}

// iCalendar (RFC 5545) text for meeting invites and the private calendar feed. Everything that comes from
// a person (names, notes, answers) is escaped, and control characters are dropped, so no value can start
// a new property or event.

export type IcsPerson = { name: string; email: string };

export type IcsEvent = {
  uid: string;
  sequence: number;
  stamp: Date;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  organizer?: IcsPerson;
  attendee?: IcsPerson;
  // A timed event (instants), or an all-day one (calendar dates; `endDate` is the day after the last).
  start: Date | { date: string };
  end: Date | { date: string };
  alarmMinutes?: number;
};

export type IcsCalendar = {
  method?: "REQUEST" | "CANCEL" | "PUBLISH";
  name?: string;
  refreshMinutes?: number;
  events: IcsEvent[];
};

// Control characters out, line breaks kept as \n.
function clean(text: string): string {
  return text.replace(/\r\n?|[\u2028\u2029]/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "");
}

export function escapeText(text: string): string {
  return clean(text).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

// Parameter values (CN=...) are quoted; a quote or line break can't appear inside one at all.
function paramValue(text: string): string {
  return `"${clean(text).replace(/["\n]/g, "").slice(0, 200)}"`;
}

function stamp(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function dateValue(date: string): string {
  return date.replace(/-/g, "");
}

const encoder = new TextEncoder();

// Lines longer than 75 octets continue on the next line after a space, split between characters.
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const width = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (size + width > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += width;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function timeProperty(name: "DTSTART" | "DTEND", value: Date | { date: string }): string {
  return value instanceof Date ? `${name}:${stamp(value)}` : `${name};VALUE=DATE:${dateValue(value.date)}`;
}

function eventLines(event: IcsEvent): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeText(event.uid)}`,
    `DTSTAMP:${stamp(event.stamp)}`,
    `SEQUENCE:${Math.max(0, Math.floor(event.sequence))}`,
    timeProperty("DTSTART", event.start),
    timeProperty("DTEND", event.end),
    `SUMMARY:${escapeText(event.summary)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.url) lines.push(`URL:${clean(event.url).replace(/\n/g, "")}`);
  if (event.status) lines.push(`STATUS:${event.status}`);
  if (event.organizer) {
    lines.push(`ORGANIZER;CN=${paramValue(event.organizer.name)}:mailto:${event.organizer.email}`);
  }
  if (event.attendee) {
    lines.push(
      `ATTENDEE;CN=${paramValue(event.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${event.attendee.email}`,
    );
  }
  lines.push(event.start instanceof Date ? "TRANSP:OPAQUE" : "TRANSP:TRANSPARENT");
  if (event.alarmMinutes && event.status !== "CANCELLED") {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(event.summary)}`,
      `TRIGGER:-PT${Math.floor(event.alarmMinutes)}M`,
      "END:VALARM",
    );
  }
  lines.push("END:VEVENT");
  return lines;
}

export function buildCalendar(calendar: IcsCalendar): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//leffloard.xyz//Calendar//EN",
    "CALSCALE:GREGORIAN",
  ];
  if (calendar.method) lines.push(`METHOD:${calendar.method}`);
  if (calendar.name) lines.push(`X-WR-CALNAME:${escapeText(calendar.name)}`);
  if (calendar.refreshMinutes) {
    lines.push(
      `REFRESH-INTERVAL;VALUE=DURATION:PT${calendar.refreshMinutes}M`,
      `X-PUBLISHED-TTL:PT${calendar.refreshMinutes}M`,
    );
  }
  for (const event of calendar.events) lines.push(...eventLines(event));
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

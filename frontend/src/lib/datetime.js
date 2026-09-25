const pad = (n) => String(n).padStart(2, '0');

export function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return toISODate(date) === value ? date : null;
}

export const TIME_SLOTS = Array.from({ length: 29 }, (_, i) => {
  const minutes = 8 * 60 + i * 30;
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
});

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function timeZoneOffsetMs(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export function zonedTimeToDate(dateValue, timeValue, timeZone) {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue || '');
  const time = /^(\d{2}):(\d{2})$/.exec(timeValue || '');
  if (!date || !time || !timeZone) return null;
  const wall = Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), Number(time[1]), Number(time[2]));
  try {
    const guess = wall - timeZoneOffsetMs(new Date(wall), timeZone);
    const instant = wall - timeZoneOffsetMs(new Date(guess), timeZone);
    return Number.isNaN(instant) ? null : new Date(instant);
  } catch {
    return null;
  }
}

export function toDateTimeLocalValue(date) {
  return `${toISODate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toIsoWithOffset(date) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${toISODate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const dateTimeFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

export function formatDateTime(value) {
  const date = toDate(value);
  return date ? dateTimeFormat.format(date) : '';
}

export function formatCalendarDate(value, options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) {
  const date = typeof value === 'string' ? parseISODate(value) : value;
  return date ? new Intl.DateTimeFormat('en', options).format(date) : value || '';
}

const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const RELATIVE_UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

export function formatRelative(value, now = Date.now()) {
  const date = toDate(value);
  if (!date) return '';
  const seconds = Math.round((date.getTime() - now) / 1000);
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) {
      return relativeFormat.format(Math.round(seconds / size), unit);
    }
  }
  return 'just now';
}

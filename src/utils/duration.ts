/**
 * Zabron — Duration parsing and formatting.
 *
 * Converts human-readable strings like "1d 2h 30m" or "30m" into
 * milliseconds and back. Supports: ms, s, m, h, d, w, mo, y.
 */

const UNIT_TO_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  sec: 1_000,
  secs: 1_000,
  second: 1_000,
  seconds: 1_000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
  mo: 2_629_800_000,
  month: 2_629_800_000,
  months: 2_629_800_000,
  y: 31_557_600_000,
  year: 31_557_600_000,
  years: 31_557_600_000,
};

const PATTERN = /(\d+)\s*([a-zA-Z]+)/g;

export interface ParsedDuration {
  ms: number;
  formatted: string;
}

/**
 * Parse a duration string. Returns `null` if the string is empty or invalid.
 *
 * Examples:
 *   parseDuration("1d") => { ms: 86_400_000, formatted: "1 day" }
 *   parseDuration("1h30m") => { ms: 5_400_000, formatted: "1 hour 30 minutes" }
 */
export function parseDuration(input: string | null | undefined): ParsedDuration | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  let total = 0;
  let matched = false;
  let units: Array<{ value: number; unit: string }> = [];
  for (const match of trimmed.matchAll(PATTERN)) {
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    const ms = UNIT_TO_MS[unit];
    if (!Number.isFinite(value) || ms === undefined) {
      return null;
    }
    total += value * ms;
    units.push({ value, unit });
    matched = true;
  }
  if (!matched || total <= 0) return null;
  return { ms: total, formatted: formatDuration(total) };
}

/** Convert milliseconds back into a readable, compact string. */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0 seconds';
  const abs = Math.floor(ms);
  const seconds = Math.floor(abs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  const parts: string[] = [];
  if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (months && !years) parts.push(`${months} month${months === 1 ? '' : 's'}`);
  if (weeks && !years && !months) parts.push(`${weeks} week${weeks === 1 ? '' : 's'}`);
  if (days && !months && !years) parts.push(`${days % 7} day${days % 7 === 1 ? '' : 's'}`);
  if (hours && !days) parts.push(`${hours % 24} hour${hours % 24 === 1 ? '' : 's'}`);
  if (minutes && !hours && !days) parts.push(`${minutes % 60} minute${minutes % 60 === 1 ? '' : 's'}`);
  if (!parts.length) parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);

  return parts.slice(0, 2).join(' ');
}

/** Format a Unix ms timestamp into Discord's <t:...> format. */
export function discordTime(ms: number, style: 'F' | 'f' | 'D' | 'd' | 'T' | 't' | 'R' = 'F'): string {
  const seconds = Math.floor(ms / 1000);
  return `<t:${seconds}:${style}>`;
}
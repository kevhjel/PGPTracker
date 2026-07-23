import { pacificOffsetMinutes } from "./clubspeedParser";

// PGP Kent's real operating schedule, derived from a full year of production
// scrape data (Jul 2025-Jul 2026, ~6,300 real "scraped" heats bucketed into
// Pacific-local calendar time). See ../../.claude/track-schedule-insights.md
// for the methodology and how to refresh this. THIS FILE is the executable
// source of truth the scraper actually runs on - if the insights doc and this
// file ever disagree, trust this file and flag the drift.

export interface DayWindow {
  openHour: number; // Pacific local, 24h clock, inclusive
  closeHour: number; // Pacific local, 24h clock, exclusive-ish (last heats start near this hour)
}

// weekday: 0=Sunday..6=Saturday (JS Date convention), Pacific local time.
// Confirmed 100% consistent across the full year sampled - no exceptions to
// the Monday/Tuesday closure were found.
export const WEEKLY_HOURS: Record<number, DayWindow | null> = {
  0: { openHour: 9, closeHour: 17 }, // Sunday - short day
  1: null, // Monday - closed
  2: null, // Tuesday - closed
  3: { openHour: 9, closeHour: 19 }, // Wednesday
  4: { openHour: 9, closeHour: 17 }, // Thursday - short day
  5: { openHour: 9, closeHour: 19 }, // Friday
  6: { openHour: 9, closeHour: 19 }, // Saturday
};

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): number {
  const firstOfMonthDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const firstMatch = 1 + ((7 + weekday - firstOfMonthDow) % 7);
  return firstMatch + (n - 1) * 7;
}

/**
 * Hardcoded recurring holiday closures, projected onto every future year, per
 * an explicit product decision. Inferred from a single observed season
 * (2025) - may need revision if the track's holiday policy changes:
 *   - Thanksgiving Day (4th Thursday of November): confirmed closed 2025-11-27.
 *   - Christmas Eve + Christmas Day (Dec 24-25): confirmed closed 2025-12-24/25.
 * Deliberately NOT included, because both were confirmed OPEN in the data:
 *   - New Year's Day (Jan 1)
 *   - July 4th
 * Irregular closures (occasional dark Sundays, isolated one-off dark days)
 * are NOT modeled here - no fixed pattern was found, and they are covered
 * instead by the scraper's adaptive miss/empty detection, not this calendar.
 */
export function isRecurringHolidayClosure(year: number, month: number, day: number): boolean {
  if (month === 12 && (day === 24 || day === 25)) return true;
  if (month === 11 && day === nthWeekdayOfMonth(year, 11, 4 /* Thursday */, 4)) return true;
  return false;
}

export interface PacificParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=Sunday..6=Saturday
}

// Converts a genuine UTC instant to its Pacific-local wall-clock parts. Seeds
// the DST offset lookup from the UTC calendar date rather than the true local
// date - the same tiny DST-boundary-day imprecision `clubspeedParser.ts`'s
// existing `correctTrackLocalTimestamp` already accepts, immaterial here
// since this only drives a scheduling heuristic, not stored data.
export function pacificPartsForUtc(utcMs: number): PacificParts {
  const d = new Date(utcMs);
  const offsetMin = pacificOffsetMinutes(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  const local = new Date(utcMs + offsetMin * 60_000);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    weekday: local.getUTCDay(),
  };
}

/** True if the track's published weekly schedule + recurring holiday rules say it should be open at this UTC instant. */
export function isTrackScheduledOpen(utcMs: number): boolean {
  const parts = pacificPartsForUtc(utcMs);
  if (isRecurringHolidayClosure(parts.year, parts.month, parts.day)) return false;
  const window = WEEKLY_HOURS[parts.weekday];
  if (!window) return false;
  return parts.hour >= window.openHour && parts.hour < window.closeHour;
}

const STEP_MS = 5 * 60 * 1000;

/**
 * ms until the next moment `isTrackScheduledOpen` would return true, searched
 * forward in 5-minute increments up to `horizonDays` (default 10 - safely
 * above the longest observed closure of ~114h). Returns `horizonDays` worth
 * of ms if nothing is found within the horizon (should not happen in
 * practice; callers should still treat the result as a capped tier, not a
 * literal single sleep - see CLOSED_RESCHEDULE_MS in scrapeHeats.ts).
 */
export function msUntilNextScheduledOpen(utcMs: number, horizonDays = 10): number {
  const horizonMs = horizonDays * 24 * 60 * 60 * 1000;
  let elapsed = 0;
  while (elapsed <= horizonMs) {
    if (isTrackScheduledOpen(utcMs + elapsed)) return elapsed;
    elapsed += STEP_MS;
  }
  return horizonMs;
}

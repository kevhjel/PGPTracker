export interface IsoWeekInfo {
  isoYear: number;
  isoWeek: number;
  weekStartMs: number; // UTC ms for the Monday of this ISO week - date-only, no timezone precision needed (label/sort use only)
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Standard ISO-8601 week-of-year (Monday-start weeks; week 1 is the week
 * containing the year's first Thursday). Operates purely on a calendar date
 * - the caller is expected to already have converted to Pacific-local
 * year/month/day (see trackSchedule.ts's pacificPartsForUtc) before calling.
 */
export function isoWeekOf(year: number, month: number, day: number): IsoWeekInfo {
  const thursday = new Date(Date.UTC(year, month - 1, day));
  const dayNum = (thursday.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  thursday.setUTCDate(thursday.getUTCDate() - dayNum + 3);

  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);

  const isoWeek = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * MS_PER_DAY));
  const monday = new Date(thursday.getTime() - 3 * MS_PER_DAY);

  return { isoYear: thursday.getUTCFullYear(), isoWeek, weekStartMs: monday.getTime() };
}

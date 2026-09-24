/**
 * Calendar arithmetic for leave. Pure, and deliberately free of any import, so
 * it can be exercised without a database, a JWT secret or an HTTP server.
 */

/**
 * Reads a calendar day from whatever the database or a request hands over, as
 * a local Date at midnight. Returns null for anything unusable.
 *
 * `pg` parses a DATE column into a JS Date, not a string, so code that assumes
 * `YYYY-MM-DD` and splits on "-" gets NaN and silently does nothing. That is
 * what stopped the fortnightly accrual scheduler from ever running.
 */
export function parseDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Formats a Date as `YYYY-MM-DD` from its local calendar day. */
export function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Working days between two dates, inclusive: weekdays that are not public
 * holidays.
 *
 * This is the definition every leave figure rests on — what comes off a
 * balance when leave is approved, and what the overview counts as a day taken.
 * The client mirrors it in `features/hr/types.ts` so the application form can
 * preview the figure before submitting, and `WORKING_DAYS_IN_RANGE` mirrors it
 * again in SQL for the reporting. All three must agree.
 *
 * `holidays` is a collection of `YYYY-MM-DD` strings; anything with a `has`
 * method (a Set) or an array will do. Omitted, only weekends are excluded,
 * which is what a caller that has not loaded the calendar gets.
 */
export function calculateWorkingDays(startDate, endDate, holidays = null) {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end || end < start) return 0;

  const closed = holidays instanceof Set ? holidays : new Set(holidays || []);
  let days = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const weekday = cursor.getDay();
    if (weekday === 0 || weekday === 6) continue;
    if (closed.has(toIsoDate(cursor))) continue;
    days += 1;
  }
  return days;
}

/**
 * Every month from `from` to `to` inclusive, as `YYYY-MM`.
 *
 * Integer arithmetic on the date strings rather than stepping a Date, which
 * would put the month a day out whenever the server's timezone differs from
 * the one the dates were written in.
 */
export function monthsBetween(from, to) {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  const months = [];
  let year = fromYear;
  let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

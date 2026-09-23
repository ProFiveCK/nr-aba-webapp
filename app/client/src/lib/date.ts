/**
 * Calendar-day helpers.
 *
 * `Date.prototype.toISOString()` converts to UTC before formatting, so
 * `new Date(2026, 0, 1).toISOString().slice(0, 10)` yields `2025-12-31` for
 * anyone east of Greenwich. The portal runs in Naoero (UTC+12), where that is
 * always wrong by a day, so nothing here should ever reach for `toISOString`
 * to produce a `YYYY-MM-DD`.
 *
 * The API speaks `YYYY-MM-DD` for anything that is a calendar day rather than
 * an instant — leave dates, report ranges, value dates — and so do these.
 */

/** Formats a Date as `YYYY-MM-DD` using its local calendar day. */
export function toIsoDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/** Today as `YYYY-MM-DD`, in the viewer's own timezone. */
export function todayIsoDate(): string {
    return toIsoDate(new Date());
}

/**
 * Normalises a value to a `YYYY-MM-DD` suitable for an `<input type="date">`.
 *
 * A string that already starts with a calendar day is taken verbatim — the API
 * returns `DATE` columns as `2026-09-24` or as a full timestamp, and parsing
 * either into a Date only creates an opportunity to shift the day. Anything
 * else is read as a local calendar day. Unusable input gives `''`, which is
 * what an empty date input expects.
 */
export function toDateInputValue(value: string | Date | null | undefined): string {
    if (!value) return '';
    if (typeof value === 'string') {
        const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
        if (match) return match[1];
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return toIsoDate(date);
}

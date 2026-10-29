import { formatDate } from '../../lib/date';

/*
 * HR sees one list of public holidays. It is stored as one calendar per year: saving records a new
 * version of each year that changed, and a date in a year not yet listed starts a calendar for that
 * year. Versions are never changed, so a year's earlier lists stay in its history.
 */

export type Holiday = { date: string; name: string };
/** One saved version. A correction is saved as a new version that supersedes it. */
export type HolidayCalendar = {
    id: string; label: string; effective_from: string; effective_to: string; holidays: Holiday[];
    supersedes_id: string | null; source_reference: string; recorded_at?: string; reason?: string;
};
export type HolidayRow = { key: string; date: string; name: string };
type Coverage = Pick<HolidayCalendar, 'effective_from' | 'effective_to'>;
export type CalendarRequest = Coverage & { label: string; holidays: Holiday[]; source_reference: string; reason: string; supersedes_id?: string };

/** The server accepts at most this many holidays in one calendar. */
export const MAX_HOLIDAYS = 100;

/** A calendar day moved by whole days. */
export function shiftDay(iso: string, days: number) {
    const [year, month, day] = iso.split('-').map(Number);
    const moved = new Date(Date.UTC(year, month - 1, day + days));
    return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}-${String(moved.getUTCDate()).padStart(2, '0')}`;
}

/** The year a calendar covers when it runs exactly 1 January to 31 December, otherwise null. */
export function calendarYear({ effective_from, effective_to }: Coverage): number | null {
    const year = effective_from.slice(0, 4);
    return effective_from === `${year}-01-01` && effective_to === `${year}-12-31` ? Number(year) : null;
}

/** "2027", "2026 to 2027", or the dates of a period that is not whole years. */
export function coverageName({ effective_from: from, effective_to: to }: Coverage) {
    if (from.endsWith('-01-01') && to.endsWith('-12-31')) return from.slice(0, 4) === to.slice(0, 4) ? from.slice(0, 4) : `${from.slice(0, 4)} to ${to.slice(0, 4)}`;
    return `${formatDate(from)} to ${formatDate(to)}`;
}

export const byDate = (holidays: Holiday[]) => [...holidays].sort((a, b) => a.date.localeCompare(b.date));

/** The latest version of each year, earliest first. */
export function currentCalendars(calendars: HolidayCalendar[]) {
    const replaced = new Set(calendars.map(c => c.supersedes_id));
    return calendars.filter(c => !replaced.has(c.id)).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
}

/** Versions that a later save replaced, most recently saved first. */
export function earlierVersions(calendars: HolidayCalendar[]) {
    const replaced = new Set(calendars.map(c => c.supersedes_id));
    return calendars.filter(c => replaced.has(c.id)).sort((a, b) => (b.recorded_at ?? '').localeCompare(a.recorded_at ?? ''));
}

/** The periods the list covers, with back-to-back calendars joined: "2026 to 2027". */
export function coverageSummary(current: HolidayCalendar[]) {
    const ranges: Coverage[] = [];
    for (const c of current) {
        const last = ranges.at(-1);
        if (last && shiftDay(last.effective_to, 1) === c.effective_from) last.effective_to = c.effective_to;
        else ranges.push({ effective_from: c.effective_from, effective_to: c.effective_to });
    }
    const names = ranges.map(coverageName);
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '';
}

/** New years can be started from last year to three years ahead. */
export function addableYears(today: string) {
    const year = Number(today.slice(0, 4));
    return { first: year - 1, last: year + 3 };
}

/** The calendar a date belongs to, or the new period it would start: its year, less any part already saved. */
export function periodFor(date: string, current: HolidayCalendar[]): HolidayCalendar | Coverage {
    const saved = current.find(c => c.effective_from <= date && date <= c.effective_to);
    if (saved) return saved;
    let from = `${date.slice(0, 4)}-01-01`, to = `${date.slice(0, 4)}-12-31`;
    for (const c of current) {
        if (c.effective_to < date && c.effective_to >= from) from = shiftDay(c.effective_to, 1);
        if (c.effective_from > date && c.effective_from <= to) to = shiftDay(c.effective_from, -1);
    }
    return { effective_from: from, effective_to: to };
}

/**
 * Checks each row and returns the holidays to save, earliest first. Rows with neither a date nor a
 * name are ignored, so a spare blank row never blocks saving. Errors are keyed by row.
 */
export function checkHolidayRows(rows: HolidayRow[], current: HolidayCalendar[], today: string) {
    const errors: Record<string, string> = {}, seen = new Map<string, string>(), holidays: Holiday[] = [];
    const { first, last } = addableYears(today);
    for (const row of rows) {
        const name = row.name.trim(), year = Number(row.date.slice(0, 4));
        if (!row.date && !name) continue;
        if (!row.date) errors[row.key] = 'Enter the date as DD/MM/YYYY.';
        else if (!name) errors[row.key] = 'Enter the holiday name.';
        else if (!current.some(c => c.effective_from <= row.date && row.date <= c.effective_to) && (year < first || year > last))
            errors[row.key] = `Holidays can be added for ${first} to ${last}.`;
        else if (seen.has(row.date)) errors[row.key] = `${formatDate(row.date)} is already listed as ${seen.get(row.date)}.`;
        else { seen.set(row.date, name); holidays.push({ date: row.date, name }); }
    }
    return { holidays: byDate(holidays), errors };
}

/** What a new version changes, compared by date. */
export function holidayChanges(before: Holiday[], after: Holiday[]) {
    const old = new Map(before.map(h => [h.date, h.name])), next = new Set(after.map(h => h.date));
    return {
        added: after.filter(h => !old.has(h.date)).length,
        removed: before.filter(h => !next.has(h.date)).length,
        renamed: after.filter(h => old.has(h.date) && old.get(h.date) !== h.name).length,
    };
}

/** The recorded reason for saving a year, written for the HR officer. Null when an existing year is unchanged. */
export function saveReason(coverage: Coverage, holidays: Holiday[], previous?: HolidayCalendar) {
    const period = calendarYear(coverage) ? `for ${coverage.effective_from.slice(0, 4)}` : `from ${formatDate(coverage.effective_from)} to ${formatDate(coverage.effective_to)}`;
    if (!previous) return `Saved the public holidays ${period} (${holidays.length === 1 ? '1 holiday' : `${holidays.length || 'no'} holidays`}).`;
    const parts = Object.entries(holidayChanges(previous.holidays, holidays)).filter(([, n]) => n).map(([what, n]) => `${n} ${what}`);
    return parts.length ? `Updated the public holidays ${period}: ${parts.join(', ')}.` : null;
}

/**
 * The calendars one save records: a new version of each saved year whose holidays changed, and a
 * new calendar for each period that gains its first holidays. Unchanged years are left alone.
 */
export function planHolidaySave({ holidays, current, source, note = '' }: { holidays: Holiday[]; current: HolidayCalendar[]; source: string; note?: string }): CalendarRequest[] {
    const groups = new Map<string, { period: HolidayCalendar | Coverage; holidays: Holiday[] }>();
    for (const c of current) groups.set(c.effective_from, { period: c, holidays: [] });
    for (const h of holidays) {
        const period = periodFor(h.date, current);
        if (!groups.has(period.effective_from)) groups.set(period.effective_from, { period, holidays: [] });
        groups.get(period.effective_from)!.holidays.push(h);
    }
    const requests: CalendarRequest[] = [];
    for (const { period, holidays: list } of [...groups.values()].sort((a, b) => a.period.effective_from.localeCompare(b.period.effective_from))) {
        const previous = 'id' in period ? period : undefined, sorted = byDate(list);
        const reason = saveReason(period, sorted, previous);
        if (!reason) continue;
        requests.push({
            label: previous?.label ?? `Public holidays ${coverageName(period)}`, effective_from: period.effective_from, effective_to: period.effective_to,
            holidays: sorted, source_reference: source.trim(), reason: note.trim() ? `${reason} · ${note.trim()}` : reason,
            ...(previous ? { supersedes_id: previous.id } : {}),
        });
    }
    return requests;
}

/** The same day and month in another year, or '' for a 29 February that year does not have. */
export function dateInYear(date: string, year: number) {
    const moved = `${year}${date.slice(4)}`;
    return formatDate(moved) === '—' ? '' : moved;
}

/** One year's holidays moved to the next year, as a starting point. */
export function copiedHolidays(holidays: Holiday[], year: number): Holiday[] {
    return byDate(holidays).map(h => ({ date: dateInYear(h.date, year), name: h.name }));
}

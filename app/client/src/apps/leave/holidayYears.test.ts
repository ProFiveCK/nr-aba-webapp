import { describe, expect, it } from 'vitest';
import {
    checkHolidayRows, copiedHolidays, coverageName, coverageSummary, currentCalendars, earlierVersions, periodFor,
    planHolidaySave, saveReason, shiftDay,
} from './holidayYears';
import type { HolidayCalendar, HolidayRow } from './holidayYears';

const calendar = (id: string, from: string, to: string, changes: Partial<HolidayCalendar> = {}): HolidayCalendar => ({
    id, label: `Public holidays ${from.slice(0, 4)}`, effective_from: from, effective_to: to, holidays: [],
    supersedes_id: null, source_reference: 'Gazette No. 45 of 2026', ...changes,
});
const year = (y: number, changes: Partial<HolidayCalendar> = {}) => calendar(`y${y}`, `${y}-01-01`, `${y}-12-31`, changes);
const row = (key: string, date: string, name: string): HolidayRow => ({ key, date, name });
const today = '2026-10-29';

describe('periods', () => {
    it('names whole years by year and other periods by their dates', () => {
        expect(coverageName({ effective_from: '2027-01-01', effective_to: '2027-12-31' })).toBe('2027');
        expect(coverageName({ effective_from: '2026-01-01', effective_to: '2027-12-31' })).toBe('2026 to 2027');
        expect(coverageName({ effective_from: '2026-07-01', effective_to: '2027-06-30' })).toBe('01/07/2026 to 30/06/2027');
    });

    it('moves calendar days across month and year ends', () => {
        expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
        expect(shiftDay('2028-03-01', -1)).toBe('2028-02-29');
    });

    it('summarises the list as joined periods', () => {
        expect(coverageSummary([year(2026), year(2027)])).toBe('2026 to 2027');
        expect(coverageSummary([year(2024), year(2026), year(2028)])).toBe('2024, 2026 and 2028');
        expect(coverageSummary([calendar('fy', '2026-07-01', '2027-06-30'), calendar('rest', '2027-07-01', '2027-12-31')])).toBe('01/07/2026 to 31/12/2027');
        expect(coverageSummary([])).toBe('');
    });

    it('shows the latest version of each year, with replaced versions as history, most recent first', () => {
        const first = year(2027, { id: 'a', recorded_at: '2026-01-01T00:00:00Z' });
        const second = year(2027, { id: 'b', supersedes_id: 'a', recorded_at: '2026-02-01T00:00:00Z' });
        const third = year(2027, { id: 'c', supersedes_id: 'b', recorded_at: '2026-03-01T00:00:00Z' });
        const all = [third, year(2026), first, second];
        expect(currentCalendars(all).map(c => c.id)).toEqual(['y2026', 'c']);
        expect(earlierVersions(all).map(c => c.id)).toEqual(['b', 'a']);
    });

    it('puts a date in its saved year, or starts its year, less any part already saved', () => {
        const saved = [calendar('fy', '2026-07-01', '2027-06-30'), year(2028)];
        expect(periodFor('2026-08-01', saved)).toBe(saved[0]);
        expect(periodFor('2027-09-01', saved)).toEqual({ effective_from: '2027-07-01', effective_to: '2027-12-31' });
        expect(periodFor('2026-03-01', saved)).toEqual({ effective_from: '2026-01-01', effective_to: '2026-06-30' });
        expect(periodFor('2029-03-01', saved)).toEqual({ effective_from: '2029-01-01', effective_to: '2029-12-31' });
    });
});

describe('holiday rows', () => {
    const saved = [year(2023), year(2026)];

    it('saves valid rows earliest first with trimmed names, ignoring blank rows', () => {
        const result = checkHolidayRows([row('1', '2027-12-25', ' Christmas Day '), row('2', '', '  '), row('3', '2026-01-01', "New Year's Day")], saved, today);
        expect(result.errors).toEqual({});
        expect(result.holidays).toEqual([{ date: '2026-01-01', name: "New Year's Day" }, { date: '2027-12-25', name: 'Christmas Day' }]);
    });

    it('puts the problem on the row that has it', () => {
        const { errors, holidays } = checkHolidayRows([
            row('ok', '2027-01-31', 'Independence Day'),
            row('no-date', '', 'Angam Day'),
            row('no-name', '2027-05-17', ''),
            row('too-far', '2031-01-01', "New Year's Day"),
            row('repeat', '2027-01-31', 'Independence Day (observed)'),
            row('saved-year', '2023-12-25', 'Christmas Day'),
        ], saved, today);
        expect(errors).toEqual({
            'no-date': 'Enter the date as DD/MM/YYYY.',
            'no-name': 'Enter the holiday name.',
            'too-far': 'Holidays can be added for 2025 to 2029.',
            repeat: '31/01/2027 is already listed as Independence Day.',
        });
        expect(holidays.map(h => h.date)).toEqual(['2023-12-25', '2027-01-31']);
    });

    it('copies a year to the next by day and month, leaving 29 February without a date when the year has none', () => {
        expect(copiedHolidays([{ date: '2028-12-25', name: 'Christmas Day' }, { date: '2028-02-29', name: 'Leap holiday' }], 2029))
            .toEqual([{ date: '', name: 'Leap holiday' }, { date: '2029-12-25', name: 'Christmas Day' }]);
    });
});

describe('saving the list', () => {
    const y2026 = year(2026, { holidays: [{ date: '2026-01-01', name: "New Year's Day" }, { date: '2026-12-25', name: 'Xmas' }, { date: '2026-12-28', name: 'Holiday' }] });
    const y2027 = year(2027, { label: 'Nauru Gazette 2027', holidays: [{ date: '2027-01-01', name: "New Year's Day" }] });
    const current = [y2026, y2027];
    const unchanged = [...y2026.holidays, ...y2027.holidays];

    it('writes the reason for the record, so HR does not have to type one', () => {
        const coverage = { effective_from: '2028-01-01', effective_to: '2028-12-31' };
        expect(saveReason(coverage, [{ date: '2028-01-01', name: "New Year's Day" }])).toBe('Saved the public holidays for 2028 (1 holiday).');
        expect(saveReason(coverage, [])).toBe('Saved the public holidays for 2028 (no holidays).');
        expect(saveReason({ effective_from: '2027-07-01', effective_to: '2027-12-31' }, [])).toBe('Saved the public holidays from 01/07/2027 to 31/12/2027 (no holidays).');
        const changed = [{ date: '2026-01-01', name: "New Year's Day" }, { date: '2026-12-25', name: 'Christmas Day' }, { date: '2026-12-26', name: 'Boxing Day' }];
        expect(saveReason(y2026, changed, y2026)).toBe('Updated the public holidays for 2026: 1 added, 1 removed, 1 renamed.');
        expect(saveReason(y2026, y2026.holidays, y2026)).toBeNull();
    });

    it('saves nothing when no holiday changed', () => {
        expect(planHolidaySave({ holidays: unchanged, current, source: 'Gazette No. 9 of 2027' })).toEqual([]);
    });

    it('saves a new version of each changed year and starts a new year, leaving other years alone', () => {
        const holidays = [...unchanged.map(h => h.date === '2026-12-25' ? { ...h, name: 'Christmas Day' } : h), { date: '2028-01-01', name: "New Year's Day" }];
        expect(planHolidaySave({ holidays, current, source: ' Gazette No. 9 of 2027 ', note: ' Corrected spelling ' })).toEqual([
            {
                label: 'Public holidays 2026', effective_from: '2026-01-01', effective_to: '2026-12-31', supersedes_id: 'y2026',
                holidays: [{ date: '2026-01-01', name: "New Year's Day" }, { date: '2026-12-25', name: 'Christmas Day' }, { date: '2026-12-28', name: 'Holiday' }],
                source_reference: 'Gazette No. 9 of 2027', reason: 'Updated the public holidays for 2026: 1 renamed. · Corrected spelling',
            },
            {
                label: 'Public holidays 2028', effective_from: '2028-01-01', effective_to: '2028-12-31',
                holidays: [{ date: '2028-01-01', name: "New Year's Day" }],
                source_reference: 'Gazette No. 9 of 2027', reason: 'Saved the public holidays for 2028 (1 holiday). · Corrected spelling',
            },
        ]);
    });

    it('keeps a year with all its holidays removed, as a new version with none, under its own label', () => {
        const [request] = planHolidaySave({ holidays: y2026.holidays, current, source: 'Gazette No. 9 of 2027' });
        expect(request).toMatchObject({ label: 'Nauru Gazette 2027', supersedes_id: 'y2027', holidays: [], reason: 'Updated the public holidays for 2027: 1 removed.' });
    });

    it('moves a holiday between years as a removal from one and an addition to the other', () => {
        const holidays = [...y2026.holidays.filter(h => h.date !== '2026-12-28'), ...y2027.holidays, { date: '2027-12-27', name: 'Holiday' }];
        expect(planHolidaySave({ holidays, current, source: 'Gazette' }).map(r => r.reason)).toEqual([
            'Updated the public holidays for 2026: 1 removed.', 'Updated the public holidays for 2027: 1 added.',
        ]);
    });
});

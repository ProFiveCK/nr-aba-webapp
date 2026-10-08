import { describe, expect, it } from 'vitest';
import { australianDateError, formatDate, formatDateTime, parseAustralianDate, toDateInputValue, toIsoDate, todayIsoDate } from './date';

/** Minutes the test machine is ahead of UTC (Naoero is +720). */
const offsetMinutes = -new Date().getTimezoneOffset();

describe('Australian date entry and display', () => {
    it('reads ambiguous dates as day/month/year and keeps ISO submission values', () => {
        expect(parseAustralianDate('07/10/2026')).toBe('2026-10-07');
        expect(parseAustralianDate('1/9/2026')).toBe('2026-09-01');
        expect(formatDate('2026-09-01')).toBe('01/09/2026');
        expect(formatDate('2026-09-01T00:00:00.000Z')).toBe('01/09/2026');
    });

    it('rejects rolled-over dates, incomplete input and US month-first values', () => {
        for (const value of ['31/02/2026', '31/04/2026', '10/31/2026', '00/01/2026', '01/00/2026', '07/10/', '2026-10-07']) {
            expect(parseAustralianDate(value)).toBe('');
            expect(australianDateError(value)).toBe('Enter a valid date as DD/MM/YYYY.');
        }
    });

    it('validates Gregorian leap days including century years', () => {
        expect(parseAustralianDate('29/02/2028')).toBe('2028-02-29');
        expect(parseAustralianDate('29/02/2026')).toBe('');
        expect(parseAustralianDate('29/02/1900')).toBe('');
        expect(parseAustralianDate('29/02/2000')).toBe('2000-02-29');
    });

    it('keeps range restrictions inclusive and reports them in Australian format', () => {
        expect(australianDateError('07/10/2026', '2026-10-07', '2026-10-07')).toBe('');
        expect(australianDateError('06/10/2026', '2026-10-07')).toBe('Enter a date on or after 07/10/2026.');
        expect(australianDateError('08/10/2026', undefined, '2026-10-07')).toBe('Enter a date on or before 07/10/2026.');
        expect(australianDateError('')).toBe('');
    });

    it('handles missing display dates and localises audit instants to Nauru', () => {
        expect(formatDate(null)).toBe('—');
        expect(formatDate('2026-02-31')).toBe('—');
        expect(formatDateTime('2026-10-06T13:00:00Z')).toContain('07/10/2026');
        expect(formatDateTime('not a date')).toBe('—');
    });
});

describe('toIsoDate', () => {
    it('keeps the local calendar day', () => {
        expect(toIsoDate(new Date(2026, 0, 1))).toBe('2026-01-01');
        expect(toIsoDate(new Date(2026, 8, 24))).toBe('2026-09-24');
    });

    it('pads single-digit months and days', () => {
        expect(toIsoDate(new Date(2026, 2, 7))).toBe('2026-03-07');
    });

    it('does not shift across a year boundary at local midnight', () => {
        // The regression this file exists for: at UTC+12 the old
        // toISOString().slice(0, 10) turned this into 2025-12-31, so the
        // "This year" preset asked the API for the wrong year entirely.
        expect(toIsoDate(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01');
    });

    it('handles the last moment of a day', () => {
        expect(toIsoDate(new Date(2026, 5, 30, 23, 59, 59))).toBe('2026-06-30');
    });

    it.runIf(offsetMinutes > 0)('disagrees with toISOString ahead of UTC', () => {
        // Guards the fix itself: where the bug was possible, prove the helper
        // is not simply doing what the old code did.
        const midnight = new Date(2026, 0, 1);
        expect(midnight.toISOString().slice(0, 10)).toBe('2025-12-31');
        expect(toIsoDate(midnight)).toBe('2026-01-01');
    });
});

describe('toDateInputValue', () => {
    it('takes a plain date string verbatim', () => {
        expect(toDateInputValue('2026-09-24')).toBe('2026-09-24');
    });

    it('takes the date part of a timestamp verbatim, without reparsing', () => {
        // A UTC timestamp near midnight must not be shifted into the next day
        // just because the viewer is ahead of UTC.
        expect(toDateInputValue('2026-09-24T00:00:00.000Z')).toBe('2026-09-24');
    });

    it('reads a Date as its local calendar day', () => {
        expect(toDateInputValue(new Date(2026, 0, 1))).toBe('2026-01-01');
    });

    it('gives an empty string for missing or unusable input', () => {
        expect(toDateInputValue(null)).toBe('');
        expect(toDateInputValue(undefined)).toBe('');
        expect(toDateInputValue('')).toBe('');
        expect(toDateInputValue('not a date')).toBe('');
        expect(toDateInputValue(new Date('nonsense'))).toBe('');
    });
});

describe('todayIsoDate', () => {
    it('agrees with the local clock', () => {
        const now = new Date();
        expect(todayIsoDate()).toBe(
            `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        );
    });
});

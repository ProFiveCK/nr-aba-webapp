import { describe, expect, it } from 'vitest';
import { appointmentTiming, filterDepartments, organisationPage, organisationQuery } from './organisationBrowse';

const departments = Array.from({ length: 50 }, (_, index) => ({
    id: `department-${index}`, name: `Department ${String(index + 1).padStart(2, '0')}`,
    divisions: [{ id: `division-${index}`, name: index === 49 ? 'Treasury services' : `Division ${index + 1}` }],
}));

describe('organisation browsing at government scale', () => {
    it('finds a division in the fiftieth department before pagination', () => {
        const matches = filterDepartments(departments, ' TREASURY ');
        expect(organisationPage(matches, 0).rows.map((row) => row.id)).toEqual(['department-49']);
        expect(matches[0].divisions[0].name).toBe('Treasury services');
    });
    it('pages every existing department exactly once without changing reference names or order', () => {
        const original = structuredClone(departments);
        const sorted = filterDepartments([...departments].reverse(), '');
        const seen = Array.from({ length: 5 }, (_, page) => organisationPage(sorted, page).rows).flat();
        expect(seen).toEqual(departments);
        expect(new Set(seen.map((row) => row.id)).size).toBe(50);
        expect(departments).toEqual(original);
    });
    it('clamps a stale page after filtering or removing records, including no results', () => {
        expect(organisationPage(filterDepartments(departments, 'Treasury'), 4).page).toBe(0);
        expect(organisationPage([], 4)).toMatchObject({ page: 0, pageCount: 0, rows: [] });
        expect(organisationPage(departments, -1).page).toBe(0);
    });
    it('treats appointment end dates as inclusive', () => {
        expect(appointmentTiming('2026-10-01', '2026-10-07', '2026-10-07')).toBe('current');
        expect(appointmentTiming('2026-10-07T00:00:00.000Z', null, '2026-10-07')).toBe('current');
        expect(appointmentTiming('2026-10-08', null, '2026-10-07')).toBe('upcoming');
        expect(appointmentTiming('2026-10-01', '2026-10-06', '2026-10-07')).toBe('ended');
    });
});


describe('organisation API query contract', () => {
    it('opens both appointment lists without empty UUID or enum parameters', () => {
        const initial = organisationQuery(0, { search: '', department_id: '', level: '', timing: '', scope: '' });
        expect(Object.fromEntries(initial)).toEqual({ page: '1', page_size: '10' });
    });
    it('preserves filters while paging beyond the initial fifty records', () => {
        const query = organisationQuery(5, { search: '  Treasury & Finance  ', department_id: 'e8ac61aa-b839-4ee9-83e8-d00e7a04613a', level: 'department', timing: 'current' });
        expect(new URLSearchParams(query.toString()).get('search')).toBe('Treasury & Finance');
        expect(query.get('department_id')).toBe('e8ac61aa-b839-4ee9-83e8-d00e7a04613a');
        expect(query.get('level')).toBe('department');
        expect(query.get('timing')).toBe('current');
        expect(query.get('page')).toBe('6');
    });
    it('represents government-wide offices without sending a non-UUID department', () => {
        const query = organisationQuery(0, { scope: 'government', department_id: '', level: 'hr_verifier' });
        expect(query.has('department_id')).toBe(false);
        expect(query.get('scope')).toBe('government');
        expect(query.get('level')).toBe('hr_verifier');
    });
});

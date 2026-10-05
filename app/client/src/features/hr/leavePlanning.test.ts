import { describe, expect, it } from 'vitest';
import { summarizeLeavePlanning } from './leavePlanning';
import type { StaffBalanceRow } from './staffTypes';

const employees: StaffBalanceRow[] = [
    {
        id: '1', display_name: 'Ana', department_code: 'FIN', division_code: '01',
        reviewer_id: null, email: null,
        balances: {
            Annual: { balance: 50, pending: 5 },
            Furlough: { balance: 14, pending: 4 },
        },
    },
    {
        id: '2', display_name: 'Ben', department_code: 'HR', division_code: '02',
        reviewer_id: null, email: null,
        balances: {
            Annual: { balance: 38, pending: 0 },
            Furlough: { balance: 0, pending: 0 },
        },
    },
];

describe('summarizeLeavePlanning', () => {
    it('subtracts pending leave and reports staff and days above each review line', () => {
        const summary = summarizeLeavePlanning(employees, 40, 0);

        expect(summary.annualAvailable).toBe(83);
        expect(summary.annualStaffAbove).toBe(1);
        expect(summary.annualDaysAbove).toBe(5);
        expect(summary.furloughAvailable).toBe(10);
        expect(summary.furloughStaffAbove).toBe(1);
        expect(summary.furloughDaysAbove).toBe(10);
        expect(summary.staffToReview).toBe(1);
        expect(summary.rows[0]).toMatchObject({
            display_name: 'Ana',
            annual: { available: 45, pending: 5, aboveLine: 5 },
            furlough: { available: 10, pending: 4, aboveLine: 10 },
        });
    });

    it('sorts the review list by total days above line', () => {
        const summary = summarizeLeavePlanning(employees, 30, 0);

        expect(summary.rows.map((row) => row.display_name)).toEqual(['Ana', 'Ben']);
    });
});
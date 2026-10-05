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
    it('reports available days per type, net of pending leave', () => {
        const summary = summarizeLeavePlanning(employees);

        expect(summary.annualAvailable).toBe(83);
        expect(summary.furloughAvailable).toBe(10);
        expect(summary.totalAvailable).toBe(93);
        expect(summary.rows[0]).toMatchObject({
            display_name: 'Ana',
            annual: { available: 45, pending: 5 },
            furlough: { available: 10, pending: 4 },
            total: 55,
        });
    });

    it('ranks everyone by total leave held, most first', () => {
        const summary = summarizeLeavePlanning(employees);

        expect(summary.rows.map((row) => row.display_name)).toEqual(['Ana', 'Ben']);
        expect(summary.highestTotal).toBe(55);
    });

    // No threshold: somebody holding nothing is still in the ranking, at the
    // bottom. The list answers "who holds the most", which has an answer for
    // everyone, rather than "who is past a line".
    it('lists staff holding no leave rather than dropping them', () => {
        const summary = summarizeLeavePlanning([
            ...employees,
            {
                id: '3', display_name: 'Cara', department_code: 'FIN', division_code: '01',
                reviewer_id: null, email: null,
                balances: { Annual: { balance: 0, pending: 0 } },
            },
        ]);

        expect(summary.staffCount).toBe(3);
        expect(summary.rows.at(-1)).toMatchObject({ display_name: 'Cara', total: 0 });
    });

    // Leave already applied for is spoken for, and an overdrawn balance is not
    // leave in hand — neither should inflate the ranking.
    it('never counts an overdrawn balance as leave held', () => {
        const summary = summarizeLeavePlanning([{
            id: '4', display_name: 'Dan', department_code: null, division_code: null,
            reviewer_id: null, email: null,
            balances: { Annual: { balance: 2, pending: 9 } },
        }]);

        expect(summary.rows[0].annual.available).toBe(0);
        expect(summary.totalAvailable).toBe(0);
    });

    it('breaks a tie on total by name, so the order is stable', () => {
        const tied: StaffBalanceRow[] = ['Zoe', 'Abe'].map((name, index) => ({
            id: String(index), display_name: name, department_code: null, division_code: null,
            reviewer_id: null, email: null,
            balances: { Annual: { balance: 7, pending: 0 } },
        }));

        expect(summarizeLeavePlanning(tied).rows.map((row) => row.display_name)).toEqual(['Abe', 'Zoe']);
    });
});

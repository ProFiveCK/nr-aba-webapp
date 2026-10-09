import { describe, expect, it } from 'vitest';
import { summarizeLeavePlanning } from './leavePlanning';
import type { PlanningEmployee } from './leavePlanning';
const employee = (id: string, balances: PlanningEmployee['balances'], department = 'FIN'): PlanningEmployee => ({
    id, display_name: id, department_code: department, division_code: '01', balances,
});
describe('whole-of-government leave planning', () => {
    it('groups current and legacy balances without adding furlough to recreation', () => {
        const result = summarizeLeavePlanning([
            employee('Legacy', { Annual: { balance: 50, pending: 5 }, Furlough: { balance: 99, pending: 0 }, 'Sick (with MC)': { balance: 7, pending: 1 }, 'Sick (without MC)': { balance: 3, pending: 0 } }),
            employee('Government', { Recreation: { balance: 21.77, pending: 0 }, Medical: { balance: 10, pending: 2 } }),
        ]);
        expect(result.rows[0]).toMatchObject({ recreation: 45, medical: 9, pending: 6 });
        expect(result.departments[0]).toMatchObject({ recreation: 66.77, medical: 17, staffCount: 2, pending: 8 });
    });
    it('keeps unrecorded balances distinct from zero and retains all staff', () => {
        const result = summarizeLeavePlanning([employee('Missing', {}), employee('Overdrawn', { Recreation: { balance: 2, pending: 9 } })]);
        expect(result.rows[0].recreation).toBeNull();
        expect(result.rows[1].recreation).toBe(0);
        expect(result.departments[0]).toMatchObject({ recreation: 0, medical: null, staffCount: 2 });
    });
    it('keeps departmental totals separate, including unassigned employees', () => {
        const result = summarizeLeavePlanning([employee('A', { Recreation: { balance: 10, pending: 0 } }), employee('B', {}, 'HR'), { ...employee('C', {}), department_code: null }]);
        expect(result.departments.map(row => [row.display_name, row.staffCount])).toEqual([['FIN', 1], ['HR', 1], ['Unassigned', 1]]);
    });
});

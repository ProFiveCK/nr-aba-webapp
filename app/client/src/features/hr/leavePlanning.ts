import type { StaffBalanceRow } from './staffTypes';

export interface LeavePlanningRow {
    id: string;
    display_name: string;
    department_code: string | null;
    division_code: string | null;
    annual: { available: number; pending: number };
    furlough: { available: number; pending: number };
    /** Annual plus furlough available — what the ranking is on. */
    total: number;
}

export interface LeavePlanningSummary {
    rows: LeavePlanningRow[];
    annualAvailable: number;
    furloughAvailable: number;
    totalAvailable: number;
    staffCount: number;
    /** The largest total held by one person, for reading the top of the list against. */
    highestTotal: number;
}

function balanceFor(employee: StaffBalanceRow, leaveType: string) {
    const balance = employee.balances[leaveType];
    const available = Math.max(0, (balance?.balance ?? 0) - (balance?.pending ?? 0));
    return { available, pending: balance?.pending ?? 0 };
}

/**
 * Every member of staff ranked by the leave they are holding, most first.
 *
 * There is deliberately no threshold here. "How much leave has built up, and
 * who has the most of it" is a question with an answer for everyone, and the
 * previous version could only answer it for people past a line — a line that
 * for annual leave was quietly the yearly allocation, which is an entitlement
 * and not a judgement about how much is too much. Management reads down from
 * the top and decides where to stop.
 *
 * Available is balance minus pending and never negative: leave already
 * applied for is spoken for, and an overdrawn balance is not leave in hand.
 */
export function summarizeLeavePlanning(employees: StaffBalanceRow[]): LeavePlanningSummary {
    const rows = employees
        .map((employee) => {
            const annual = balanceFor(employee, 'Annual');
            const furlough = balanceFor(employee, 'Furlough');
            return {
                id: employee.id,
                display_name: employee.display_name,
                department_code: employee.department_code,
                division_code: employee.division_code,
                annual,
                furlough,
                total: annual.available + furlough.available,
            };
        })
        .sort((a, b) => b.total - a.total || a.display_name.localeCompare(b.display_name));

    const annualAvailable = rows.reduce((sum, row) => sum + row.annual.available, 0);
    const furloughAvailable = rows.reduce((sum, row) => sum + row.furlough.available, 0);
    return {
        rows,
        annualAvailable,
        furloughAvailable,
        totalAvailable: annualAvailable + furloughAvailable,
        staffCount: rows.length,
        highestTotal: rows[0]?.total ?? 0,
    };
}

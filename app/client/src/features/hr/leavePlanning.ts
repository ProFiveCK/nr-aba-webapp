import type { StaffBalanceRow } from './staffTypes';

export interface LeavePlanningRow {
    id: string;
    display_name: string;
    department_code: string | null;
    division_code: string | null;
    annual: { available: number; pending: number; aboveLine: number };
    furlough: { available: number; pending: number; aboveLine: number };
    totalAboveLine: number;
}

export interface LeavePlanningSummary {
    rows: LeavePlanningRow[];
    annualAvailable: number;
    annualStaffAbove: number;
    annualDaysAbove: number;
    furloughAvailable: number;
    furloughStaffAbove: number;
    furloughDaysAbove: number;
    /** False when no furlough threshold is set, so furlough is not flagged at all. */
    furloughFlagged: boolean;
    staffToReview: number;
}

function balanceFor(employee: StaffBalanceRow, leaveType: string) {
    const balance = employee.balances[leaveType];
    const available = Math.max(0, (balance?.balance ?? 0) - (balance?.pending ?? 0));
    return { available, pending: balance?.pending ?? 0 };
}

/**
 * A `furloughReviewLine` of zero means no threshold has been set, not a
 * threshold of nothing: furlough is then left out of the review entirely
 * rather than flagging every positive balance.
 *
 * Annual is compared with its yearly allocation, which always exists. Furlough
 * has no allocation, so the only line it can be above is one a Leave Admin
 * names; until they do, "above" has nothing to mean. Treating zero as a real
 * line was how clearing the setting put every furlough holder on the list.
 */
export function summarizeLeavePlanning(
    employees: StaffBalanceRow[],
    annualReviewLine: number,
    furloughReviewLine: number
): LeavePlanningSummary {
    const furloughFlagged = Number(furloughReviewLine) > 0;
    const allRows = employees.map((employee) => {
        const annualBalance = balanceFor(employee, 'Annual');
        const furloughBalance = balanceFor(employee, 'Furlough');
        const annual = { ...annualBalance, aboveLine: Math.max(0, annualBalance.available - annualReviewLine) };
        const furlough = {
            ...furloughBalance,
            aboveLine: furloughFlagged ? Math.max(0, furloughBalance.available - furloughReviewLine) : 0,
        };
        return {
            id: employee.id,
            display_name: employee.display_name,
            department_code: employee.department_code,
            division_code: employee.division_code,
            annual,
            furlough,
            totalAboveLine: annual.aboveLine + furlough.aboveLine,
        };
    });
    const rows = allRows
        .filter((row) => row.totalAboveLine > 0)
        .sort((a, b) => b.totalAboveLine - a.totalAboveLine || a.display_name.localeCompare(b.display_name));

    return {
        rows,
        annualAvailable: allRows.reduce((total, row) => total + row.annual.available, 0),
        annualStaffAbove: allRows.filter((row) => row.annual.aboveLine > 0).length,
        annualDaysAbove: allRows.reduce((total, row) => total + row.annual.aboveLine, 0),
        furloughAvailable: allRows.reduce((total, row) => total + row.furlough.available, 0),
        furloughStaffAbove: allRows.filter((row) => row.furlough.aboveLine > 0).length,
        furloughDaysAbove: allRows.reduce((total, row) => total + row.furlough.aboveLine, 0),
        furloughFlagged,
        staffToReview: rows.length,
    };
}
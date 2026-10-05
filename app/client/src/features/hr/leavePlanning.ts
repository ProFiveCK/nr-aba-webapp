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
    staffToReview: number;
}

function balanceFor(employee: StaffBalanceRow, leaveType: string) {
    const balance = employee.balances[leaveType];
    const available = Math.max(0, (balance?.balance ?? 0) - (balance?.pending ?? 0));
    return { available, pending: balance?.pending ?? 0 };
}

export function summarizeLeavePlanning(
    employees: StaffBalanceRow[],
    annualReviewLine: number,
    furloughReviewLine: number
): LeavePlanningSummary {
    const allRows = employees.map((employee) => {
        const annualBalance = balanceFor(employee, 'Annual');
        const furloughBalance = balanceFor(employee, 'Furlough');
        const annual = { ...annualBalance, aboveLine: Math.max(0, annualBalance.available - annualReviewLine) };
        const furlough = { ...furloughBalance, aboveLine: Math.max(0, furloughBalance.available - furloughReviewLine) };
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
        staffToReview: rows.length,
    };
}
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type ResetPeriod = 'none' | 'financial_year' | 'anniversary';

export interface LeaveType {
    id: string;
    name: string;
    description: string | null;
    default_days: string;
    is_accruable: boolean;
    requires_note: boolean;
    is_active: boolean;
    accrual_days_per_fortnight: string;
    reset_period: ResetPeriod;
    usage_count?: number;
}

export interface LeaveBalance {
    id: string;
    leave_type_id: string;
    leave_type_name: string;
    balance: string;
    pending: string;
    year: number;
    requires_note?: boolean;
}

export interface Employee {
    id: string;
    reviewer_id: string | null;
    display_name: string;
    position_title: string | null;
    email: string | null;
    manager_id: string | null;
    manager_name?: string | null;
    department_code: string | null;
    join_date: string | null;
    status: 'active' | 'inactive';
    leave_entitled: boolean;
    /** Withheld by the API unless the caller is an HR administrator. */
    daily_rate?: number | string | null;
}

export interface LeaveApplication {
    id: string;
    employee_id: string;
    employee_name?: string;
    leave_type_id: string;
    leave_type_name: string;
    start_date: string;
    end_date: string;
    days: string;
    reason: string | null;
    status: LeaveStatus;
    applied_at: string;
    reviewed_at: string | null;
    reviewed_by_name?: string | null;
    reviewer_note: string | null;
    department_code?: string | null;
}

export interface MyLeaveResponse {
    employee: Employee;
    year: number;
    balances: LeaveBalance[];
    manager: { id: string; display_name: string; email: string | null } | null;
}

export const STATUS_STYLES: Record<LeaveStatus, string> = {
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-red-100 text-red-700',
    cancelled: 'bg-zinc-100 text-zinc-600',
};

export function formatDate(value: string | null): string {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export interface PublicHoliday {
    id: string;
    holiday_date: string;
    name: string;
}

/**
 * Working days between two dates, inclusive: weekdays that are not public
 * holidays.
 *
 * Mirrors `calculateWorkingDays` in the backend's `lib/leaveDates.js` so the
 * form can preview the figure the server will charge. The two must agree — if
 * they drift, the preview promises one number and the balance loses another.
 *
 * Dates are stepped as local calendar days, never through `toISOString`, which
 * would shift the day at UTC+12.
 */
export function calculateWorkingDays(start: string, end: string, holidays?: Iterable<string>): number {
    if (!start || !end) return 0;
    const [fromY, fromM, fromD] = start.split('-').map(Number);
    const [toY, toM, toD] = end.split('-').map(Number);
    if (!fromY || !toY) return 0;
    const from = new Date(fromY, fromM - 1, fromD);
    const to = new Date(toY, toM - 1, toD);
    if (to < from) return 0;

    const closed = holidays instanceof Set ? holidays : new Set(holidays ?? []);
    let days = 0;
    for (const cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
        const weekday = cursor.getDay();
        if (weekday === 0 || weekday === 6) continue;
        const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
        if (closed.has(iso)) continue;
        days += 1;
    }
    return days;
}

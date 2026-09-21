export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveType {
    id: string;
    name: string;
    description: string | null;
    default_days: string;
    is_accruable: boolean;
    requires_note: boolean;
    is_active: boolean;
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
    email: string | null;
    manager_id: string | null;
    manager_name?: string | null;
    department_code: string | null;
    join_date: string | null;
    status: 'active' | 'inactive';
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

/** Working days (Mon-Fri) inclusive — mirrors the server calculation so the
 *  form can preview the figure before submitting. */
export function calculateWorkingDays(start: string, end: string): number {
    if (!start || !end) return 0;
    const from = new Date(start);
    const to = new Date(end);
    if (to < from) return 0;
    let days = 0;
    for (const cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
        const weekday = cursor.getDay();
        if (weekday !== 0 && weekday !== 6) days += 1;
    }
    return days;
}

/** Shapes used by the staff directory, its importer and the balances report. */

export interface ImportRow {
    display_name: string;
    department_code: string;
    division_code: string;
    join_date: string;
    balances: Record<string, number>;
}

export interface ImportResult {
    created: { id: string; display_name: string }[];
    skipped: { display_name: string; reason: string }[];
}

export interface StaffBalanceEntry {
    balance: number;
    pending: number;
}

export interface StaffBalanceRow {
    id: string;
    display_name: string;
    department_code: string | null;
    division_code: string | null;
    reviewer_id: string | null;
    email: string | null;
    can_adjust_balance?: boolean;
    balances: Record<string, StaffBalanceEntry>;
}

export interface LeaveTypeRule {
    name: string;
    default_days: number;
    is_accruable: boolean;
}

export interface StaffBalancesResponse {
    year: number;
    as_of?: string;
    leave_types: string[];
    leave_type_rules?: LeaveTypeRule[];
    employees: StaffBalanceRow[];
}

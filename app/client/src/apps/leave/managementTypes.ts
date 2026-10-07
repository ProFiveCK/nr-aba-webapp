export type ManagedEmployee = {
    id: string; display_name: string; status: 'active' | 'inactive'; reviewer_id: string | null;
    department_id: string | null; division_id: string | null; department_code: string | null; division_code: string | null;
    external_ids?: { external_id: string }[]; employment_category?: string | null; is_intern?: boolean; is_teacher?: boolean; counts_for_service?: boolean | null;
    position_title?: string | null; email?: string | null; manager_id?: string | null; manager_name?: string | null; join_date?: string | null;
    account_name?: string | null; account_email?: string | null; account_type?: string; account_status?: string;
};
export type ServicePeriod = { correction_hash?: string; id: string; start_date: string; end_date: string | null; employment_category: string; is_teacher: boolean; is_intern: boolean; counts_for_service: boolean | null; work_pattern_id: string | null; appointment_reference: string | null; reason: string };
export type EmployeeProfile = { employee: ManagedEmployee; external_ids: { id: string; external_id: string; verified_at: string; reason: string }[]; service_periods: ServicePeriod[]; account_links: { id: string; reviewer_id: string | null; recorded_at: string; reason: string }[] };
export type WorkPattern = { id: string; name: string; working_weekdays: number[]; hours_per_day: string | null };
export type ApprovalAssignment = { id: string; level: 'division' | 'department' | 'chief_secretary'; department_id: string | null; division_id: string | null; department_name: string | null; division_name: string | null; approver_name: string; effective_from: string; effective_to: string | null; reason: string; employee_status: string; account_status: string | null; has_approval_grant: boolean; reviewer_id: string | null };
export type ApprovalChain = { ready: boolean; stages: { level: string; approver_name: string | null; issue: string | null }[] };
export const APPROVER_LABELS: Record<string, string> = { division: 'Divisional approver', department: 'Head of Department', chief_secretary: 'Chief Secretary' };
export const CATEGORIES = ['permanent', 'probationary', 'temporary', 'contract', 'casual', 'unknown'];

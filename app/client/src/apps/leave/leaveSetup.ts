export type LeavePolicyUsage = {
    as_of: string;
    counts: {
        active_employees: number;
        legacy_awaiting_migration: number;
        legacy_not_entitled: number;
        legacy_excluded_contracts: number;
        government_active: number;
        government_awaiting_activation: number;
        government_paused: number;
        government_missing_job_plans: number;
    };
    initial_setup: { adopted: boolean };
    current_policy: { id: string; label: string; effective_from: string; effective_to: string } | null;
    schedulers: { government: boolean; legacy: boolean };
};

export type AccountRole = 'user' | 'banking' | 'reviewer' | 'admin' | 'payroll' | 'public_health';

export interface AccessPreset {
    id: string;
    label: string;
    description: string;
    role: AccountRole;
    /** Capability keys to grant; an administrator gets every key the server offers. */
    capabilities: string[];
}

const LEAVE_BASICS = ['hr_access', 'hr_leave_apply'];

/**
 * The jobs people actually do, so an administrator picks one instead of a role plus
 * a page of capability ticks. Each fills in the role and the starting capabilities;
 * "Advanced access" still allows any combination.
 */
export const ACCESS_PRESETS: AccessPreset[] = [
    { id: 'leave-staff', label: 'Staff member (leave only)', description: 'Applies for their own leave and sees their balance.',
        role: 'user', capabilities: LEAVE_BASICS },
    { id: 'leave-approver', label: 'Leave approver', description: 'Also approves leave applications sent to them.',
        role: 'user', capabilities: [...LEAVE_BASICS, 'hr_leave_approve'] },
    { id: 'central-hr', label: 'Central HR officer', description: 'Manages staff, balances, reports and evidence across government.',
        role: 'user', capabilities: [...LEAVE_BASICS, 'hr_leave_approve', 'hr_staff_manage', 'hr_balance_manage', 'hr_report_read', 'hr_evidence_read', 'hr_admin'] },
    { id: 'preparer', label: 'ABA and FOREX TT preparer', description: 'Prepares payment batches and raises FOREX TT requests.',
        role: 'user', capabilities: ['aba_access', 'submit_aba', 'forex_tt_access', 'submit_forex_tt', ...LEAVE_BASICS] },
    { id: 'reviewer', label: 'Treasury reviewer', description: 'Reviews and rejects ABA batches, processes FOREX TT and reviews Fit for Duty batches.',
        role: 'reviewer', capabilities: ['aba_access', 'review_aba', 'forex_tt_access', 'review_forex_tt', 'public_health_review', ...LEAVE_BASICS] },
    { id: 'banking', label: 'Banking officer', description: 'Uses the Banking tools.',
        role: 'banking', capabilities: ['banking_access'] },
    { id: 'payroll', label: 'Payroll officer', description: 'Uses the Payroll tools.',
        role: 'payroll', capabilities: ['payroll_access'] },
    { id: 'fit-for-duty', label: 'Fit for Duty officer', description: 'Manages participants and pay periods.',
        role: 'public_health', capabilities: ['public_health_access', 'public_health_manage'] },
    { id: 'administrator', label: 'Administrator', description: 'Full administration of the portal, including all apps.',
        role: 'admin', capabilities: [] },
];

/** The capabilities a preset grants, limited to keys the server actually offers. */
export function presetCapabilities(preset: AccessPreset, offeredKeys: string[]): string[] {
    if (preset.role === 'admin') return [...offeredKeys];
    const offered = new Set(offeredKeys);
    return preset.capabilities.filter((key) => offered.has(key));
}

export const presetById = (id: string) => ACCESS_PRESETS.find((preset) => preset.id === id);

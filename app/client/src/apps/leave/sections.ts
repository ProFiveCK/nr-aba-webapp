export type LeaveSection =
    | 'overview' | 'my-leave' | 'approvals' | 'calendar' | 'employees' | 'settings' | 'staff' | 'report' | 'policies';

export interface LeaveSectionDef {
    id: LeaveSection;
    label: string;
    /** Any one of these opens the section. */
    capabilities: string[];
}

/**
 * The Leave app's sections, in the order they appear, each a real URL under
 * `/leave`.
 *
 * Access is any-of rather than all-of: an approver who is not an
 * administrator still gets Approvals, and an administrator gets it without
 * being anyone's manager.
 */
export const LEAVE_SECTIONS: LeaveSectionDef[] = [
    { id: 'overview', label: 'Overview', capabilities: ['hr_admin'] },
    { id: 'my-leave', label: 'My Leave', capabilities: ['hr_leave_apply'] },
    { id: 'approvals', label: 'Approvals', capabilities: ['hr_leave_approve', 'hr_admin'] },
    { id: 'calendar', label: 'Calendar', capabilities: ['hr_access'] },
    { id: 'employees', label: 'Employees', capabilities: ['hr_staff_manage', 'hr_balance_manage', 'hr_admin'] },
    { id: 'report', label: 'Report', capabilities: ['hr_report_read', 'hr_admin'] },
    { id: 'settings', label: 'Settings', capabilities: ['hr_admin'] },
];

/**
 * The sections this account may open, in display order.
 *
 * Empty is a real answer, not a bug: `hr_access` can be granted on its own,
 * which lets someone into the app without enabling anything inside it.
 */
export function visibleLeaveSections(
    permissions: Record<string, boolean> | undefined | null
): LeaveSectionDef[] {
    return LEAVE_SECTIONS.filter((section) =>
        section.capabilities.some((capability) => permissions?.[capability] === true));
}

/**
 * Where `/leave` should land, and where an unknown or forbidden section falls
 * back to. Null when the account can open nothing.
 */
export function defaultLeaveSection(
    permissions: Record<string, boolean> | undefined | null
): LeaveSection | null {
    return visibleLeaveSections(permissions)[0]?.id ?? null;
}

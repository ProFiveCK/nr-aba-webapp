import { describe, expect, it } from 'vitest';
import { defaultLeaveSection, visibleLeaveSections } from './sections';

const idsFor = (permissions: Record<string, boolean>) =>
    visibleLeaveSections(permissions).map((section) => section.id);

describe('visibleLeaveSections', () => {
    it('gives an administrator every section', () => {
        expect(idsFor({
            hr_access: true, hr_admin: true, hr_leave_apply: true,
            hr_leave_approve: true, hr_staff_manage: true,
        })).toEqual(['overview', 'my-leave', 'approvals', 'calendar', 'staff', 'report', 'policies']);
    });

    it('gives an ordinary member of staff their own leave and the calendar', () => {
        expect(idsFor({ hr_access: true, hr_leave_apply: true })).toEqual(['my-leave', 'calendar']);
    });

    // Any-of, not all-of: approving is one capability, administering another.
    it('opens approvals for an approver who is not an administrator', () => {
        expect(idsFor({ hr_access: true, hr_leave_approve: true })).toEqual(['approvals', 'calendar']);
    });

    it('opens approvals for an administrator who approves nobody directly', () => {
        expect(idsFor({ hr_admin: true })).toContain('approvals');
    });

    it('withholds policies from everyone but an administrator', () => {
        expect(idsFor({ hr_staff_manage: true, hr_leave_approve: true })).not.toContain('policies');
    });

    // hr_access can be granted on its own, which lets someone into the app
    // without enabling anything inside it.
    it('returns nothing when no leave capability is held', () => {
        expect(idsFor({})).toEqual([]);
        expect(visibleLeaveSections(undefined)).toEqual([]);
        expect(visibleLeaveSections(null)).toEqual([]);
    });

    it('ignores a capability that is present but false', () => {
        expect(idsFor({ hr_admin: false, hr_leave_apply: true })).toEqual(['my-leave']);
    });
});

describe('defaultLeaveSection', () => {
    it('lands an administrator on the overview', () => {
        expect(defaultLeaveSection({ hr_admin: true })).toBe('overview');
    });

    it('lands an ordinary member of staff on their own leave', () => {
        expect(defaultLeaveSection({ hr_access: true, hr_leave_apply: true })).toBe('my-leave');
    });

    it('lands someone with only calendar access on the calendar', () => {
        expect(defaultLeaveSection({ hr_access: true })).toBe('calendar');
    });

    it('is null when there is nothing to land on', () => {
        expect(defaultLeaveSection({})).toBeNull();
    });
});

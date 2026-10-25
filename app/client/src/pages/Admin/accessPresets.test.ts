import { describe, expect, it } from 'vitest';
import { ACCESS_PRESETS, presetById, presetCapabilities } from './accessPresets';

const offered = ['hr_access', 'hr_leave_apply', 'hr_leave_approve', 'aba_access', 'admin'];

describe('access presets', () => {
    it('have unique ids and every non-admin preset grants something', () => {
        expect(new Set(ACCESS_PRESETS.map((p) => p.id)).size).toBe(ACCESS_PRESETS.length);
        for (const preset of ACCESS_PRESETS.filter((p) => p.role !== 'admin')) expect(preset.capabilities.length).toBeGreaterThan(0);
    });

    it('give a leave-only staff member Leave access and nothing else', () => {
        expect(presetCapabilities(presetById('leave-staff')!, offered)).toEqual(['hr_access', 'hr_leave_apply']);
    });

    it('add approval for an approver', () => {
        expect(presetCapabilities(presetById('leave-approver')!, offered)).toContain('hr_leave_approve');
    });

    it('drop keys the server does not offer instead of sending them', () => {
        expect(presetCapabilities(presetById('preparer')!, ['aba_access'])).toEqual(['aba_access']);
    });

    it('give an administrator everything offered', () => {
        expect(presetCapabilities(presetById('administrator')!, offered)).toEqual(offered);
    });
});

import {describe,it,expect} from 'vitest';
import {policyVersionLabel} from './policyVersionLabel';
describe('published policy display name',()=>{
 it('uses status to remove a historical draft suffix without changing the stored name',()=>{const name='Government Leave (Review Draft)';expect(policyVersionLabel(name,'published')).toBe('Government Leave');expect(name).toBe('Government Leave (Review Draft)');expect(policyVersionLabel(name,'draft')).toBe(name);});
 it('preserves unrelated words and actual draft records',()=>{expect(policyVersionLabel('Drafting Leave Guidelines','published')).toBe('Drafting Leave Guidelines');expect(policyVersionLabel('Government Leave (Draft)','deleted')).toBe('Government Leave (Draft)');});
});

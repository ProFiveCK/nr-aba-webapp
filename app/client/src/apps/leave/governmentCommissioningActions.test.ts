import {beforeEach,expect,it,vi} from 'vitest';
import {apiClient} from '../../lib/api';
import {migrateInitialCohort} from './governmentCommissioningActions';
vi.mock('../../lib/api',()=>({apiClient:{post:vi.fn()}}));
const post=vi.mocked(apiClient.post),review={id:'saved-review',snapshot_hash:'exact-reviewed-hash'};
const plan={initial_admin_setup:true,employees:[{employee_id:'staff-1',medical_history:[]}],history_confirmed:true};
beforeEach(()=>post.mockReset());
it('one action saves the exact preview then applies the returned review',async()=>{
 post.mockResolvedValueOnce(review).mockResolvedValueOnce({review_id:review.id});const onPrepared=vi.fn();
 await migrateInitialCohort({plan,snapshotHash:'preview-hash',savedReview:null,onPrepared});
 expect(post.mock.calls[0]).toEqual(['/hr/government/workflow/commissioning',{...plan,snapshot_hash:'preview-hash'}]);
 expect(onPrepared).toHaveBeenCalledWith(review);expect(post.mock.calls[1]).toEqual([`/hr/government/workflow/commissioning/${review.id}/apply`,{snapshot_hash:review.snapshot_hash,reason:expect.any(String)}]);
});
it('never applies when saving rejects a changed or unready preview',async()=>{
 post.mockRejectedValueOnce(new Error('Preview the current cohort again.'));const onPrepared=vi.fn();
 await expect(migrateInitialCohort({plan,snapshotHash:'old',savedReview:null,onPrepared})).rejects.toThrow('Preview the current cohort again');
 expect(post).toHaveBeenCalledTimes(1);expect(onPrepared).not.toHaveBeenCalled();
});
it('retains a saved review after an apply failure and resumes it without freezing again',async()=>{
 post.mockResolvedValueOnce(review).mockRejectedValueOnce(new Error('Network request failed'));const onPrepared=vi.fn();
 await expect(migrateInitialCohort({plan,snapshotHash:'preview',savedReview:null,onPrepared})).rejects.toThrow('Network');expect(onPrepared).toHaveBeenCalledWith(review);
 post.mockReset().mockResolvedValue({review_id:review.id});
 await migrateInitialCohort({plan,snapshotHash:'preview',savedReview:review,onPrepared});
 expect(post).toHaveBeenCalledTimes(1);expect(post.mock.calls[0][0]).toBe(`/hr/government/workflow/commissioning/${review.id}/apply`);
});
it('does not bypass independent certification for a non-initial review',async()=>{
 await expect(migrateInitialCohort({plan:{initial_admin_setup:false},snapshotHash:'hash',savedReview:review,onPrepared:vi.fn()})).rejects.toThrow('independent certification');expect(post).not.toHaveBeenCalled();
});

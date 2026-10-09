import {apiClient} from '../../lib/api';

export type SavedMigrationReview={id:string;snapshot_hash:string};
const root='/hr/government/workflow/commissioning';

/** Keep the saved review available if applying fails, so a retry resumes it. */
export async function migrateInitialCohort({plan,snapshotHash,savedReview,onPrepared}:{
 plan:{initial_admin_setup?:boolean};snapshotHash:string;savedReview:SavedMigrationReview|null;
 onPrepared:(review:SavedMigrationReview)=>void;
}){
 if(plan.initial_admin_setup!==true)throw new Error('Use independent certification for this review.');
 const review=savedReview||await apiClient.post<SavedMigrationReview>(root,{...plan,snapshot_hash:snapshotHash});
 onPrepared(review);
 return apiClient.post(`${root}/${review.id}/apply`,{snapshot_hash:review.snapshot_hash,reason:'Applied the reviewed initial Treasury migration and carried the verified stored credits.'});
}

import {ServiceError} from '../lib/serviceError.js';

// This context exists only inside the atomic initial-cohort operation. A
// request field cannot authorise self-certification in the underlying APIs.
const initialMigrations=new WeakMap();
export function initialAdminReview(client,actorId,employeeId) {
 const migration=initialMigrations.get(client);
 return migration?.actorId===actorId&&migration.employees.has(employeeId)?migration.reviewId:null;
}
export async function assertInitialAdmin(client,actorId) {
 const {rows:[account]}=await client.query('SELECT role,status,onboarding_state FROM reviewers WHERE id=$1 FOR SHARE',[actorId]);
 if(account?.role!=='admin'||account.status!=='active'||account.onboarding_state!=='ready')throw new ServiceError(403,'An active system administrator is required for initial admin migration.');
}
export async function withInitialAdminMigration(client,review,actor,work) {
 await assertInitialAdmin(client,actor.id);
 if(review.prepared_by!==actor.id||review.plan.initial_admin_setup!==true)throw new ServiceError(403,'Initial admin migration must use the administrator’s own reviewed cohort.');
 if(initialMigrations.has(client))throw new ServiceError(409,'An initial migration is already being applied.');
 initialMigrations.set(client,{reviewId:review.id,actorId:actor.id,employees:new Set(review.plan.employees.map(e=>e.employee_id))});
 try{return await work();}finally{initialMigrations.delete(client);}
}
export async function firstAdminJobReview(client,actorId,employeeId,code) {
 const {rows:[review]}=await client.query(`SELECT r.id FROM hr_gov_commissioning_reviews r
 JOIN hr_gov_commissioning_receipts c ON c.review_id=r.id
 JOIN reviewers a ON a.id=c.actor_id
 WHERE r.prepared_by=$1 AND c.actor_id=$1 AND a.role='admin' AND a.status='active' AND a.onboarding_state='ready'
 AND r.plan->>'initial_admin_setup'='true'
 AND c.result @> jsonb_build_array(jsonb_build_object('employee_id',$2::text))
 AND NOT EXISTS(SELECT 1 FROM hr_gov_job_plans p WHERE p.employee_id=$2::uuid AND p.code=$3 AND p.status='published')
 ORDER BY c.recorded_at DESC LIMIT 1`,[actorId,employeeId,code]);
 return review?.id||null;
}

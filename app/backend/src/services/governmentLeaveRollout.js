import {withTransaction} from '../lib/transaction.js';
import {ServiceError} from '../lib/serviceError.js';
import {fingerprint,serviceFacts,units} from '../lib/governmentLeaveRules.js';
import {loadContext} from './governmentLeave.js';
import {assertCutoverResolved} from './governmentLeaveCutover.js';
import {assertCentral,accountState,configurationFor,effectiveOffices,bindingIssue,routeLevels,today} from './governmentLeaveWorkflow.js';
import {currentPayrollSnapshot} from './governmentLeavePayroll.js';
import {recordAudit} from './auditService.js';

export const EVIDENCE_KEYS=['policy_cases','access_review','capacity','restore','training','support','assisted_cases','single_accrual_engine'];
const fail=(message,status=409)=>{throw new ServiceError(status,message);};
const text=(v,label,min=5,max=500)=>{if(typeof v!=='string'||v.trim().length<min||v.length>max)fail(`Provide ${label} (${min}–${max} characters).`,400);return v.trim();};
function ids(values){if(!Array.isArray(values)||!values.length||values.length>50||values.some(v=>typeof v!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v)))fail('Choose 1–50 distinct employee records.',400);const canonical=values.map(v=>v.toLowerCase());if(new Set(canonical).size!==canonical.length)fail('Choose 1–50 distinct employee records.',400);return canonical.sort();}
export async function employeeReadiness(client,employeeId){
 const employee=(await client.query('SELECT id,display_name,department_id,division_id,reviewer_id,status,leave_policy_regime FROM hr_employees WHERE id=$1',[employeeId])).rows[0];
 if(!employee)fail('Employee not found.',404);
 const issues=[],context=await loadContext(client,employeeId),date=today(),facts=serviceFacts(context,date),config=await configurationFor(client,employeeId);
 const references=(await client.query("SELECT external_id FROM hr_employee_external_ids WHERE employee_id=$1 AND source='techone_payroll' AND verified_by IS NOT NULL ORDER BY external_id",[employeeId])).rows;
 if(employee.status!=='active'||employee.leave_policy_regime!=='government')issues.push('An active government appointment is required.');
 if(!employee.department_id||!employee.division_id)issues.push('Verify department and division placement.');
 if(references.length!==1)issues.push('Reconcile one verified current Payroll ID for the cohort.');
 const account=employee.reviewer_id?await accountState(client,employee.reviewer_id):null;
 if(!account||account.user.permissions?.hr_leave_apply!==true||account.user.permissions?.hr_access!==true)issues.push('Verify an active employee login with Leave access.');
 if(account?.user.must_change_password)issues.push('The employee must complete the required password change.');
 issues.push(...facts.issues);
 const period=context.periods.find(p=>p.start_date<=date&&(!p.end_date||p.end_date>=date)),pattern=context.patterns.find(p=>p.id===period?.work_pattern_id);
 if(facts.basis?.schedule_mode==='weekly'&&(!pattern||!context.pattern_approvals.some(a=>a.work_pattern_id===pattern.id)))issues.push('Verify the current weekly work pattern.');
 if(facts.basis?.schedule_mode==='roster')issues.push('Roster cohort needs a separately reviewed coverage plan; use assisted processing until that plan is approved.');
 const policy=context.policies.find(p=>p.effective_from<=date&&p.effective_to>=date);
 if(!policy)issues.push('Publish a current policy.');
 if(!context.calendars.some(c=>c.effective_from<=date&&c.effective_to>=date))issues.push('Publish a current holiday calendar.');
 if(!config||!['recreation','medical','special'].every(c=>config.enabled_codes.includes(c)))issues.push('Independently activate the three common types under Applications & jobs.');
 for(const code of ['recreation','medical','special']){
  const entitlement=context.entitlements.find(e=>e.code===code&&e.period_start===facts.period_start&&e.period_end===facts.period_end&&e.as_of<=date);
  if(!entitlement){issues.push(`Certify the current ${code} opening.`);continue;}
  if(units(entitlement.available)<0n)issues.push(`Reconcile over-held ${code} entitlement.`);
  if(policy){
   const limit=policy.rules[code==='recreation'?'recreation_cap_days':`${code}_annual_days`];
   const prior=code==='medical'&&config?.medical_period_start===entitlement.period_start?(config.medical_history||[]).reduce((n,h)=>n+units(h.charge||'0'),0n):0n;
   const used=(await client.query("SELECT COALESCE(-SUM(amount),0)::text AS amount FROM hr_gov_ledger WHERE entitlement_id=$1 AND (kind='use' OR (kind='reversal' AND reverses_id IN (SELECT id FROM hr_gov_ledger WHERE kind='use')))",[entitlement.id])).rows[0].amount;
   if(units(entitlement.balance)+(code==='recreation'?0n:units(used)+prior)>units(limit))issues.push(`Reconcile the ${code} quantum and historical usage.`);
  }
 }
 try{await assertCutoverResolved(client,employeeId);}catch(e){if(!e.status)throw e;issues.push(e.message);}
 const offices=[];
 for(const level of [...new Set(['recreation','medical','special'].flatMap(routeLevels))]){
  const matches=await effectiveOffices(client,employee,level);
  if(matches.length!==1){issues.push(`Assign one current ${level.replaceAll('_',' ')} officeholder.`);continue;}
  const office=matches[0],stage={level,binding:{...office,assignment_id:office.id}};
  const issue=await bindingIssue(client,{...employee,employee_id:employeeId,submitted_by:employee.reviewer_id},stage);
  if(issue)issues.push(`${level.replaceAll('_',' ')}: ${issue}`);
  offices.push({level,id:office.id,approver_employee_id:office.approver_employee_id,reviewer_id:office.reviewer_id,issue});
 }
 return {employee_id:employeeId,display_name:employee.display_name,department_id:employee.department_id,payroll_id:references[0]?.external_id||null,ready:issues.length===0,issues:[...new Set(issues)],facts_hash:fingerprint({date,employee,context,config,account,references,offices})};
}
async function snapshot(client,employeeIds){const employees=[];for(const id of ids(employeeIds))employees.push(await employeeReadiness(client,id));return {as_of:today(),employees,ready:employees.filter(e=>e.ready).length,total:employees.length};}
export async function previewWave(pool,user,employeeIds){return withTransaction(pool,async client=>{await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await assertCentral(client,user);return snapshot(client,employeeIds);});}
async function cycles(client,batchIds,employeeIds){
 if(!Array.isArray(batchIds)||batchIds.length!==2||new Set(batchIds).size!==2)fail('Select two distinct reconciled Payroll cycles.',400);
 const result=[];
 for(const id of batchIds){
  const row=(await client.query('SELECT b.*,r.reference AS receipt FROM hr_gov_payroll_batches b LEFT JOIN hr_gov_payroll_receipts r ON r.batch_id=b.id WHERE b.id=$1',[id])).rows[0];
  if(!row?.receipt||(await client.query('SELECT 1 FROM hr_gov_payroll_batches WHERE supersedes_id=$1',[id])).rowCount)fail('Each Payroll cycle must be the latest independently reconciled register.');
  if(!row.snapshot.lines.some(l=>employeeIds.includes(l.employee_id)))fail('Both Payroll cycles must contain representative grants from this cohort.');
  const payroll_ids=Object.fromEntries(row.snapshot.lines.map(l=>[l.employee_id,l.payroll_id]));
  const current=await currentPayrollSnapshot(client,{period_start:row.period_start,period_end:row.period_end,payroll_ids});
  if(fingerprint({...current,changes:[]})!==fingerprint({...row.snapshot,changes:[]}))fail('Payroll grants changed after reconciliation. Prepare and reconcile the new register version.');
  result.push({id:row.id,period_start:row.period_start,period_end:row.period_end,snapshot_hash:row.snapshot_hash,receipt:row.receipt});
 }
 if(result[0].period_start<=result[1].period_end&&result[0].period_end>=result[1].period_start)fail('The two Payroll cycles must not overlap.');
 return result.sort((a,b)=>a.period_start.localeCompare(b.period_start));
}
export async function prepareWave(pool,{user,actor,data}){
 const employeeIds=ids(data.employee_ids),label=text(data.label,'a cohort name'),reason=text(data.reason,'a review reason',10,1000),source=text(data.source_reference,'the release authority'),evidence={};
 if(!['rehearsal','pilot','department'].includes(data.kind))fail('Choose rehearsal, pilot or department release.',400);
 for(const key of EVIDENCE_KEYS)evidence[key]=text(data.evidence?.[key],`${key.replaceAll('_',' ')} evidence`);
 return withTransaction(pool,async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext('hr-gov-rollout'))");await assertCentral(client,user);
  const payload={employee_ids:employeeIds,label,reason,source_reference:source,kind:data.kind,evidence,payroll_batch_ids:data.payroll_batch_ids},payloadHash=fingerprint(payload);
  const old=(await client.query('SELECT * FROM hr_gov_rollout_waves WHERE id=$1',[data.wave_id])).rows[0];
  if(old){if(old.payload_hash!==payloadHash||old.prepared_by!==actor.id)fail('Cohort key already has different review facts.');return old;}
  const state=await snapshot(client,employeeIds),payrollCycles=await cycles(client,data.payroll_batch_ids,employeeIds);
  const frozen={...state,payroll_cycles:payrollCycles,evidence};
  const row=(await client.query('INSERT INTO hr_gov_rollout_waves(id,label,kind,employee_ids,prepared_by,source_reference,reason,payload_hash,snapshot_hash,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[data.wave_id,label,data.kind,employeeIds,actor.id,source,reason,payloadHash,fingerprint(frozen),frozen])).rows[0];
  await recordAudit({client,actor,action:'hr.gov.rollout.prepared',entityType:'hr_gov_rollout_wave',entityId:row.id,after:{snapshot_hash:row.snapshot_hash,ready:state.ready,total:state.total,kind:row.kind}});return row;
 });
}
export async function approveWave(pool,{user,actor,id,data}){
 const reason=text(data.reason,'an independent review reason',10,1000);
 return withTransaction(pool,async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext('hr-gov-rollout'))");await assertCentral(client,user);
  const row=(await client.query('SELECT * FROM hr_gov_rollout_waves WHERE id=$1',[id])).rows[0];if(!row)fail('Cohort review not found.',404);
  if(row.prepared_by===actor.id)fail('A different central HR officer must approve the cohort.',403);
  if(row.snapshot_hash!==data.snapshot_hash)fail('Confirm the exact reviewed cohort checksum.');
  const old=(await client.query('SELECT * FROM hr_gov_rollout_approvals WHERE wave_id=$1',[id])).rows[0];
  if(old){if(old.actor_id!==actor.id||old.reason!==reason)fail('The cohort already has a different approval.');return old;}
  const current=await snapshot(client,row.employee_ids),payrollCycles=await cycles(client,row.snapshot.payroll_cycles.map(c=>c.id),row.employee_ids);
  if(current.ready!==current.total)fail('Resolve every employee preparation issue before approving this cohort.');
  if(fingerprint({...current,payroll_cycles:payrollCycles,evidence:row.snapshot.evidence})!==row.snapshot_hash)fail('Cohort facts changed. Prepare a fresh review.');
  const approval=(await client.query('INSERT INTO hr_gov_rollout_approvals(wave_id,actor_id,snapshot_hash,reason) VALUES($1,$2,$3,$4) RETURNING *',[id,actor.id,row.snapshot_hash,reason])).rows[0];
  await recordAudit({client,actor,action:'hr.gov.rollout.approved',entityType:'hr_gov_rollout_wave',entityId:id,after:approval});return approval;
 });
}
export async function initGovernmentLeaveRolloutSchema(client){
 await client.query(`CREATE TABLE IF NOT EXISTS hr_gov_rollout_waves(id UUID PRIMARY KEY,label TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('rehearsal','pilot','department')),employee_ids UUID[] NOT NULL CHECK(cardinality(employee_ids) BETWEEN 1 AND 50),prepared_by UUID NOT NULL REFERENCES reviewers(id),source_reference TEXT NOT NULL,reason TEXT NOT NULL,payload_hash TEXT NOT NULL,snapshot_hash TEXT NOT NULL,snapshot JSONB NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS hr_gov_job_runs(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),started_at TIMESTAMPTZ NOT NULL,finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),summary JSONB NOT NULL);
 CREATE TABLE IF NOT EXISTS hr_gov_rollout_approvals(wave_id UUID PRIMARY KEY REFERENCES hr_gov_rollout_waves(id),actor_id UUID NOT NULL REFERENCES reviewers(id),snapshot_hash TEXT NOT NULL,reason TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS idx_hr_gov_rollout_queue ON hr_gov_rollout_waves(recorded_at DESC,id);`);
 for(const table of ['hr_gov_rollout_waves','hr_gov_rollout_approvals','hr_gov_job_runs']){await client.query(`DROP TRIGGER IF EXISTS ${table}_immutable ON ${table}`);await client.query(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION hr_gov_immutable()`);}
}

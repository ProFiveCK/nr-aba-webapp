import {submitCase} from './governmentLeaveCases.js';
import {isCase} from '../lib/governmentLeaveCaseRules.js';
import {createHash} from 'node:crypto';
import {ServiceError} from '../lib/serviceError.js';
import {withTransaction} from '../lib/transaction.js';
import {recordAudit} from './auditService.js';
import * as ledger from './governmentLeave.js';
import {submitRequest,assertCentral,today} from './governmentLeaveWorkflow.js';
import {fingerprint,dayNumber,serviceFacts,COMMON_CODES,CODES,units,decimal} from '../lib/governmentLeaveRules.js';
import {PAYROLL_FORMAT,HANDOVER_FORMAT,payrollLines,payrollDiff,payrollTotals} from '../lib/governmentLeavePayrollRules.js';

const fail=(message,status=409)=>{throw new ServiceError(status,message);};
const text=(v,label,min=5,max=500)=>{if(typeof v!=='string'||v.trim().length<min||v.length>max)fail(`Record ${label} (${min}–${max} characters).`,400);return v.trim();};
const reason=v=>text(v,'a verification reason',10,1000);
const audit=(client,actor,action,id,after)=>recordAudit({client,actor,action,entityType:'hr_gov_payroll',entityId:id,after});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const requestDates="to_char(r.start_date,'YYYY-MM-DD') AS start_date,to_char(r.end_date,'YYYY-MM-DD') AS end_date";

async function identities(client, employeeIds, selection={}) {
  const rows=(await client.query("SELECT e.id,e.display_name,x.external_id FROM hr_employees e LEFT JOIN hr_employee_external_ids x ON x.employee_id=e.id AND x.source='techone_payroll' AND x.verified_by IS NOT NULL WHERE e.id=ANY($1::uuid[]) ORDER BY e.id,x.external_id",[employeeIds])).rows;
  const result={};
  for(const row of rows){const entry=result[row.id] ||= {name:row.display_name,ids:[]};if(row.external_id)entry.ids.push(row.external_id);}
  for(const [id,entry] of Object.entries(result)) entry.payroll_id=selection[id]?(entry.ids.includes(selection[id])?selection[id]:null):entry.ids.length===1?entry.ids[0]:null;
  return result;
}
export async function currentPayrollSnapshot(client,data,{preview=false}={}) {
  const requests=(await client.query(`SELECT r.id,r.employee_id,r.code,${requestDates},r.grant_snapshot,
    a.effect AS amendment,a.request_id AS amendment_request_id
    FROM hr_gov_requests r LEFT JOIN hr_gov_case_effects a ON a.original_request_id=r.id
    WHERE r.status='approved' AND r.start_date<=$2 AND r.end_date>=$1 ORDER BY r.id`,[data.period_start,data.period_end])).rows;
  const ids=[...new Set(requests.map(r=>r.employee_id))],people=await identities(client,ids,data.payroll_ids || {});
  const {lines,issues}=payrollLines(requests,people,data.period_start,data.period_end);
  if(issues.length&&!preview)fail(issues.slice(0,10).join(' '));
  if(lines.length>100000)fail('Choose a shorter Payroll period; the register exceeds 100,000 dated instructions.',400);
  if(preview)return {issues,identities:people,line_count:lines.length};
  return {format:PAYROLL_FORMAT,period_start:data.period_start,period_end:data.period_end,lines,totals:payrollTotals(lines),
    source_grants:requests.map(r=>({request_id:r.id,grant_hash:fingerprint(r.grant_snapshot),amendment_request_id:r.amendment_request_id || null})),
    exchange_semantics:'Replace the previous register for this exact period. Apply correction rows only after reconciling the superseded version. This export does not execute payments.'};
}
export async function previewPayroll(pool,user,data) {
  dayNumber(data.period_start);dayNumber(data.period_end);
  if(data.period_end<data.period_start||dayNumber(data.period_end)-dayNumber(data.period_start)>61)fail('Choose a Payroll period of up to 62 days.',400);
  return withTransaction(pool,async client=>{await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await assertCentral(client,user);return currentPayrollSnapshot(client,data,{preview:true});});
}
export async function preparePayroll(pool,{user,actor,data}) {
  dayNumber(data.period_start);dayNumber(data.period_end);
  if(data.period_end<data.period_start || dayNumber(data.period_end)-dayNumber(data.period_start)>61)fail('Choose one Payroll period of up to 62 calendar days.',400);
  const normalized={period_start:data.period_start,period_end:data.period_end,source_reference:text(data.source_reference,'Salary Unit exchange authority'),reason:reason(data.reason),payroll_ids:data.payroll_ids||{}};
  if(typeof normalized.payroll_ids!=='object'||Array.isArray(normalized.payroll_ids)||Object.keys(normalized.payroll_ids).length>2000)fail('Use a bounded employee-to-verified-Payroll-ID selection.',400);
  const payloadHash=fingerprint(normalized);
  return withTransaction(pool,async client=>{
    // One sequence for overlapping Payroll windows; exact-period revisions are permitted.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hr-gov-payroll-register'))");await assertCentral(client,user);
    const old=(await client.query('SELECT * FROM hr_gov_payroll_batches WHERE id=$1',[data.batch_id])).rows[0];
    if(old){if(old.payload_hash!==payloadHash||old.prepared_by!==actor.id)fail('Batch key was already used for different exchange instructions.');return old;}
    if((await client.query("SELECT 1 FROM hr_gov_payroll_batches WHERE daterange(period_start,period_end,'[]') && daterange($1,$2,'[]') AND (period_start<>$1 OR period_end<>$2)",[data.period_start,data.period_end])).rowCount)fail('Payroll periods overlap. Revise the exact existing period to avoid duplicate instructions.');
    // Advisory lock serialises batches. A single SQL statement obtains the immutable grant/effect set.
    const prior=(await client.query('SELECT * FROM hr_gov_payroll_batches WHERE period_start=$1 AND period_end=$2 ORDER BY version DESC LIMIT 1',[data.period_start,data.period_end])).rows[0];
    const snapshot=await currentPayrollSnapshot(client,normalized);
    snapshot.changes=payrollDiff(prior?.snapshot.lines || [],snapshot.lines);
    const hash=fingerprint(snapshot);
    if(prior&&fingerprint({...snapshot,changes:[]})===fingerprint({...prior.snapshot,changes:[]}))fail(`No register changes since version ${prior.version}; download that version again.`);
    const row=(await client.query('INSERT INTO hr_gov_payroll_batches(id,period_start,period_end,version,supersedes_id,prepared_by,source_reference,reason,payload_hash,snapshot_hash,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[data.batch_id,data.period_start,data.period_end,(prior?.version||0)+1,prior?.id||null,actor.id,normalized.source_reference,normalized.reason,payloadHash,hash,snapshot])).rows[0];
    await audit(client,actor,'hr.gov.payroll.prepared',row.id,{version:row.version,lines:snapshot.lines.length,snapshot_hash:hash});return row;
  });
}
export async function payrollView(pool,user,id) {
  return withTransaction(pool,async client=>{await assertCentral(client,user);const row=(await client.query('SELECT b.*,a.reference AS receipt_reference,a.recorded_at AS acknowledged_at,NOT EXISTS(SELECT 1 FROM hr_gov_payroll_batches n WHERE n.supersedes_id=b.id) AS latest FROM hr_gov_payroll_batches b LEFT JOIN hr_gov_payroll_receipts a ON a.batch_id=b.id WHERE b.id=$1',[id])).rows[0];if(!row)fail('Payroll register not found.',404);return row;});
}
export async function acknowledgePayroll(pool,{user,actor,id,data}) {
  const reference=text(data.reference,'actual Salary Unit receipt'),why=reason(data.reason);
  return withTransaction(pool,async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hr-gov-payroll-register'))");await assertCentral(client,user);
    const batch=(await client.query('SELECT * FROM hr_gov_payroll_batches WHERE id=$1',[id])).rows[0];if(!batch)fail('Register not found.',404);
    if(data.snapshot_hash!==batch.snapshot_hash)fail('Confirm the checksum of the exact register received by Salary Unit.');
    const old=(await client.query('SELECT * FROM hr_gov_payroll_receipts WHERE batch_id=$1',[id])).rows[0];
    if(old){if(old.reference!==reference||old.snapshot_hash!==data.snapshot_hash||old.actor_id!==actor.id||old.reason!==why)fail('This version already has a different receipt.');return old;}
    if(batch.prepared_by===actor.id)fail('A different central HR officer must record the independent Salary Unit reconciliation.',403);
    if((await client.query('SELECT 1 FROM hr_gov_payroll_batches WHERE supersedes_id=$1',[id])).rowCount)fail('This version has been superseded; reconcile the latest version.');
    const current=await currentPayrollSnapshot(client,{period_start:batch.snapshot.period_start,period_end:batch.snapshot.period_end,payroll_ids:Object.fromEntries(batch.snapshot.lines.map(l=>[l.employee_id,l.payroll_id]))});
    if(fingerprint({...current,changes:[]})!==fingerprint({...batch.snapshot,changes:[]}))fail('Approved instructions changed. Prepare a new period version before acknowledgement.');
    if(batch.supersedes_id&&!data.corrections_reconciled)fail('Confirm reconciliation of the superseded version and every correction.');
    const row=(await client.query('INSERT INTO hr_gov_payroll_receipts(batch_id,actor_id,snapshot_hash,reference,reason) VALUES($1,$2,$3,$4,$5) RETURNING *',[id,actor.id,data.snapshot_hash,reference,why])).rows[0];
    await audit(client,actor,'hr.gov.payroll.acknowledged',id,{reference,snapshot_hash:data.snapshot_hash});return row;
  });
}

export async function migrationState(client,employeeId,cutover) {
  const context=await ledger.loadContext(client,employeeId),people=await identities(client,[employeeId]);
  const balances=(await client.query('SELECT b.*,t.name AS leave_type_name FROM hr_leave_balances b JOIN hr_leave_types t ON t.id=b.leave_type_id WHERE b.employee_id=$1 ORDER BY b.year,b.leave_type_id',[employeeId])).rows;
  const retained=(await client.query("SELECT id,leave_type_id,status,to_char(start_date,'YYYY-MM-DD') AS start_date,to_char(end_date,'YYYY-MM-DD') AS end_date,days FROM hr_leave_applications WHERE employee_id=$1 AND (status='pending' OR (status='approved' AND end_date>=$2)) ORDER BY id",[employeeId,cutover])).rows;
  const requests=(await client.query(`SELECT r.id,r.code,r.status,${requestDates},r.charge,r.payload_hash,r.stage_index,r.application_snapshot,r.grant_snapshot FROM hr_gov_requests r WHERE r.employee_id=$1 ORDER BY r.id`,[employeeId])).rows;
  const benefits=(await client.query('SELECT * FROM hr_gov_benefit_bases WHERE employee_id=$1 ORDER BY id',[employeeId])).rows;
  const commitments=(await client.query('SELECT * FROM hr_gov_benefit_commitments WHERE employee_id=$1 ORDER BY request_id',[employeeId])).rows;
  const effects=(await client.query('SELECT f.* FROM hr_gov_case_effects f JOIN hr_gov_requests r ON r.id=f.request_id WHERE r.employee_id=$1 ORDER BY f.request_id',[employeeId])).rows;
  const movements=(await client.query('SELECT l.* FROM hr_gov_ledger l JOIN hr_gov_entitlements e ON e.id=l.entitlement_id WHERE e.employee_id=$1 ORDER BY l.id',[employeeId])).rows;
  const configs=(await client.query('SELECT * FROM hr_gov_workflow_configs WHERE employee_id=$1 ORDER BY id',[employeeId])).rows;
  const state={context,identity:people[employeeId],historical_balances:balances,retained_legacy_leave:retained,government_requests:requests,benefit_bases:benefits,benefit_commitments:commitments,effects,movements,configs};
  return {state,hash:fingerprint(state)};
}
function migrationPlan(state,data) {
  const targets=data.targets,dispositions=data.dispositions||[];
  if(!Array.isArray(targets)||targets.length!==3||new Set(targets.map(t=>t.code)).size!==3||targets.some(t=>!COMMON_CODES.includes(t.code)))fail('Specify a reviewed Recreation, Medical and Special target.',400);
  if(!Array.isArray(dispositions)||dispositions.length!==state.retained_legacy_leave.length||new Set(dispositions.map(d=>d.legacy_request_id)).size!==dispositions.length)fail('Review every pending and future legacy application exactly once.',400);
  for(const d of dispositions) {
    const legacy=state.retained_legacy_leave.find(r=>r.id===d.legacy_request_id);if(!legacy)fail('A retained legacy application changed.');text(d.reference,'retained leave reconciliation');
    if(d.action==='portal_link') {
      const r=state.government_requests.find(r=>r.id===d.portal_request_id);
      if(!r||r.start_date!==legacy.start_date||r.end_date!==legacy.end_date||r.status!==legacy.status)fail('Link the same employee, dates and pending/approved state; fresh government approvals remain mandatory.');
      if(dispositions.filter(x=>x.portal_request_id===d.portal_request_id).length>1)fail('A government request cannot represent multiple legacy applications.');
    }else if(d.action==='transfer_with_fresh_approval') {
      if(!CODES.includes(d.code)||['amendment','attendance'].includes(d.code)||!/^([0-9a-f]{8}-[0-9a-f-]{27})$/i.test(d.portal_request_id||''))fail('Choose a supported transfer type and new government application key.',400);
      if(state.government_requests.some(r=>r.id===d.portal_request_id)||dispositions.filter(x=>x.portal_request_id===d.portal_request_id).length!==1)fail('Allocate a distinct unused government application key for each legacy transfer.');
    }else if(d.action!=='retain_external')fail('Retain externally or link a reviewed government application.',400);
  }
  if(!state.identity?.payroll_id)fail('Verify one unambiguous Payroll ID before migration.');
  const facts=serviceFacts(state.context,data.cutover_date);if(facts.issues.length)fail(facts.issues.join(' '));
  if(state.context.employee.leave_policy_regime!=='government')fail('Enroll this employee in the government regime first.');
  const policy=state.context.policies.find(p=>p.effective_from<=data.cutover_date&&p.effective_to>=data.cutover_date);if(!policy)fail('Publish the cutover policy first.');
  const rows=targets.map(t=>{
    let value;try{value=units(t.amount);}catch{fail('Use nonnegative target days with up to six decimals.',400);}
    if(value<0n)fail('Targets must be nonnegative.',400);
    const maximum=units(policy.rules[t.code==='recreation'?'recreation_cap_days':`${t.code}_annual_days`]);if(value>maximum)fail('The proposed balance exceeds the governing pool or cap. Obtain an approved transition before activation.');
    const account=state.context.entitlements.find(e=>e.code===t.code&&e.period_start===facts.period_start&&e.period_end===facts.period_end);
    if(account&&data.cutover_date<account.as_of)fail('A reconciliation cannot predate the certified opening.');
    if(account&&['medical','special'].includes(t.code)) {
      const latest=state.configs.filter(c=>c.status==='published').sort((a,b)=>new Date(b.approved_at)-new Date(a.approved_at))[0];
      const historical=t.code==='medical'&&String(latest?.medical_period_start||'').slice(0,10)===account.period_start?latest.medical_history.reduce((n,h)=>n+units(h.charge),0n):0n;
      const used=-state.movements.filter(m=>m.entitlement_id===account.id&&(m.kind==='use'||m.kind==='reversal'&&state.movements.some(old=>old.id===m.reverses_id&&old.kind==='use'))).reduce((n,m)=>n+units(m.amount),0n);
      if(value+used+historical>maximum)fail('Target plus recorded and historical usage exceeds the single annual pool. Reconcile the remaining credit.');
    }
    const current=account?units(account.balance):0n,held=account?units(account.held):0n;
    if(value<held)fail('Target would spend held entitlement; resolve pending leave first.');
    return {code:t.code,target:decimal(value),current:decimal(current),difference:decimal(value-current),held:decimal(held),entitlement_id:account?.id||null,policy_version_id:policy.id,period_start:facts.period_start,period_end:facts.period_end};
  });
  return {targets:rows,dispositions,external_pending_count:dispositions.filter(d=>d.action==='retain_external'||d.action==='transfer_with_fresh_approval').length,
    activation:'Separate independent workflow activation after medical history, authorities and all retained external leave are resolved. Certification does not enable login, grants or accrual jobs.'};
}
export async function previewMigration(pool,user,employeeId,cutover) {
  dayNumber(cutover);
  return withTransaction(pool,async client=>{await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await assertCentral(client,user);return (await migrationState(client,employeeId,cutover)).state;});
}
export async function prepareMigration(pool,{user,actor,employeeId,data}) {
  dayNumber(data.cutover_date);if(data.cutover_date>today())fail('Use a cutover reconciliation date on or before today.',400);
  const normalized={cutover_date:data.cutover_date,targets:data.targets,dispositions:data.dispositions||[],source_reference:text(data.source_reference,'certified HR opening source'),payroll_reference:text(data.payroll_reference,'Salary Unit opening reconciliation'),transition_reference:text(data.transition_reference,'signed historical leave-type and pool transition'),history_reference:text(data.history_reference,'verified service, Medical history and prior payout reconciliation'),reason:reason(data.reason)};
  return withTransaction(pool,async client=>{
    await assertCentral(client,user);await ledger.lockEmployee(client,employeeId);
    const old=(await client.query('SELECT * FROM hr_gov_migration_reviews WHERE id=$1',[data.review_id])).rows[0];
    if(old){if(old.employee_id!==employeeId||old.prepared_by!==actor.id||old.payload_hash!==fingerprint(normalized))fail('Review key was already used for a different migration.');return old;}
    const {state,hash}=await migrationState(client,employeeId,data.cutover_date),plan=migrationPlan(state,normalized);
    const row=(await client.query('INSERT INTO hr_gov_migration_reviews(id,employee_id,cutover_date,prepared_by,source_reference,payroll_reference,transition_reference,history_reference,reason,payload_hash,context_hash,plan,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',[data.review_id,employeeId,data.cutover_date,actor.id,normalized.source_reference,normalized.payroll_reference,normalized.transition_reference,normalized.history_reference,normalized.reason,fingerprint(normalized),hash,plan,state])).rows[0];
    await audit(client,actor,'hr.gov.migration.prepared',row.id,{employee_id:employeeId,context_hash:hash,targets:plan.targets});return row;
  });
}
export async function certifyMigration(pool,{user,actor,id,data}) {
  const why=reason(data.reason);
  return withTransaction(pool,async client=>{
    await assertCentral(client,user);
    const review=(await client.query("SELECT *,to_char(cutover_date,'YYYY-MM-DD') AS cutover_date FROM hr_gov_migration_reviews WHERE id=$1",[id])).rows[0];if(!review)fail('Migration review not found.',404);
    await ledger.lockEmployee(client,review.employee_id);
    const old=(await client.query('SELECT * FROM hr_gov_migration_certifications WHERE review_id=$1',[id])).rows[0];if(old)return old;
    if(review.prepared_by===actor.id)fail('A different central HR officer must certify the migration.',403);
    if(data.context_hash!==review.context_hash)fail('Confirm the exact reviewed migration checksum.');
    const current=await migrationState(client,review.employee_id,review.cutover_date);if(current.hash!==review.context_hash)fail('Identity, service, balances or retained leave changed. Prepare a fresh dry run.');
    migrationPlan(current.state,{cutover_date:review.cutover_date,targets:review.plan.targets.map(t=>({code:t.code,amount:t.target})),dispositions:review.plan.dispositions});
    const postings=[];
    for(const target of review.plan.targets) {
      let entitlementId=target.entitlement_id;
      if(!entitlementId) {
        const opening=await ledger.prepareOpening(pool,{client,user:{...user,id:review.prepared_by},actor:{id:review.prepared_by},employeeId:review.employee_id,data:{code:target.code,amount:target.target,policy_version_id:target.policy_version_id,period_start:target.period_start,period_end:target.period_end,as_of:review.cutover_date,source_reference:review.source_reference,payroll_reference:review.payroll_reference,reason:review.reason}});
        await ledger.certifyOpening(pool,{client,user,actor,id:opening.id,reason:why});
        entitlementId=(await client.query('SELECT id FROM hr_gov_entitlements WHERE opening_id=$1',[opening.id])).rows[0].id;
        postings.push({code:target.code,entitlement_id:entitlementId,opening_id:opening.id,amount:target.target});
      }else if(units(target.difference)!==0n) {
        const movement=await ledger.postMovement(client,{entitlementId,kind:'correction',amount:target.difference,effectiveDate:review.cutover_date,eventKey:`migration:${id}:${target.code}`,sourceReference:review.transition_reference,actor,reason:why});
        postings.push({code:target.code,entitlement_id:entitlementId,movement_id:movement.id,amount:target.difference});
      }
    }
    for(const d of review.plan.dispositions.filter(d=>d.action==='transfer_with_fresh_approval')) {
      const legacy=current.state.retained_legacy_leave.find(r=>r.id===d.legacy_request_id);
      const prior=(await client.query('SELECT * FROM hr_gov_legacy_transfers WHERE legacy_request_id=$1',[legacy.id])).rows[0];
      if(prior)fail('This legacy application already has a certified transfer. Reconcile its existing application.');
      await client.query('INSERT INTO hr_gov_legacy_transfers(legacy_request_id,request_id,employee_id,code,review_id,legacy_hash,source_reference,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[legacy.id,d.portal_request_id,review.employee_id,d.code,id,fingerprint(legacy),d.reference,actor.id]);
    }
    const row=(await client.query('INSERT INTO hr_gov_migration_certifications(review_id,actor_id,reason,postings) VALUES($1,$2,$3,$4) RETURNING *',[id,actor.id,why,JSON.stringify(postings)])).rows[0];
    await audit(client,actor,'hr.gov.migration.certified',id,{employee_id:review.employee_id,postings,external_pending_count:review.plan.external_pending_count});return row;
  });
}

export async function prepareHandover(pool,{user,actor,data}) {
  const employeeIds=[...new Set(data.employee_ids||[])].sort();if(!employeeIds.length||employeeIds.length>50)fail('Choose one to 50 employees for each portable handover part.',400);
  const normalized={employee_ids:employeeIds,include_documents:data.include_documents===true,source_reference:text(data.source_reference,'handover authority'),reason:reason(data.reason)};
  return withTransaction(pool,async client=>{
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await assertCentral(client,user);
    const old=(await client.query('SELECT * FROM hr_gov_handovers WHERE id=$1',[data.handover_id])).rows[0];if(old){if(old.payload_hash!==fingerprint(normalized)||old.prepared_by!==actor.id)fail('Handover key was already used differently.');return old;}
    const employees=[];
    for(const id of employeeIds) {
      const state=(await migrationState(client,id,today())).state;
      const employee=(await client.query('SELECT * FROM hr_employees WHERE id=$1',[id])).rows[0];
      const external_ids=(await client.query('SELECT * FROM hr_employee_external_ids WHERE employee_id=$1 ORDER BY id',[id])).rows;
      const requests=(await client.query(`SELECT r.id,r.status,r.code,${requestDates},r.application_snapshot,r.grant_snapshot,r.reason,r.stage_index,r.submitted_at,r.completed_at,r.final_pdf FROM hr_gov_requests r WHERE r.employee_id=$1 ORDER BY r.id`,[id])).rows;
      const requestIds=requests.map(r=>r.id);
      const stages=(await client.query('SELECT * FROM hr_gov_request_stages WHERE request_id=ANY($1::uuid[]) ORDER BY request_id,ordinal',[requestIds])).rows;
      const bindings=(await client.query('SELECT b.* FROM hr_gov_stage_bindings b JOIN hr_gov_request_stages s ON s.id=b.stage_id WHERE s.request_id=ANY($1::uuid[]) ORDER BY b.recorded_at,b.id',[requestIds])).rows;
      const decisions=(await client.query('SELECT * FROM hr_gov_decisions WHERE request_id=ANY($1::uuid[]) ORDER BY decided_at,id',[requestIds])).rows;
      const documents=(await client.query('SELECT * FROM hr_gov_request_documents WHERE request_id=ANY($1::uuid[]) ORDER BY id',[requestIds])).rows.map(({file_data,...d})=>({...d,...(normalized.include_documents?{file_data_base64:file_data.toString('base64')}:{})}));
      const legacy=(await client.query('SELECT * FROM hr_leave_applications WHERE employee_id=$1 ORDER BY id',[id])).rows;
      const legacy_documents=(await client.query('SELECT d.* FROM hr_leave_attachments d JOIN hr_leave_applications a ON a.id=d.application_id WHERE a.employee_id=$1 ORDER BY d.id',[id])).rows.map(({file_data,...d})=>({...d,sha256:file_data?digest(file_data):null,...(normalized.include_documents&&file_data?{file_data_base64:file_data.toString('base64')}:{})}));
      const tasks=(await client.query('SELECT * FROM hr_gov_case_tasks WHERE request_id=ANY($1::uuid[]) ORDER BY id',[requestIds])).rows;
      const task_events=(await client.query('SELECT e.* FROM hr_gov_task_events e JOIN hr_gov_case_tasks t ON t.id=e.task_id WHERE t.request_id=ANY($1::uuid[]) ORDER BY e.recorded_at,e.id',[requestIds])).rows;
      const jobs=(await client.query('SELECT * FROM hr_gov_job_plans WHERE employee_id=$1 ORDER BY id',[id])).rows;
      const job_posts=(await client.query('SELECT * FROM hr_gov_job_posts WHERE employee_id=$1 ORDER BY id',[id])).rows;
      const reservations=(await client.query('SELECT * FROM hr_gov_reservation_requests WHERE employee_id=$1 ORDER BY id',[id])).rows;
      const holds=(await client.query('SELECT h.* FROM hr_gov_reservations h JOIN hr_gov_reservation_requests r ON r.id=h.request_id WHERE r.employee_id=$1 ORDER BY h.id',[id])).rows;
      const case_holds=(await client.query('SELECT h.* FROM hr_gov_case_credit_holds h JOIN hr_gov_requests r ON r.id=h.request_id WHERE r.employee_id=$1 ORDER BY h.determination_id',[id])).rows;
      const determinations=(await client.query('SELECT * FROM hr_gov_case_determinations WHERE request_id=ANY($1::uuid[]) ORDER BY request_id,version',[requestIds])).rows;
      const links=(await client.query('SELECT * FROM hr_gov_case_links WHERE request_id=ANY($1::uuid[]) ORDER BY request_id',[requestIds])).rows;
      const migrations=(await client.query('SELECT r.*,c.postings,c.actor_id AS certified_by FROM hr_gov_migration_reviews r LEFT JOIN hr_gov_migration_certifications c ON c.review_id=r.id WHERE employee_id=$1 ORDER BY r.recorded_at,r.id',[id])).rows;
      const openings=(await client.query('SELECT * FROM hr_gov_openings WHERE employee_id=$1 ORDER BY id',[id])).rows;
      const cancellations=(await client.query('SELECT * FROM hr_gov_request_cancellations WHERE request_id=ANY($1::uuid[]) ORDER BY request_id',[requestIds])).rows;
      const salary_acknowledgements=(await client.query('SELECT * FROM hr_gov_salary_acknowledgements WHERE request_id=ANY($1::uuid[]) ORDER BY request_id',[requestIds])).rows;
      const continuations=(await client.query('SELECT * FROM hr_gov_continuations WHERE request_id=ANY($1::uuid[]) OR original_request_id=ANY($1::uuid[]) ORDER BY request_id',[requestIds])).rows;
      const reservation_events=(await client.query('SELECT e.* FROM hr_gov_reservation_events e JOIN hr_gov_reservation_requests r ON r.id=e.request_id WHERE r.employee_id=$1 ORDER BY e.id',[id])).rows;
      const legacy_transfers=(await client.query('SELECT * FROM hr_gov_legacy_transfers WHERE employee_id=$1 ORDER BY legacy_request_id',[id])).rows;
      const legacy_adjustments=(await client.query('SELECT * FROM hr_leave_adjustments WHERE employee_id=$1 ORDER BY id',[id])).rows;
      const legacy_types=(await client.query('SELECT * FROM hr_leave_types ORDER BY id')).rows;
      employees.push({employee,external_ids,...state,requests:requests.map(({final_pdf,...r})=>({...r,final_pdf_sha256:final_pdf?digest(final_pdf):null,...(final_pdf?{final_pdf_base64:final_pdf.toString('base64')}:{})})),stages,bindings,decisions,documents,legacy,legacy_documents,tasks,task_events,jobs,job_posts,reservations,holds,case_holds,determinations,links,migrations,openings,cancellations,salary_acknowledgements,continuations,reservation_events,legacy_adjustments,legacy_types,legacy_transfers});
    }
    const registers=(await client.query('SELECT b.*,a.reference AS receipt_reference FROM hr_gov_payroll_batches b LEFT JOIN hr_gov_payroll_receipts a ON a.batch_id=b.id ORDER BY b.period_start,b.version')).rows;
    // Per-part exchange history is redacted to selected employees, including removed correction rows.
    const payroll_registers=registers.map(b=>({...b,snapshot:{...b.snapshot,lines:b.snapshot.lines.filter(l=>employeeIds.includes(l.employee_id)),totals:b.snapshot.totals.filter(l=>employeeIds.includes(l.employee_id)),changes:b.snapshot.changes.filter(c=>employeeIds.includes((c.before||c.after).employee_id)),source_grants:b.snapshot.source_grants.filter(g=>employees.some(e=>e.requests.some(r=>r.id===g.request_id)))},original_snapshot_hash:b.snapshot_hash}));
    const organisation={departments:(await client.query('SELECT * FROM hr_departments ORDER BY id')).rows,divisions:(await client.query('SELECT * FROM hr_divisions ORDER BY id')).rows,enterprise_approvers:(await client.query('SELECT * FROM hr_approval_assignments ORDER BY id')).rows,consent_offices:(await client.query('SELECT * FROM hr_gov_consent_offices ORDER BY id')).rows,consent_withdrawals:(await client.query('SELECT * FROM hr_gov_consent_withdrawals ORDER BY office_id')).rows};
    const snapshot={organisation,format:HANDOVER_FORMAT,captured_at:new Date().toISOString(),employee_ids:employeeIds,employees,payroll_registers,includes_evidence:normalized.include_documents,
      receiving_controls:{rehearsal_only:true,enable_receiving_accrual:false,requirements:['Reconcile every employee/type and pending/future request against this manifest.','Preserve UUIDs, exact text Payroll IDs, source links and certified history.','Verify every PDF/evidence checksum; use a part with evidence for a complete archive.','Agree a signed freeze boundary, stop portal jobs and submissions, capture final changes, then activate one receiving accrual engine.','A receipt records review and does not perform a cutover or activate TechnologyOne.']}};
    if(Buffer.byteLength(JSON.stringify(snapshot))>50*1024*1024)fail('Handover part exceeds 50 MiB. Select fewer employees or export evidence in smaller parts.',400);
    const hash=fingerprint(snapshot),row=(await client.query('INSERT INTO hr_gov_handovers(id,prepared_by,source_reference,reason,payload_hash,snapshot_hash,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[data.handover_id,actor.id,normalized.source_reference,normalized.reason,fingerprint(normalized),hash,snapshot])).rows[0];
    await audit(client,actor,'hr.gov.handover.prepared',row.id,{employee_count:employeeIds.length,snapshot_hash:hash,includes_evidence:normalized.include_documents});return row;
  });
}
export async function handoverView(pool,user,id) {
  return withTransaction(pool,async client=>{await assertCentral(client,user);const row=(await client.query('SELECT h.*,r.reference AS receipt_reference FROM hr_gov_handovers h LEFT JOIN hr_gov_handover_receipts r ON r.handover_id=h.id WHERE h.id=$1',[id])).rows[0];if(!row)fail('Handover part not found.',404);return row;});
}
export async function acknowledgeHandover(pool,{user,actor,id,data}) {
  const reference=text(data.reference,'receiving-system rehearsal reconciliation'),why=reason(data.reason);
  return withTransaction(pool,async client=>{
    await assertCentral(client,user);await client.query('SELECT id FROM hr_gov_handovers WHERE id=$1 FOR UPDATE',[id]);
    const h=(await client.query('SELECT * FROM hr_gov_handovers WHERE id=$1',[id])).rows[0];if(!h)fail('Handover not found.',404);
    if(h.snapshot_hash!==data.snapshot_hash)fail('Confirm the exact handover checksum.');
    const old=(await client.query('SELECT * FROM hr_gov_handover_receipts WHERE handover_id=$1',[id])).rows[0];if(old){if(old.reference!==reference||old.actor_id!==actor.id||old.reason!==why)fail('This handover already has a different receipt.');return old;}
    if(h.prepared_by===actor.id)fail('A different central HR officer must verify the handover rehearsal.',403);
    const row=(await client.query('INSERT INTO hr_gov_handover_receipts(handover_id,actor_id,reference,snapshot_hash,reason) VALUES($1,$2,$3,$4,$5) RETURNING *',[id,actor.id,reference,data.snapshot_hash,why])).rows[0];await audit(client,actor,'hr.gov.handover.acknowledged',id,{reference});return row;
  });
}

export async function submitLegacyTransfer(pool,{user,actor,id,data,documents=[]}) {
 return withTransaction(pool,async client=>{
  await assertCentral(client,user);
  const t=(await client.query('SELECT * FROM hr_gov_legacy_transfers WHERE legacy_request_id=$1',[id])).rows[0];if(!t)fail('Certified transfer not found.',404);
  await ledger.lockEmployee(client,t.employee_id);
  const legacy=(await client.query("SELECT to_char(start_date,'YYYY-MM-DD') AS start_date,to_char(end_date,'YYYY-MM-DD') AS end_date FROM hr_leave_applications WHERE id=$1",[id])).rows[0];
  const input={request_id:t.request_id,code:t.code,...legacy,reason:reason(data.reason),medical_mode:t.code==='medical'?data.medical_mode:'not_applicable',related_request_id:data.related_request_id||null,event_reference:`legacy-transfer:${id}`,assisted_reference:t.source_reference};
  if(t.code==='medical'&&!['certificate','exemption'].includes(input.medical_mode))fail('Choose the verified Medical evidence mode.',400);
  return (isCase(t.code)?submitCase:submitRequest)(pool,{client,user,actor,employeeId:t.employee_id,data:input,documents});
 });
}

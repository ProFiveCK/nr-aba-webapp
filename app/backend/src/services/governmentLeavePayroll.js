import {ServiceError} from '../lib/serviceError.js';
import {withTransaction} from '../lib/transaction.js';
import {recordAudit} from './auditService.js';
import {assertCentral} from './governmentLeaveWorkflow.js';
import {fingerprint,dayNumber} from '../lib/governmentLeaveRules.js';
import {PAYROLL_FORMAT,payrollLines,payrollDiff,payrollTotals} from '../lib/governmentLeavePayrollRules.js';

const fail=(message,status=409)=>{throw new ServiceError(status,message);};
const text=(v,label,min=5,max=500)=>{if(typeof v!=='string'||v.trim().length<min||v.length>max)fail(`Record ${label} (${min}–${max} characters).`,400);return v.trim();};
const reason=v=>text(v,'a verification reason',10,1000);
const audit=(client,actor,action,id,after)=>recordAudit({client,actor,action,entityType:'hr_gov_payroll',entityId:id,after});
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
    FROM hr_gov_requests r LEFT JOIN LATERAL (SELECT * FROM hr_gov_case_effects WHERE original_request_id=r.id ORDER BY version DESC LIMIT 1) a ON TRUE
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

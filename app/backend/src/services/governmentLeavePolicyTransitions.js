import {ServiceError} from '../lib/serviceError.js';
import {dayNumber} from '../lib/governmentLeaveRules.js';
import {recordAudit} from './auditService.js';
import {configurationReviewMode} from './governmentLeaveAdministration.js';
const fail=(message,status=409)=>{throw new ServiceError(status,message);};
// Original published facts never change. A separately signed transition closes
// their governing coverage without rewriting historical snapshots or references.
export const resolvedPublishedPoliciesSql=`SELECT p.*,
  to_char(p.effective_from,'YYYY-MM-DD') AS effective_from,
  to_char(LEAST(p.effective_to,COALESCE(t.effective_from-1,p.effective_to)),'YYYY-MM-DD') AS effective_to,
  to_char(p.effective_to,'YYYY-MM-DD') AS original_effective_to,
  t.successor_id AS replaced_by_policy_id
  FROM hr_gov_policy_versions p LEFT JOIN hr_gov_policy_transitions t ON t.predecessor_id=p.id
  WHERE p.status='published' ORDER BY p.effective_from,p.id`;
export function validateReplacementFields(data) {
  if(data.supersedes_policy_id&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.supersedes_policy_id))fail('Choose the published policy being replaced.',400);
  if(data.supersedes_policy_id&&(typeof data.authority_reference!=='string'||data.authority_reference.trim().length<10||data.authority_reference.trim().length>500))fail('Record the signed replacement decision reference (10–500 characters).',400);
}
export async function approvePolicyReplacement(client,{row,user=actor,actor,reason,expected_revision}) {
  const {rows:policies}=await client.query(resolvedPublishedPoliciesSql);
  const start=dayNumber(row.effective_from instanceof Date?row.effective_from.toISOString().slice(0,10):row.effective_from),end=dayNumber(row.effective_to instanceof Date?row.effective_to.toISOString().slice(0,10):row.effective_to);
  const overlapping=policies.filter(p=>dayNumber(p.effective_from)<=end&&dayNumber(p.effective_to)>=start);
  if(!row.supersedes_policy_id) {
    if(overlapping.length)fail('Published policy dates overlap. Select the current policy to replace and record its signed authority.');
    return;
  }
  validateReplacementFields(row);
  if(expected_revision===undefined)fail('Reload and review the replacement revision before approval.');
  const preparer=row.last_prepared_by||row.prepared_by;
  if(!preparer)fail('Record who prepared the replacement before publishing.',403);
  const reviewMode=await configurationReviewMode(client,{user,actor,preparedBy:preparer});
  const prior=policies.find(p=>p.id===row.supersedes_policy_id);
  if(!prior||prior.replaced_by_policy_id)fail('The selected policy has already been replaced or is not published. Refresh and select its current successor.');
  if(start<=dayNumber(prior.effective_from)||start>dayNumber(prior.effective_to)||end<dayNumber(prior.effective_to))fail('A replacement must start within the current policy period, after its first day, and cover its remaining dates.');
  if(overlapping.some(p=>p.id!==prior.id))fail('The replacement would overlap another governing policy. Review its end date.');
  // Backdated changes cannot reinterpret posted credit or a completed grant.
  const blocked=await client.query(`SELECT 1 FROM hr_gov_job_posts WHERE event_date>=$1 AND event_date<=$2
    UNION ALL SELECT 1 FROM hr_gov_requests WHERE status='approved' AND end_date>=$1 AND start_date<=$2
    LIMIT 1`,[row.effective_from,row.effective_to]);
  if(blocked.rowCount)fail('Posted jobs or completed leave already cover these dates. Choose a prospective transition; historical credit and grants cannot be rewritten.');
  const {rows:[transition]}=await client.query(`INSERT INTO hr_gov_policy_transitions(predecessor_id,successor_id,effective_from,authority_reference,prepared_by,approved_by,reason,review_mode)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[prior.id,row.id,row.effective_from,row.authority_reference.trim(),preparer,actor.id,reason,reviewMode]);
  await recordAudit({client,actor,action:'hr.gov.policy.replacement_approved',entityType:'hr_gov_policy_transition',entityId:transition.id,after:transition});
}

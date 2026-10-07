import {randomUUID} from 'node:crypto';
import {ServiceError} from '../lib/serviceError.js';
import {withTransaction} from '../lib/transaction.js';
import {recordAudit} from './auditService.js';
import {managementReason} from './employeeManagement.js';
import {isCentralHr,canAccessEmployee} from './hrAccess.js';
import {DEFAULT_RULES,validateRules,dayNumber,units,decimal,fingerprint,calculateEvaluation,serviceFacts} from '../lib/governmentLeaveRules.js';
export {DEFAULT_RULES};
const fail=(message,status=409)=>{throw new ServiceError(status,message);};
const audit=(client,actor,action,id,after)=>recordAudit({client,actor,action,entityType:'hr_government_leave',entityId:id,after});
export function central(user){if(!isCentralHr(user))fail('Central HR administration is required.',403);}
export async function lockEmployee(client,id){const {rows:[employee]}=await client.query('SELECT * FROM hr_employees WHERE id=$1 FOR UPDATE',[id]);if(!employee)fail('Employee not found.',404);return employee;}
export async function ledgerReadable(client,user,id){if(!(await canAccessEmployee(client,user,id,'hr_balance_manage',{owner:true})))fail('Employee not found.',404);}
export async function readable(client,user,id){if(!(await canAccessEmployee(client,user,id,'hr_staff_manage',{owner:true}))&&!(await canAccessEmployee(client,user,id,'hr_balance_manage'))&&!(await canAccessEmployee(client,user,id,'hr_leave_approve')))fail('Employee not found.',404);}
const dates=(prefix='')=>`${prefix}*,to_char(${prefix}effective_from,'YYYY-MM-DD') AS effective_from,to_char(${prefix}effective_to,'YYYY-MM-DD') AS effective_to`;
export async function loadContext(client,employeeId){
 const {rows:[employee]}=await client.query('SELECT id,display_name,status,leave_policy_regime FROM hr_employees WHERE id=$1',[employeeId]);if(!employee)fail('Employee not found.',404);
 const results=[];const queries=[
 ()=>client.query(`SELECT ${dates()} FROM hr_gov_policy_versions WHERE status='published' ORDER BY hr_gov_policy_versions.effective_from,hr_gov_policy_versions.id`),
 ()=>client.query(`SELECT ${dates()} FROM hr_gov_calendars c WHERE NOT EXISTS(SELECT 1 FROM hr_gov_calendars successor WHERE successor.supersedes_id=c.id) ORDER BY c.effective_from,c.id`),
 ()=>client.query(`SELECT *,to_char(start_date,'YYYY-MM-DD') AS start_date,to_char(end_date,'YYYY-MM-DD') AS end_date FROM hr_employee_service_periods WHERE employee_id=$1 ORDER BY hr_employee_service_periods.start_date,hr_employee_service_periods.id`,[employeeId]),
 ()=>client.query(`SELECT *,to_char(effective_from,'YYYY-MM-DD') AS effective_from,to_char(continuity_start,'YYYY-MM-DD') AS continuity_start FROM hr_gov_service_bases WHERE employee_id=$1 ORDER BY hr_gov_service_bases.effective_from,hr_gov_service_bases.id`,[employeeId]),
 ()=>client.query(`SELECT *,to_char(start_date,'YYYY-MM-DD') AS start_date,to_char(end_date,'YYYY-MM-DD') AS end_date FROM hr_gov_service_exclusions x WHERE employee_id=$1 AND NOT EXISTS(SELECT 1 FROM hr_gov_exclusion_withdrawals w WHERE w.exclusion_id=x.id) ORDER BY x.start_date,x.id`,[employeeId]),
 ()=>client.query('SELECT * FROM hr_work_patterns ORDER BY id'),()=>client.query('SELECT * FROM hr_gov_pattern_approvals ORDER BY id'),
 ()=>client.query(`SELECT *,to_char(day,'YYYY-MM-DD') AS day FROM hr_gov_roster_days r WHERE employee_id=$1 AND NOT EXISTS(SELECT 1 FROM hr_gov_roster_days successor WHERE successor.supersedes_id=r.id) ORDER BY r.day,r.id`,[employeeId]),
 ()=>client.query(`SELECT e.*,to_char(e.period_start,'YYYY-MM-DD') AS period_start,to_char(e.period_end,'YYYY-MM-DD') AS period_end,to_char(e.as_of,'YYYY-MM-DD') AS as_of,
   COALESCE((SELECT sum(l.amount) FROM hr_gov_ledger l WHERE l.entitlement_id=e.id),0)::text AS balance,
   (COALESCE((SELECT sum(h.amount) FROM hr_gov_reservations h JOIN hr_gov_reservation_requests r ON r.id=h.request_id WHERE h.entitlement_id=e.id AND r.status='held'),0)+COALESCE((SELECT sum(h.amount) FROM hr_gov_case_credit_holds h JOIN hr_gov_requests cr ON cr.id=h.request_id WHERE h.entitlement_id=e.id AND cr.status='pending' AND h.determination_id=(SELECT id FROM hr_gov_case_determinations cd WHERE cd.request_id=cr.id ORDER BY version DESC LIMIT 1)),0))::text AS held,
   (COALESCE((SELECT sum(l.amount) FROM hr_gov_ledger l WHERE l.entitlement_id=e.id),0)-(COALESCE((SELECT sum(h.amount) FROM hr_gov_reservations h JOIN hr_gov_reservation_requests r ON r.id=h.request_id WHERE h.entitlement_id=e.id AND r.status='held'),0)+COALESCE((SELECT sum(h.amount) FROM hr_gov_case_credit_holds h JOIN hr_gov_requests cr ON cr.id=h.request_id WHERE h.entitlement_id=e.id AND cr.status='pending' AND h.determination_id=(SELECT id FROM hr_gov_case_determinations cd WHERE cd.request_id=cr.id ORDER BY version DESC LIMIT 1)),0)))::text AS available
   FROM hr_gov_entitlements e WHERE e.employee_id=$1 ORDER BY e.period_start,e.id`,[employeeId])];for(const query of queries)results.push(await query());
 const keys=['policies','calendars','periods','bases','exclusions','patterns','pattern_approvals','rosters','entitlements'];return Object.fromEntries([['employee',employee],...keys.map((key,i)=>[key,results[i].rows])]);
}
export async function evaluate(client,employeeId,input){
 const context=await loadContext(client,employeeId);if(context.employee.leave_policy_regime!=='government')fail('Enroll this employee in the government regime before evaluation.');
 let result;try{result=calculateEvaluation(context,input);}catch(err){fail(err.message,400);}if(context.employee.status!=='active'){result.issues.push('The employee is inactive.');result.eligible_for_preview=false;}
 // No employee clinical reasons or exclusion references go to routine preview callers.
 return {...result,service_bases:result.service_bases.map(({id,continuity_start,effective_from,anniversary_method,leap_day_method,schedule_mode})=>({id,continuity_start,effective_from,anniversary_method,leap_day_method,schedule_mode}))};
}
export async function createPolicy(pool,{user,actor,data}){
 central(user);const reason=managementReason(data.reason);try{validateRules(data.rules||DEFAULT_RULES);}catch(err){fail(err.message,400);}
 return withTransaction(pool,async client=>{const {rows:[row]}=await client.query('INSERT INTO hr_gov_policy_versions(label,effective_from,effective_to,rules,source_reference,prepared_by,reason) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',[data.label,data.effective_from,data.effective_to,data.rules||DEFAULT_RULES,data.source_reference,actor.id,reason]);await audit(client,actor,'hr.gov.policy.prepared',row.id,row);return row;});
}
export async function publishPolicy(pool,{user,actor,id,reason}){
 central(user);reason=managementReason(reason);
 return withTransaction(pool,async client=>{await client.query("SELECT pg_advisory_xact_lock(hashtext('hr-gov-policies'))");const {rows:[row]}=await client.query('SELECT * FROM hr_gov_policy_versions WHERE id=$1 FOR UPDATE',[id]);if(!row)fail('Policy not found.',404);if(row.status==='published')return row;
  if((await client.query("SELECT 1 FROM hr_gov_policy_versions WHERE status='published' AND daterange(effective_from,effective_to,'[]') && daterange($1,$2,'[]')",[row.effective_from,row.effective_to])).rowCount)fail('Published policy dates overlap. Prepare a non-overlapping successor.');
  const {rows:[after]}=await client.query("UPDATE hr_gov_policy_versions SET status='published',published_by=$2,published_at=NOW() WHERE id=$1 RETURNING *",[id,actor.id]);await audit(client,actor,'hr.gov.policy.published',id,{...after,publication_reason:reason});return after;
 });
}
export async function createCalendar(pool,{user,actor,data}){
 central(user);const reason=managementReason(data.reason),start=dayNumber(data.effective_from),end=dayNumber(data.effective_to);
 if(end<start||end-start>731)fail('A calendar must cover at most two years.',400);
 if(new Set(data.holidays.map(h=>h.date)).size!==data.holidays.length)fail('Resolve colliding holiday dates before publication.',400);
 for(const h of data.holidays)if(dayNumber(h.date)<start||dayNumber(h.date)>end)fail('Holiday dates must be within calendar coverage.',400);
 return withTransaction(pool,async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext('hr-gov-calendars'))");
  if(data.supersedes_id){const {rows:[prior]}=await client.query("SELECT *,to_char(effective_from,'YYYY-MM-DD') AS effective_from,to_char(effective_to,'YYYY-MM-DD') AS effective_to FROM hr_gov_calendars WHERE id=$1",[data.supersedes_id]);if(!prior||prior.effective_from!==data.effective_from||prior.effective_to!==data.effective_to||(await client.query('SELECT 1 FROM hr_gov_calendars WHERE supersedes_id=$1',[prior.id])).rowCount)fail('Replace only the current calendar with exactly the same coverage.');}
  else if((await client.query("SELECT 1 FROM hr_gov_calendars WHERE daterange(effective_from,effective_to,'[]') && daterange($1,$2,'[]')",[data.effective_from,data.effective_to])).rowCount)fail('Calendar coverage overlaps. Explicitly replace its current version.');
  const {rows:[row]}=await client.query('INSERT INTO hr_gov_calendars(label,effective_from,effective_to,holidays,source_reference,recorded_by,reason,supersedes_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[data.label,data.effective_from,data.effective_to,JSON.stringify(data.holidays),data.source_reference,actor.id,reason,data.supersedes_id||null]);await audit(client,actor,'hr.gov.calendar.published',row.id,row);return row;
 });
}
export async function addFoundationRecord(pool,{user,actor,employeeId,kind,data}){
 central(user);const reason=managementReason(data.reason);
 return withTransaction(pool,async client=>{
  if(employeeId)await lockEmployee(client,employeeId);
  let row;
  if(kind==='basis')({rows:[row]}=await client.query('INSERT INTO hr_gov_service_bases(employee_id,effective_from,continuity_start,anniversary_method,leap_day_method,schedule_mode,source_reference,recorded_by,reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[employeeId,data.effective_from,data.continuity_start,data.anniversary_method,data.leap_day_method,data.schedule_mode,data.source_reference,actor.id,reason]));
  else if(kind==='exclusion'){
   if((await client.query("SELECT 1 FROM hr_gov_service_exclusions x WHERE employee_id=$1 AND NOT EXISTS(SELECT 1 FROM hr_gov_exclusion_withdrawals w WHERE w.exclusion_id=x.id) AND daterange(start_date,end_date,'[]') && daterange($2,$3,'[]')",[employeeId,data.start_date,data.end_date])).rowCount)fail('Service exclusion intervals overlap.');
   ({rows:[row]}=await client.query('INSERT INTO hr_gov_service_exclusions(employee_id,start_date,end_date,kind,source_reference,recorded_by,reason) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',[employeeId,data.start_date,data.end_date,data.kind,data.source_reference,actor.id,reason]));
  }else if(kind==='roster'){
    const {rows:[prior]}=await client.query('SELECT id FROM hr_gov_roster_days r WHERE employee_id=$1 AND day=$2 AND NOT EXISTS(SELECT 1 FROM hr_gov_roster_days successor WHERE successor.supersedes_id=r.id)',[employeeId,data.day]);
    if(prior&&!data.supersedes_id)fail('Explicitly replace the current roster day after verification.');if(data.supersedes_id&&data.supersedes_id!==prior?.id)fail('The current roster day changed. Refresh before replacement.');
    ({rows:[row]}=await client.query('INSERT INTO hr_gov_roster_days(employee_id,day,paid_hours,policy_days,source_reference,recorded_by,reason,supersedes_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[employeeId,data.day,data.paid_hours,data.policy_days,data.source_reference,actor.id,reason,data.supersedes_id||null]));
  }else if(kind==='withdraw-exclusion'){
    if(!(await client.query('SELECT 1 FROM hr_gov_service_exclusions WHERE id=$1 AND employee_id=$2',[data.exclusion_id,employeeId])).rowCount)fail('Service exclusion not found.',404);
    ({rows:[row]}=await client.query('INSERT INTO hr_gov_exclusion_withdrawals(exclusion_id,recorded_by,source_reference,reason) VALUES ($1,$2,$3,$4) RETURNING *',[data.exclusion_id,actor.id,data.source_reference,reason]));
  }
  else if(kind==='pattern'){
    const {rows:[pattern]}=await client.query('SELECT * FROM hr_work_patterns WHERE id=$1 FOR SHARE',[data.work_pattern_id]);
    if(!pattern||new Set(pattern.working_weekdays).size!==5||![7,8].includes(Number(pattern.hours_per_day)))fail('Automatic weekly conversion supports a verified five-day, seven/eight-paid-hour schedule. Other patterns require published roster conversions.',400);
    ({rows:[row]}=await client.query('INSERT INTO hr_gov_pattern_approvals(work_pattern_id,source_reference,recorded_by,reason) VALUES ($1,$2,$3,$4) RETURNING *',[data.work_pattern_id,data.source_reference,actor.id,reason]));
  }
  else fail('Unknown foundation record.',400);
  await audit(client,actor,`hr.gov.${kind}.certified`,row.id,row);return row;
 }).catch(err=>{if(err.code==='23505')fail('A certified record already exists for these dates or this pattern. Prepare a successor.');if(err.code==='23514'||err.code==='23503')fail('Verify the dates, units and referenced employee/pattern.',400);throw err;});
}
async function openingSnapshot(client,employeeId){const context=await loadContext(client,employeeId);const {rows:historical}=await client.query('SELECT b.id,b.leave_type_id,t.name AS leave_type_name,b.year,b.balance,b.pending FROM hr_leave_balances b JOIN hr_leave_types t ON t.id=b.leave_type_id WHERE b.employee_id=$1 ORDER BY b.year,b.leave_type_id',[employeeId]);return {context,historical,hash:fingerprint({context,historical})};}
export async function prepareOpening(pool,{user,actor,employeeId,data}){
 central(user);const reason=managementReason(data.reason);try{if(units(data.amount)<0n)fail('Opening must be nonnegative.',400);}catch(err){if(err.status)throw err;fail(err.message,400);}
 return withTransaction(pool,async client=>{await lockEmployee(client,employeeId);const snapshot=await openingSnapshot(client,employeeId);if(snapshot.context.employee.leave_policy_regime!=='government')fail('Enroll the employee before preparing openings.');
  const policy=snapshot.context.policies.find(p=>p.id===data.policy_version_id&&p.effective_from<=data.as_of&&p.effective_to>=data.as_of);if(!policy)fail('Select a published policy covering the opening date.');
  const facts=serviceFacts(snapshot.context,data.as_of);if(facts.issues.length)fail(facts.issues.join(' '));
  if(data.period_start!==facts.period_start||data.period_end!==facts.period_end)fail('Opening period must match the certified service year.');
  if(dayNumber(data.as_of)<dayNumber(data.period_start)||dayNumber(data.as_of)>dayNumber(data.period_end))fail('Opening date must be inside its entitlement period.',400);
  const {rows:[row]}=await client.query(`INSERT INTO hr_gov_openings(employee_id,code,policy_version_id,period_start,period_end,as_of,amount,source_reference,payroll_reference,snapshot_hash,historical_snapshot,prepared_by,reason)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[employeeId,data.code,policy.id,data.period_start,data.period_end,data.as_of,decimal(units(data.amount)),data.source_reference,data.payroll_reference,snapshot.hash,JSON.stringify(snapshot.historical),actor.id,reason]);await audit(client,actor,'hr.gov.opening.prepared',row.id,row);return row;
 });
}
export async function certifyOpening(pool,{user,actor,id,reason}){
 central(user);reason=managementReason(reason);
 return withTransaction(pool,async client=>{const {rows:[ref]}=await client.query('SELECT employee_id FROM hr_gov_openings WHERE id=$1',[id]);if(!ref)fail('Opening not found.',404);await lockEmployee(client,ref.employee_id);const {rows:[row]}=await client.query('SELECT *,to_char(as_of,\'YYYY-MM-DD\') AS as_of FROM hr_gov_openings WHERE id=$1 FOR UPDATE',[id]);if(row.status==='certified')return row;
  if(row.prepared_by===actor.id)fail('A different central HR officer must certify the reviewed opening.',403);
  if((await openingSnapshot(client,row.employee_id)).hash!==row.snapshot_hash)fail('Employee, policy, calendar or balances changed after preview. Prepare a new opening.');
  if((await client.query("SELECT 1 FROM hr_gov_entitlements WHERE employee_id=$1 AND code=$2 AND daterange(period_start,period_end,'[]') && daterange($3,$4,'[]')",[row.employee_id,row.code,row.period_start,row.period_end])).rowCount)fail('This entitlement period is already certified. Use an audited correction.');
  const {rows:[entitlement]}=await client.query('INSERT INTO hr_gov_entitlements(employee_id,code,policy_version_id,period_start,period_end,as_of,opening_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',[row.employee_id,row.code,row.policy_version_id,row.period_start,row.period_end,row.as_of,row.id]);
  await postMovement(client,{entitlementId:entitlement.id,kind:'opening',amount:row.amount,effectiveDate:row.as_of,eventKey:`opening:${row.id}`,sourceReference:row.source_reference,actor,reason});
  const {rows:[after]}=await client.query("UPDATE hr_gov_openings SET status='certified',certified_by=$2,certified_at=NOW(),certification_reason=$3 WHERE id=$1 RETURNING *",[id,actor.id,reason]);await audit(client,actor,'hr.gov.opening.certified',id,{...after,entitlement_id:entitlement.id});return after;
 });
}
export async function postMovement(client,{entitlementId,kind,amount,effectiveDate,eventKey,sourceReference,actor,reason,reversesId=null,excludeCaseRequestId=null}){
 const value=units(amount);const {rows:[account]}=await client.query('SELECT *,to_char(as_of,\'YYYY-MM-DD\') AS as_of,to_char(period_end,\'YYYY-MM-DD\') AS period_end FROM hr_gov_entitlements WHERE id=$1 FOR UPDATE',[entitlementId]);if(!account)fail('Entitlement not found.',404);
 if(effectiveDate<account.as_of||effectiveDate>account.period_end)fail('A movement must be within the certified period and on/after its opening date.');
 const payload={entitlement_id:entitlementId,kind,amount:decimal(value),effective_date:effectiveDate,source_reference:sourceReference,reverses_id:reversesId};
 const {rows:[existing]}=await client.query('SELECT *,to_char(effective_date,\'YYYY-MM-DD\') AS effective_date FROM hr_gov_ledger WHERE event_key=$1',[eventKey]);
 if(existing){if(fingerprint(Object.fromEntries(Object.keys(payload).map(k=>[k,existing[k]])))!==fingerprint(payload))fail('The event key was already used for a different posting.');return existing;}
 const {rows:[totals]}=await client.query(`SELECT COALESCE((SELECT sum(amount) FROM hr_gov_ledger WHERE entitlement_id=$1),0)::text AS balance,
  (COALESCE((SELECT sum(h.amount) FROM hr_gov_reservations h JOIN hr_gov_reservation_requests r ON r.id=h.request_id WHERE h.entitlement_id=$1 AND r.status='held'),0)+COALESCE((SELECT sum(h.amount) FROM hr_gov_case_credit_holds h JOIN hr_gov_requests cr ON cr.id=h.request_id WHERE h.entitlement_id=$1 AND cr.status='pending' AND ($2::uuid IS NULL OR cr.id<>$2) AND h.determination_id=(SELECT id FROM hr_gov_case_determinations cd WHERE cd.request_id=cr.id ORDER BY version DESC LIMIT 1)),0))::text AS held`,[entitlementId,excludeCaseRequestId]);
 if(units(totals.balance)+value<units(totals.held))fail('The movement would spend entitlement already held or make the balance negative.');
 if(kind==='accrual'&&account.code==='recreation'){
  const {rows:[policy]}=await client.query('SELECT rules FROM hr_gov_policy_versions WHERE id=$1',[account.policy_version_id]);if(units(totals.balance)+value>units(policy.rules.recreation_cap_days))fail('Recreation accrual must stop at the governing cap.');
 }
 const {rows:[posted]}=await client.query(`INSERT INTO hr_gov_ledger(entitlement_id,kind,amount,effective_date,event_key,reverses_id,source_reference,actor_id,reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[entitlementId,kind,decimal(value),effectiveDate,eventKey,reversesId,sourceReference,actor?.id??null,managementReason(reason)]);
 await audit(client,actor,'hr.gov.ledger.posted',posted.id,posted);return posted;
}
export async function correctLedger(pool,{user,actor,employeeId,data}){
 central(user);return withTransaction(pool,async client=>{await lockEmployee(client,employeeId);const {rows:[account]}=await client.query('SELECT id FROM hr_gov_entitlements WHERE id=$1 AND employee_id=$2',[data.entitlement_id,employeeId]);if(!account)fail('Entitlement not found.',404);return postMovement(client,{entitlementId:account.id,kind:'correction',amount:data.amount,effectiveDate:data.effective_date,eventKey:`correction:${data.event_key}`,sourceReference:data.source_reference,actor,reason:data.reason});});
}
export async function reverseMovement(pool,{user,actor,employeeId,id,data}){
 central(user);return withTransaction(pool,async client=>{await lockEmployee(client,employeeId);const {rows:[row]}=await client.query('SELECT l.* FROM hr_gov_ledger l JOIN hr_gov_entitlements e ON e.id=l.entitlement_id WHERE l.id=$1 AND e.employee_id=$2',[id,employeeId]);if(!row)fail('Movement not found.',404);if(['opening','use','reversal'].includes(row.kind))fail('Opening/use reversals require the governed cutover or amendment workflow.');return postMovement(client,{entitlementId:row.entitlement_id,kind:'reversal',amount:decimal(-units(row.amount)),effectiveDate:data.effective_date,eventKey:`reversal:${row.id}`,reversesId:row.id,sourceReference:data.source_reference,actor,reason:data.reason});});
}
// Internal contract for Package 3 only: no public route can hold, release or grant leave.
export async function reserveEvaluation(pool,{employeeId,input,requestId=randomUUID(),actor,authorize,client:existingClient}){
 if(typeof authorize!=='function')fail('The submission authority callback is required.',403);
 const work=async client=>{await lockEmployee(client,employeeId);if(!await authorize(client))fail('Submission is not authorised.',403);
  const payloadHash=fingerprint({employeeId,input});const {rows:[old]}=await client.query('SELECT * FROM hr_gov_reservation_requests WHERE id=$1',[requestId]);if(old){if(old.employee_id!==employeeId||old.payload_hash!==payloadHash)fail('Request key was already used for a different absence.');return old;}
  const result=await evaluate(client,employeeId,input);if(!result.eligible_for_preview)fail(result.issues.join(' '));
  const ids=result.allocations.map(a=>a.entitlement_id).sort();await client.query('SELECT id FROM hr_gov_entitlements WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids]);
  // Re-evaluate after account locks: other holds/corrections may have committed while waiting.
  const locked=await evaluate(client,employeeId,input);if(!locked.eligible_for_preview)fail(locked.issues.join(' '));
  const {rows:[request]}=await client.query('INSERT INTO hr_gov_reservation_requests(id,employee_id,payload_hash,evaluation_snapshot) VALUES ($1,$2,$3,$4) RETURNING *',[requestId,employeeId,payloadHash,locked]);
  for(const allocation of locked.allocations)await client.query('INSERT INTO hr_gov_reservations(request_id,entitlement_id,amount) VALUES ($1,$2,$3)',[requestId,allocation.entitlement_id,allocation.amount]);
  await client.query("INSERT INTO hr_gov_reservation_events(request_id,action,actor_id,reason) VALUES ($1,'held',$2,'Server-evaluated application reservation')",[requestId,actor.id]);await audit(client,actor,'hr.gov.reservation.held',requestId,{allocations:locked.allocations});return request;
 };return existingClient?work(existingClient):withTransaction(pool,work);
}
export async function finishReservation(pool,{employeeId,requestId,action,actor,reason,authorize,client:existingClient}){
 if(!['released','consumed'].includes(action)||typeof authorize!=='function')fail('An authorised release/grant contract is required.',403);reason=managementReason(reason);
 const work=async client=>{await lockEmployee(client,employeeId);if(!await authorize(client))fail('Decision is not authorised.',403);
  const {rows:[request]}=await client.query('SELECT * FROM hr_gov_reservation_requests WHERE id=$1 AND employee_id=$2 FOR UPDATE',[requestId,employeeId]);if(!request)fail('Reservation not found.',404);if(request.status===action)return request;if(request.status!=='held')fail('This reservation has already completed differently.');
  const {rows:holds}=await client.query('SELECT * FROM hr_gov_reservations WHERE request_id=$1 ORDER BY entitlement_id',[requestId]);await client.query('SELECT id FROM hr_gov_entitlements WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[holds.map(h=>h.entitlement_id)]);
  if(action==='consumed'){
   const snapshot=request.evaluation_snapshot;
   // The authority callback must recheck evidence and stage completion. Calculation inputs are retained below.
   const checked=await evaluate(client,employeeId,snapshot.input);
   const oldSegments=snapshot.segments.map(s=>({...s,entitlement_id:s.entitlement_id}));
   if(checked.engine_version!==snapshot.engine_version||fingerprint(checked.segments)!==fingerprint(oldSegments)||checked.issues.some(issue=>!issue.includes('exceeds a certified entitlement')))fail('Policy, service or calendar changed; refresh and review before final grant.');
  }
  await client.query('UPDATE hr_gov_reservation_requests SET status=$2,completed_at=NOW() WHERE id=$1',[requestId,action]);
  if(action==='consumed')for(const hold of holds)await postMovement(client,{entitlementId:hold.entitlement_id,kind:'use',amount:decimal(-units(hold.amount)),effectiveDate:request.evaluation_snapshot.segments.find(s=>s.entitlement_id===hold.entitlement_id&&units(s.charge)>0n).date,eventKey:`use:${requestId}:${hold.entitlement_id}`,sourceReference:`request:${requestId}`,actor,reason});
  await client.query('INSERT INTO hr_gov_reservation_events(request_id,action,actor_id,reason) VALUES ($1,$2,$3,$4)',[requestId,action,actor.id,reason]);await audit(client,actor,`hr.gov.reservation.${action}`,requestId,{reason});return {...request,status:action};
 };return existingClient?work(existingClient):withTransaction(pool,work);
}

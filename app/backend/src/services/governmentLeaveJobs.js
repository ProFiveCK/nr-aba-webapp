import {LOCK_KEYS,withAdvisoryLock} from '../lib/advisoryLock.js';
import {withTransaction} from '../lib/transaction.js';
import {ServiceError} from '../lib/serviceError.js';
import {recordAudit} from './auditService.js';
import * as ledger from './governmentLeave.js';
import {assertCentral,configurationFor,today} from './governmentLeaveWorkflow.js';
import {fingerprint,dayNumber,isoDay,serviceFacts,units,decimal,ENGINE_VERSION} from '../lib/governmentLeaveRules.js';
import {fortnightAmount} from '../lib/governmentLeaveWorkflowRules.js';
const fail=message=>{throw new ServiceError(409,message);};
const audit=(client,actor,id,after)=>recordAudit({client,actor,action:'hr.gov.jobs.posted',entityType:'hr_gov_job_plan',entityId:id,after});
export async function prepareJobPlan(pool,{user,actor,employeeId,data}) {
  ledger.central(user);
  return withTransaction(pool,async client=>{
    await assertCentral(client,user);await ledger.lockEmployee(client,employeeId);
    const context=await ledger.loadContext(client,employeeId),facts=serviceFacts(context,today());
    if(facts.issues.length)fail(facts.issues.join(' '));
    if(!context.entitlements.some(e=>e.code===data.code&&e.period_start===facts.period_start))fail('Certify the current opening first.');
    if(data.code==='recreation') {
      if(!data.payroll_anchor||!data.first_post_end||!['appointment','qualification'].includes(data.temporary_start))fail('Confirm the actual payroll anchor, first posting and temporary-service accrual treatment.');
      if((dayNumber(data.first_post_end)-dayNumber(data.payroll_anchor))%14!==0)fail('First posting must align to the confirmed fourteen-day payroll cycle.');
      const account=context.entitlements.find(e=>e.code==='recreation'&&e.period_start===facts.period_start);
      if(data.first_post_end<account.as_of)fail('First posting cannot precede the cutover.');
    }
    const method=data.code==='recreation'?'26_cycle_cumulative_floor_calendar_proration':'service_anniversary_reset';
    const {rows:[plan]}=await client.query(`INSERT INTO hr_gov_job_plans(employee_id,code,service_basis_id,first_post_end,payroll_anchor,temporary_start,method,source_reference,prepared_by,reason,snapshot_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[employeeId,data.code,facts.basis.id,data.code==='recreation'?data.first_post_end:null,data.code==='recreation'?data.payroll_anchor:null,data.code==='recreation'?data.temporary_start:null,method,data.source_reference,actor.id,data.reason,fingerprint(context)]);
    await recordAudit({client,actor,action:'hr.gov.jobs.prepared',entityType:'hr_gov_job_plan',entityId:plan.id,after:plan});return plan;
  });
}
export async function approveJobPlan(pool,{user,actor,id,reason}) {
  ledger.central(user);
  return withTransaction(pool,async client=>{
    await assertCentral(client,user);const {rows:[ref]}=await client.query('SELECT employee_id FROM hr_gov_job_plans WHERE id=$1',[id]);if(!ref)fail('Job plan not found.');
    await ledger.lockEmployee(client,ref.employee_id);const {rows:[plan]}=await client.query('SELECT * FROM hr_gov_job_plans WHERE id=$1 FOR UPDATE',[id]);
    if(plan.status==='published')return plan;if(plan.prepared_by===actor.id)fail('A different central HR officer must approve the job plan.');
    if(fingerprint(await ledger.loadContext(client,plan.employee_id))!==plan.snapshot_hash)fail('Foundations changed after preparation. Prepare a fresh job plan.');
    const {rows:[after]}=await client.query("UPDATE hr_gov_job_plans SET status='published',approved_by=$2,approved_at=NOW() WHERE id=$1 RETURNING *",[id,actor.id]);
    await recordAudit({client,actor,action:'hr.gov.jobs.approved',entityType:'hr_gov_job_plan',entityId:id,after:{...after,approval_reason:reason}});return after;
  });
}
function governingPolicy(context,date) {
  const policy=context.policies.find(p=>p.effective_from<=date&&p.effective_to>=date);
  if(!policy||policy.evaluator_version!==ENGINE_VERSION)fail('An approved supported policy must cover every job date.');return policy;
}
async function renewTo(client,context,plan,asOf,actor) {
  let account=context.entitlements.filter(e=>e.code===plan.code&&e.as_of<=asOf).at(-1);
  if(!account)fail('The approved job has no certified starting entitlement.');
  if(context.entitlements.some(e=>e.code===plan.code&&e.period_end<asOf&&units(e.balance)>0n&&account.opening_id&&e.id!==account.id))fail('A later manual opening exists while an earlier year retains credit. Reconcile that cutover before automatic renewal.');
  const renewals=[];
  for(let i=0;account.period_end<asOf&&i<5;i++) {
    const start=isoDay(dayNumber(account.period_end)+1),facts=serviceFacts(context,start);
    if(facts.issues.length||facts.period_start!==start||!facts.period_end||facts.basis.id!==plan.service_basis_id)fail('Service anniversary changed or is unresolved. HR must review the job plan.');
    if(context.entitlements.some(e=>e.code===plan.code&&e.period_start===start))fail('A future opening already exists. Reconcile that cutover before automatic renewal.');
    if(units(account.held)>0n)fail('Pending leave still holds the expiring service year. Decide/cancel it before renewal; no hold is discarded.');
    const policy=governingPolicy(context,start),period=context.periods.find(p=>p.start_date<=start&&(!p.end_date||p.end_date>=start));
    if(!period||!['permanent','contract','temporary'].includes(period.employment_category)||(plan.code==='recreation'&&period.is_teacher))fail('The appointment is not supported for automatic renewal.');
    const source=`approved-plan:${plan.id}`,reason='Approved service-anniversary expiry and entitlement renewal';
    await ledger.postMovement(client,{entitlementId:account.id,kind:'expiry',amount:decimal(-units(account.balance)),effectiveDate:account.period_end,eventKey:`expiry:${account.id}`,sourceReference:source,actor,reason});
    const {rows:[next]}=await client.query('INSERT INTO hr_gov_entitlements(employee_id,code,policy_version_id,period_start,period_end,as_of,renewal_plan_id) VALUES($1,$2,$3,$4,$5,$4,$6) RETURNING id',[plan.employee_id,plan.code,policy.id,start,facts.period_end,plan.id]);
    const amount=plan.code==='recreation'?account.balance:policy.rules[`${plan.code}_annual_days`];
    await ledger.postMovement(client,{entitlementId:next.id,kind:'grant',amount,effectiveDate:start,eventKey:`annual:${plan.employee_id}:${plan.code}:${start}`,sourceReference:source,actor,reason});
    await client.query("INSERT INTO hr_gov_job_posts(employee_id,code,event_date,event_kind,plan_id,amount) VALUES($1,$2,$3,'renewal',$4,$5)",[plan.employee_id,plan.code,start,plan.id,amount]);
    renewals.push({date:start,amount});context=await ledger.loadContext(client,plan.employee_id);account=context.entitlements.find(e=>e.id===next.id);
  }
  if(account.period_end<asOf)fail('Catch-up exceeds five service years. Reconcile a fresh approved cutover.');
  return {context,renewals};
}
export async function runEmployeeJobs(pool,{user,actor,employeeId,asOf=today(),clockDate=today()}) {
  ledger.central(user);
  return executeEmployeeJobs(pool,{user,actor,employeeId,asOf,clockDate,origin:'manual'});
}
// Only the reviewed-plan runner below can select the system path. HTTP callers
// reach runEmployeeJobs, which always rechecks central HR authority.
async function executeEmployeeJobs(pool,{user,actor,employeeId,asOf,clockDate,origin}) {
  if(asOf>clockDate)fail('Jobs cannot post future entitlement.');
  return withTransaction(pool,async client=>{
    if(origin==='manual')await assertCentral(client,user);
    await ledger.lockEmployee(client,employeeId);
    let context=await ledger.loadContext(client,employeeId);const config=await configurationFor(client,employeeId);
    if(context.employee.status!=='active'||context.employee.leave_policy_regime!=='government')fail('Only an active government employee can run these jobs.');
    const {rows:plans}=await client.query("SELECT DISTINCT ON(code) *,to_char(first_post_end,'YYYY-MM-DD') AS first_post_end FROM hr_gov_job_plans WHERE employee_id=$1 AND status='published' ORDER BY code,approved_at DESC,id DESC",[employeeId]);
    const results=[];
    for(const plan of plans) {
      if(!config?.enabled_codes.includes(plan.code)){results.push({code:plan.code,paused:true});continue;}
      const facts=serviceFacts(context,asOf);if(facts.issues.length||facts.basis.id!==plan.service_basis_id)fail('The certified service basis changed. Review the job plan.');
      // Accruals in an old period must post before its carry-forward. Process payroll dates chronologically.
      const posts=[];let limited=false;
      if(plan.code==='recreation') {
        if(dayNumber(asOf)-dayNumber(plan.first_post_end)>1830)fail('Catch-up exceeds five years. Review a fresh payroll cutover.');
        for(let index=0,end=dayNumber(plan.first_post_end);end<=dayNumber(asOf);index++,end+=14) {
          const endDate=isoDay(end);
          if((await client.query("SELECT 1 FROM hr_gov_job_posts WHERE employee_id=$1 AND code='recreation' AND event_date=$2 AND event_kind='accrual'",[employeeId,endDate])).rowCount)continue;
          if(posts.length>=52){limited=true;break;}
          let credited=0,quantum=null,policyId=null,targetId=null;
          for(let n=end-13;n<=end;n++) {
            const date=isoDay(n),dateFacts=serviceFacts(context,date),period=context.periods.find(p=>p.start_date<=date&&(!p.end_date||p.end_date>=date));
            const firstAccount=context.entitlements.filter(e=>e.code==='recreation').at(0);
            if(date<firstAccount.as_of)continue;
            const policy=governingPolicy(context,date);
            if(policyId&&policyId!==policy.id)fail('A payroll fortnight crosses policy versions. Approve a reviewed transition plan.');
            policyId=policy.id;quantum=policy.rules.recreation_annual_days;
            if(dateFacts.issues.length||dateFacts.basis.id!==plan.service_basis_id||!period||period.counts_for_service==null)fail('Payroll service/credit history is unresolved.');
            if(!['permanent','contract','temporary'].includes(period.employment_category)||period.is_teacher)fail('Appointment terms need assisted accrual handling.');
            if(period.counts_for_service===false||context.exclusions.some(x=>x.start_date<=date&&x.end_date>=date))continue;
            if(period.employment_category==='temporary'&&plan.temporary_start==='qualification'&&date<(dateFacts.milestone(policy.rules.temporary_recreation_months)||'9999-12-31'))continue;
            credited++;
          }
          if(!quantum)fail('The first payroll period does not reach the cutover.');
          const renewed=await renewTo(client,context,plan,endDate,actor);context=renewed.context;
          const account=context.entitlements.find(e=>e.code==='recreation'&&e.period_start<=endDate&&e.period_end>=endDate);targetId=account?.id;
          if(!targetId)fail('Payroll period has no governing entitlement.');
          const cap=units(governingPolicy(context,endDate).rules.recreation_cap_days),requested=units(fortnightAmount(quantum,index,credited)),room=cap-units(account.balance);
          const amount=decimal(room<=0n?0n:requested>room?room:requested),capped=room<=requested;
          if(units(amount)>0n)await ledger.postMovement(client,{entitlementId:targetId,kind:'accrual',amount,effectiveDate:endDate,eventKey:`payroll:${employeeId}:${endDate}`,sourceReference:`approved-plan:${plan.id}`,actor,reason:'Approved payroll-cycle recreation accrual with calendar-day proration'});
          await client.query("INSERT INTO hr_gov_job_posts(employee_id,code,event_date,event_kind,plan_id,amount,capped) VALUES($1,'recreation',$2,'accrual',$3,$4,$5)",[employeeId,endDate,plan.id,amount,capped]);
          posts.push({date:endDate,amount,credited_calendar_days:credited,capped,renewals:renewed.renewals});context=await ledger.loadContext(client,employeeId);
        }
      }
      // With no further payroll catch-up pending, renew an anniversary that falls between payroll dates.
      let renewals=[];if(!limited){const renewed=await renewTo(client,context,plan,asOf,actor);context=renewed.context;renewals=renewed.renewals;}
      const result={code:plan.code,posts,renewals,more_due:limited};results.push(result);if(posts.length||renewals.length)await audit(client,actor,plan.id,{...result,run_origin:origin});
    }
    return {employee_id:employeeId,as_of:asOf,results};
  });
}

// Page UUIDs only; every employee gets a separate locked transaction. One bad
// foundation blocks that employee without starving later departments. Unique
// posting keys and employee locks also protect manual/scheduled races.
export async function runDueGovernmentJobs(pool) {
  return withAdvisoryLock(pool,LOCK_KEYS.GOVERNMENT_LEAVE_JOBS,async()=>{
    const result={as_of:today(),employees:0,changed:0,blocked:[]};
    let cursor=null;
    for(;;) {
      const {rows}=await pool.query(`SELECT e.id FROM hr_employees e
        JOIN LATERAL(SELECT enabled_codes FROM hr_gov_workflow_configs c WHERE c.employee_id=e.id AND c.status='published' ORDER BY approved_at DESC,id DESC LIMIT 1)c ON TRUE
        WHERE e.status='active' AND e.leave_policy_regime='government' AND cardinality(c.enabled_codes)>0
        AND ($1::uuid IS NULL OR e.id>$1) AND EXISTS(SELECT 1 FROM hr_gov_job_plans p WHERE p.employee_id=e.id AND p.status='published' AND p.code=ANY(c.enabled_codes))
        ORDER BY e.id LIMIT 100`,[cursor]);
      if(!rows.length)break;
      for(const row of rows) {
        result.employees++;
        try {
          const posted=await executeEmployeeJobs(pool,{employeeId:row.id,asOf:result.as_of,clockDate:result.as_of,actor:null,origin:'scheduler'});
          if(posted.results.some(r=>r.posts?.length||r.renewals?.length))result.changed++;
        }catch(error){result.blocked.push({employee_id:row.id,message:error.status?error.message:'Posting failed; see the server error log.'});if(!error.status)console.error('[government-leave-jobs] Employee posting failed',row.id,error);}
      }
      cursor=rows.at(-1).id;
    }
    return result;
  });
}
export function startGovernmentLeaveScheduler(pool) {
  let running=false;
  const run=async()=>{
    if(running)return;running=true;
    try {
      const outcome=await runDueGovernmentJobs(pool);
      if(outcome.acquired)console.log('[government-leave-jobs]',JSON.stringify(outcome.result));
    }catch(error){console.error('[government-leave-jobs] Due run failed',error);}
    finally{running=false;}
  };
  void run();
  return setInterval(run,60*60*1000).unref();
}

import {recreationPeriodCredit} from '../lib/governmentLeaveAccrual.js';
import {dayNumber,isoDay,units,decimal,fingerprint} from '../lib/governmentLeaveRules.js';
import {serviceCorrectionIssue} from './employeeServiceCorrections.js';
import {forecastAccountFunding} from '../lib/governmentLeaveForecast.js';

export const FORECAST_BALANCE_ISSUE='The request exceeds posted and forecast Recreation leave through the requested leave end date, after existing applications.';
const recordedBalanceIssue='The request exceeds a certified entitlement after existing reservations.';
const nauruToday=()=>new Date(Date.now()+12*3600000).toISOString().slice(0,10);

export async function applyRecreationForecast(client,context,evaluation,{excludeReservationId=null,asOf=nauruToday()}={}) {
  if(evaluation.code!=='recreation'||!evaluation.allocations.length)return evaluation;
  const employeeId=context.employee.id;
  const {rows:[plan]}=await client.query(`SELECT *,to_char(first_post_end,'YYYY-MM-DD') AS first_post_end,
    to_char(previous_payroll_end,'YYYY-MM-DD') AS previous_payroll_end FROM hr_gov_job_plans
    WHERE employee_id=$1 AND code='recreation' AND status='published' ORDER BY approved_at DESC,id DESC LIMIT 1`,[employeeId]);
  const {rows:[config]}=await client.query("SELECT enabled_codes FROM hr_gov_workflow_configs WHERE employee_id=$1 AND status='published' ORDER BY approved_at DESC,id DESC LIMIT 1",[employeeId]);
  const {rows:posted}=await client.query("SELECT to_char(event_date,'YYYY-MM-DD') AS date FROM hr_gov_job_posts WHERE employee_id=$1 AND code='recreation' AND event_kind='accrual'",[employeeId]);
  const done=new Set(posted.map(p=>p.date));
  const {rows:reservations}=await client.query(`SELECT h.entitlement_id,h.request_id,h.amount,r.status,
    COALESCE((SELECT ce.effect->>'effective_end' FROM hr_gov_case_effects ce WHERE ce.original_request_id=r.id ORDER BY ce.version DESC LIMIT 1),r.evaluation_snapshot->'input'->>'end_date') AS deadline,
    GREATEST(0,-COALESCE(u.amount,0)-COALESCE((SELECT sum(v.amount) FROM hr_gov_ledger v WHERE v.reverses_id=u.id AND v.kind='reversal'),0))::text AS used
    FROM hr_gov_reservations h JOIN hr_gov_reservation_requests r ON r.id=h.request_id
    LEFT JOIN hr_gov_ledger u ON u.event_key='use:'||r.id||':'||h.entitlement_id
    WHERE r.employee_id=$1 AND r.status IN ('held','consumed')`,[employeeId]);
  let scheduleIssue=!plan?'No approved Recreation accrual schedule is available.':!config?.enabled_codes.includes('recreation')?'Recreation accrual is paused.':await serviceCorrectionIssue(client,employeeId,plan.recorded_at);
  const accounts=[];
  for(const allocation of evaluation.allocations) {
    const account=context.entitlements.find(a=>a.id===allocation.entitlement_id);
    const through=evaluation.input.end_date<account.period_end?evaluation.input.end_date:account.period_end;
    const commitments=reservations.filter(r=>r.entitlement_id===account.id).map(r=>({...r,deadline:r.deadline<account.period_end?r.deadline:account.period_end}));
    const horizon=commitments.reduce((date,r)=>r.deadline>date?r.deadline:date,through);
    const credits=[];let projectedBalance=units(account.balance),issue=scheduleIssue;
    if(!issue) {
      try {
        if(dayNumber(horizon)-dayNumber(plan.first_post_end)>1830)throw new Error('Payroll catch-up exceeds five years; HR must review the schedule.');
        for(let index=0,end=dayNumber(plan.first_post_end);end<=dayNumber(horizon);index++,end+=14) {
          const date=isoDay(end);if(done.has(date)||date<account.as_of||date<account.period_start||date>account.period_end)continue;
          const credit=recreationPeriodCredit(context,plan,index,date),room=units(credit.cap)-projectedBalance;
          const amount=room<=0n?0n:units(credit.requested)>room?room:units(credit.requested);
          credits.push({date,amount:decimal(amount)});projectedBalance+=amount;
        }
      }catch(error){issue=error.message;}
    }
    const funding=forecastAccountFunding({balance:account.balance,held:account.held,reservations:commitments,credits,amount:allocation.amount,through,excludeReservationId});
    const ownHold=commitments.filter(r=>r.status==='held'&&r.request_id===excludeReservationId).reduce((n,r)=>n+units(r.amount),0n);
    const postedAvailable=units(account.available)+ownHold,shortfall=units(allocation.amount)-units(funding.posted_capacity);
    accounts.push({entitlement_id:account.id,through_date:through,plan_id:plan?.id||null,posted_available:decimal(postedAvailable),
      projected_accrual:decimal(credits.filter(c=>c.date<=through).reduce((n,c)=>n+units(c.amount),0n)),
      available:funding.available,forecast_used:decimal(shortfall<=0n?0n:shortfall>units(allocation.amount)?units(allocation.amount):shortfall),
      valid:funding.valid,posts:credits.filter(c=>c.date<=through),schedule_issue:issue||null});
  }
  const valid=accounts.every(a=>a.valid);
  const issues=evaluation.issues.filter(i=>i!==recordedBalanceIssue);
  if(!valid)issues.push(FORECAST_BALANCE_ISSUE);
  const forecast={as_of:asOf,through_date:evaluation.input.end_date,valid,accounts,
    projected_accrual:decimal(accounts.reduce((n,a)=>n+units(a.projected_accrual),0n)),available:decimal(accounts.reduce((n,a)=>n+units(a.available),0n)),
    forecast_used:decimal(accounts.reduce((n,a)=>n+units(a.forecast_used),0n))};
  const warnings=[...evaluation.warnings];
  if(accounts.some(a=>a.schedule_issue))warnings.push(...accounts.filter(a=>a.schedule_issue).map(a=>a.schedule_issue));
  if(units(forecast.forecast_used)>0n&&valid)warnings.push('This request uses projected Recreation accrual through the leave end date. Payroll credits remain unposted until their scheduled dates.');
  return {...evaluation,forecast,issues:[...new Set(issues)],warnings:[...new Set(warnings)],eligible_for_preview:issues.length===0,snapshot_hash:fingerprint({calculation:evaluation.snapshot_hash,forecast})};
}

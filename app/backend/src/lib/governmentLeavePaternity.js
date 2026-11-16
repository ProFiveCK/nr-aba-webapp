import {serviceFacts,UNVERIFIED_ANNIVERSARY} from './governmentLeaveRules.js';

export const PATERNITY_ANNUAL_DAYS=10;
export const paternityWorkingSegments=evaluation=>{
 if(!Array.isArray(evaluation?.segments)||!evaluation.segments.length)throw new Error('The retained paternity work schedule is missing. HR must reconcile the application.');
 return evaluation.segments.filter(s=>Number(s.scheduled_hours)>0&&!s.holiday);
};

export function paternityServiceYear(context,date){
 const facts=serviceFacts(context,date),issues=facts.issues.filter(i=>i!==UNVERIFIED_ANNIVERSARY);
 if(issues.length||!facts.period_end)throw new Error(issues.join(' ')||'The paternity service year is not determined. HR must review service coverage.');
 return {period_start:facts.period_start,period_end:facts.period_end};
}

// Every scheduled working date counts once, including a rostered shift. Off-duty
// dates and public holidays do not consume a working-day entitlement.
export function paternityBalance(context,{requests=[],evaluation=null,requestId=null,status=null,asOf,effect=null}={}){
 const periods=new Map();
 const periodFor=date=>{
  const year=paternityServiceYear(context,date);
  if(!periods.has(year.period_start))periods.set(year.period_start,{...year,allowance_days:PATERNITY_ANNUAL_DAYS,requested_days:0,effective_requested_days:0,approved_days:0,pending_days:0});
  return periods.get(year.period_start);
 };
 if(evaluation)for(const day of paternityWorkingSegments(evaluation)){const period=periodFor(day.date);period.requested_days++;if(effect?.action!=='cancel_grant'&&(!effect?.effective_end||day.date<=effect.effective_end))period.effective_requested_days++;}
 else periodFor(asOf);
 for(const request of requests){
  if(request.id===requestId||!['approved','pending'].includes(request.status)||request.effect?.action==='cancel_grant')continue;
  if(request.start_date&&request.end_date&&![...periods.values()].some(p=>request.start_date<=p.period_end&&request.end_date>=p.period_start))continue;
  const retained=request.status==='approved'?request.grant_snapshot?.evaluation||request.application_snapshot?.evaluation:request.application_snapshot?.evaluation;
  // Fail visibly for unconverted legacy records instead of inventing a balance.
  const segments=paternityWorkingSegments(retained);
  for(const day of segments){
   if(request.effect?.effective_end&&day.date>request.effect.effective_end)continue;
   const period=[...periods.values()].find(p=>p.period_start<=day.date&&p.period_end>=day.date);
   if(period)period[request.status==='approved'?'approved_days':'pending_days']++;
  }
 }
 return {unit:'working_days',as_of:asOf,periods:[...periods.values()].sort((a,b)=>a.period_start.localeCompare(b.period_start)).map(p=>{
  const before=p.allowance_days-p.approved_days-p.pending_days;
  return {...p,available_before_request:before,available_after_approval:before-p.effective_requested_days,
   approved_days:p.approved_days+(status==='approved'?p.effective_requested_days:0),pending_days:p.pending_days+(status==='pending'?p.effective_requested_days:0),
   available_days:before-(['approved','pending'].includes(status)?p.effective_requested_days:0)};
 })};
}

import {COMMON_CODES,units,decimal,serviceFacts,UNVERIFIED_ANNIVERSARY} from './governmentLeaveRules.js';
import {caseFoundation,parentalLeavePeriod} from './governmentLeaveCaseRules.js';
import {simpleCaseInput} from './governmentLeaveSimpleApproval.js';

export const REVIEW_CODES=[...COMMON_CODES,'maternity','paternity','adoption'];

/** Only request-related totals leave the service; never expose other applications or service evidence. */
export function leaveRequestReview(context,request,holds=[],checkedAt=new Date().toISOString()){
 const issues=[],periods=[];
 const summary={checked_at:checkedAt,issues,periods,parental:null};
 const input={...request.application_snapshot?.input,code:request.code,start_date:request.start_date,end_date:request.end_date};
 if(!COMMON_CODES.includes(request.code)){
  const period=parentalLeavePeriod(context,input);
  const parental={...period,pay_segments:[],pay_issue:null};
  summary.parental=parental;
  if(request.status==='pending'&&!period.valid){
   const name=request.code==='paternity'?'Paternity':request.code==='maternity'?'Maternity':'Adoption';
   issues.push(`${name} leave requests ${period.requested_days} calendar days. The allowed period is ${period.allowed_days} calendar days${request.code==='adoption'?' at most':''}, through ${period.expected_end}. Review the application dates before approval.`);
  }
  // Historic approvals retain their granted pay; never recalculate a past decision from today's service records.
  if(request.status!=='pending'){
   parental.pay_segments=request.grant_snapshot?.case_determination?.pay_segments||[];
   if(!parental.pay_segments.length)parental.pay_issue='No retained pay breakdown is available for this application.';
   return summary;
  }
  try{
   caseFoundation(context,input);
   const service=serviceFacts(context,input.start_date);
   const serviceIssues=service.issues.filter(issue=>issue!==UNVERIFIED_ANNIVERSARY);
   if(serviceIssues.length)throw new Error(serviceIssues.join(' '));
   if(request.code==='maternity'&&(!Number.isInteger(Number(input.case_details?.pregnancy_number))||Number(input.case_details.pregnancy_number)<1))throw new Error('Confirm the pregnancy number before calculating pay.');
   parental.pay_segments=simpleCaseInput(context,input,{},'Read-only review preview').pay_segments;
  }catch(error){parental.pay_issue=error.message;}
  return summary;
 }
 const evaluation=request.grant_snapshot?.evaluation||request.application_snapshot?.evaluation;
 const allocations=evaluation?.allocations;
 if(!Array.isArray(allocations)||!allocations.length){
  issues.push('The retained balance allocation is missing. Ask HR to reconcile this application before relying on a balance.');
  return summary;
 }
 for(const allocation of allocations){
  const account=context.entitlements.find(e=>e.id===allocation.entitlement_id&&e.code===request.code);
  try{
   if(!account||units(allocation.amount)<=0n)throw new Error('Missing account or charge');
   const charge=units(allocation.amount),balance=units(account.balance),held=units(account.held),available=units(account.available);
   const ownHeld=holds.filter(h=>h.entitlement_id===account.id).reduce((sum,h)=>sum+units(h.amount),0n);
   const otherHeld=held-ownHeld;
   const reconciled=ownHeld>=0n&&otherHeld>=0n&&available===balance-held&&(request.status!=='pending'||ownHeld===charge);
   if(!reconciled)issues.push('This application’s reservation and balance do not reconcile. Ask HR to review them before approval.');
   periods.push({entitlement_id:account.id,period_start:account.period_start,period_end:account.period_end,
    request_charge:decimal(charge),balance:decimal(balance),available:decimal(available),request_held:decimal(ownHeld),other_held:otherHeld>=0n?decimal(otherHeld):null,
    available_before_request:reconciled&&request.status==='pending'?decimal(available+ownHeld):null,
    available_after_approval:reconciled&&request.status==='pending'?decimal(available+ownHeld-charge):null});
  }catch{
   issues.push('A retained charge has no matching account or valid balance. Ask HR to reconcile this application.');
  }
 }
 summary.issues=[...new Set(issues)];
 return summary;
}

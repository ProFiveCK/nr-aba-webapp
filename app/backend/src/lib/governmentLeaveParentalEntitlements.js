import {caseFoundation,parentalLeavePeriod} from './governmentLeaveCaseRules.js';
import {serviceFacts} from './governmentLeaveRules.js';

/** Event allowances are policy information, never a credit or a remaining ledger balance. */
export function parentalEntitlements(context,asOf){
 if(context.employee.leave_policy_regime!=='government')return null;
 const items=['paternity','maternity','adoption'].map(code=>({code,
  calendar_days:parentalLeavePeriod(context,{code,start_date:asOf,end_date:asOf}).allowance_days,
  maximum:code==='adoption',
  event:code==='maternity'?'Per eligible pregnancy':code==='adoption'?'Per eligible adoption':'Per eligible birth or adoption',
  conditions:code==='maternity'?'Employee eligibility, pregnancy details and medical evidence are checked.':code==='adoption'?'Employee eligibility, adoption order, child’s age and relationship are checked.':'Employee eligibility, parenthood and birth or adoption evidence are checked.'}));
 let status='conditional',reason='Eligibility and evidence are confirmed for each qualifying event.',sixMonthServiceDate=null;
 const appointment=context.periods.find(p=>p.start_date<=asOf&&(!p.end_date||p.end_date>=asOf));
 if(context.employee.status!=='active'){
  status='unavailable';reason='This employee is inactive. HR must review their current appointment before a new application.';
 }else{
  try{
   // All three parental types share these appointment, policy and service prerequisites.
   // A single date checks the current record without assuming a future parental event.
   caseFoundation(context,{code:'paternity',start_date:asOf,end_date:asOf});
   sixMonthServiceDate=serviceFacts(context,asOf).milestone(6);
   if(!sixMonthServiceDate){status='review_required';reason='The six-month service milestone is not determined. HR must review service coverage.';}
  }catch(error){status=appointment?.employment_category==='temporary'?'unavailable':'review_required';reason=error.message;}
 }
 return {as_of:asOf,status,reason,six_month_service_date:sixMonthServiceDate,items};
}

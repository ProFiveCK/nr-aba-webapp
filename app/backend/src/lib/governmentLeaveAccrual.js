import {units,decimal,dayNumber,isoDay,serviceFacts,ENGINE_VERSION} from './governmentLeaveRules.js';
// One fixed payroll phase applies throughout the independently approved plan.
// Weight each day's governing quantum, then floor once after summing segments.
// A transition never resets the 26-cycle phase or creates a second posting.
export function transitionFortnightAmount(segments,index) {
  if(!Number.isInteger(index)||index<0||!Array.isArray(segments)||!segments.length)throw new Error('Invalid approved fortnight calculation.');
  const i=BigInt(index%26);let numerator=0n,credited=0;
  for(const segment of segments) {
    const days=segment.credited_calendar_days;
    if(!Number.isInteger(days)||days<0||days>14)throw new Error('Invalid credited calendar days.');
    const quantum=units(segment.annual_days);
    if(quantum<=0n)throw new Error('The annual Recreation quantum must be positive.');
    credited+=days;numerator+=(quantum*(i+1n)/26n-quantum*i/26n)*BigInt(days);
  }
  if(credited>14)throw new Error('A payroll fortnight cannot credit more than fourteen days.');
  return decimal(numerator/14n);
}

// Shared by actual payroll posting and application forecasts. A forecast must
// use the approved cycle, rounding, policy transitions and service exclusions.
export function recreationPeriodCredit(context,plan,index,endDate) {
  const governingPolicy=date=>{
    const policy=context.policies.find(p=>p.effective_from<=date&&p.effective_to>=date);
    if(!policy||policy.evaluator_version!==ENGINE_VERSION)throw new Error('An approved supported policy must cover every payroll date.');
    return policy;
  };
  const firstAccount=context.entitlements.find(e=>e.code==='recreation');
  if(!firstAccount)throw new Error('The approved payroll schedule has no certified starting entitlement.');
  const creditFrom=plan.previous_payroll_end?isoDay(dayNumber(plan.previous_payroll_end)+1):firstAccount.as_of;
  const policySegments=new Map();let credited=0;
  for(let n=dayNumber(endDate)-13;n<=dayNumber(endDate);n++) {
    const date=isoDay(n);if(date<creditFrom)continue;
    const facts=serviceFacts(context,date),period=context.periods.find(p=>p.start_date<=date&&(!p.end_date||p.end_date>=date));
    const policy=governingPolicy(plan.previous_payroll_end&&date<firstAccount.as_of?firstAccount.as_of:date);
    if(!policySegments.has(policy.id))policySegments.set(policy.id,{policy_version_id:policy.id,annual_days:policy.rules.recreation_annual_days,credited_calendar_days:0});
    if(facts.issues.length||facts.basis.id!==plan.service_basis_id||!period||period.counts_for_service==null)throw new Error('Payroll service/credit history is unresolved.');
    if(!['permanent','contract','temporary'].includes(period.employment_category)||period.is_teacher)throw new Error('Appointment terms need assisted accrual handling.');
    if(period.counts_for_service===false||context.exclusions.some(x=>x.start_date<=date&&x.end_date>=date))continue;
    if(period.employment_category==='temporary'&&plan.temporary_start==='qualification'&&date<(facts.milestone(policy.rules.temporary_recreation_months)||'9999-12-31'))continue;
    credited++;policySegments.get(policy.id).credited_calendar_days++;
  }
  if(!policySegments.size)throw new Error('The first payroll period does not reach the cutover.');
  return {requested:transitionFortnightAmount([...policySegments.values()],index),cap:governingPolicy(endDate).rules.recreation_cap_days,credited_calendar_days:credited,policy_segments:[...policySegments.values()]};
}

import {dayNumber,isoDay,units,decimal} from './governmentLeaveRules.js';
import {calendarCoverageRequired} from './governmentLeaveCalendarRules.js';

function scheduled(context,date) {
  const calendar=context.calendars.find(c=>c.effective_from<=date&&c.effective_to>=date);
  const basis=context.bases.filter(b=>b.effective_from<=date).at(-1);
  const period=context.periods.find(p=>p.start_date<=date&&(!p.end_date||p.end_date>=date));
  if((!calendar&&calendarCoverageRequired(context))||!basis||!period) return null;
  if(calendar?.holidays.some(h=>h.date===date)) return false;
  if(basis.schedule_mode==='roster') {
    const roster=context.rosters.find(r=>r.day===date);
    return roster?units(roster.policy_days)>0n:null;
  }
  const pattern=context.patterns.find(p=>p.id===period.work_pattern_id);
  if(!pattern||!context.pattern_approvals.some(a=>a.work_pattern_id===pattern.id))return null;
  return pattern.working_weekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay()||7);
}

// This conservative definition must be explicitly accepted in the cohort configuration.
export function separatedMedicalDates(context,left,right) {
  const a=dayNumber(left),b=dayNumber(right);
  if(b<=a+1)return false;
  for(let n=a+1;n<b&&n<=a+370;n++) {
    const work=scheduled(context,isoDay(n));
    if(work===null)return null;
    if(work)return true;
  }
  return b-a>370?null:false;
}

export function singleMedicalShiftCharge(context,date,charge){
 const basis=context.bases.filter(b=>b.effective_from<=date).at(-1);
 if(basis?.schedule_mode!=='roster')return units(charge)===1000000n;
 const roster=context.rosters.find(r=>r.day===date);
 return !!roster&&Number(roster.paid_hours)>0&&units(roster.policy_days)>0n&&units(roster.policy_days)<=2000000n&&units(charge)===units(roster.policy_days);
}

export function medicalAssessment(context,config,input,result,history=[]) {
  if(input.code!=='medical')return {issues:[],exemptions_used:0};
  const issues=[];
  const account=context.entitlements.find(e=>e.id===result.allocations[0]?.entitlement_id);
  if(account?.opening_id&&config.medical_period_start!==account.period_start)issues.push('HR must certify medical history for this opening service year before applying.');
  const baseline=config.medical_period_start===account?.period_start?config.medical_history:[];
  const records=[...baseline,...history];
  const exemption=input.medical_mode==='exemption';
  const used=records.filter(r=>r.uncertified&&r.period_start===account?.period_start).length;
  const policy=context.policies.find(p=>p.id===result.segments[0]?.policy_version_id);
  const shiftRule=config.medical_rule==='single_verified_shift_nonadjacent_scheduled_days';
  const validCharge=shiftRule?singleMedicalShiftCharge(context,input.start_date,result.charge):units(result.charge)===1000000n;
  if(exemption&&(input.start_date!==input.end_date||!validCharge||result.allocations.length!==1))issues.push(shiftRule?'The approved exemption covers one calendar date and its verified roster shift charge only. Attach a certificate or use an assisted case.':'The approved exemption covers one calendar date and exactly one policy day only. Attach a certificate or use an assisted case.');
  if(exemption&&used>=(policy?.rules.medical_uncertified_occasions??0))issues.push('The uncertified single-day allowance is already committed. A certificate is required.');
  for(const record of records) {
    if(!(exemption||record.uncertified))continue;
    if(input.start_date<=record.end_date&&input.end_date>=record.start_date) {issues.push('This absence overlaps recorded medical history.');continue;}
    const left=input.end_date<record.start_date?input.end_date:record.end_date;
    const right=input.end_date<record.start_date?record.start_date:input.start_date;
    const separated=separatedMedicalDates(context,left,right);
    if(separated===null)issues.push('Medical adjacency needs verified calendar/schedule coverage or an assisted determination.');
    else if(!separated)issues.push('Adjacent medical absences cannot use a single-day exemption. Cancel pending items and submit the combined certified absence, or request an assisted amendment.');
  }
  return {issues:[...new Set(issues)],exemptions_used:used};
}

export function fortnightAmount(annualQuantum,index,creditedDays) {
  if(!Number.isInteger(index)||index<0||!Number.isInteger(creditedDays)||creditedDays<0||creditedDays>14)throw new Error('Invalid approved fortnight calculation.');
  const quantum=units(annualQuantum),i=BigInt(index%26);
  const full=quantum*(i+1n)/26n-quantum*i/26n;
  return decimal(full*BigInt(creditedDays)/14n);
}

import {dayNumber,isoDay,serviceFacts,units,decimal} from './governmentLeaveRules.js';

// Selected by trusted submission services, never by a client-supplied flag.
export const isSimpleApproval=request=>request.application_snapshot?.simple_approval===true||request.route_correction?.approval_route?.simple_approval===true;

export const approvalChecks=code=>({
 medical:['The medical certificate covers the whole absence, where a certificate is required.'],
 special:['The reason and supporting information justify Special leave.'],
 maternity:['Parenthood and employee eligibility are verified.','The practitioner certificate confirms the expected birth date and fitness to continue work where required.'],
 paternity:['Parenthood, employee eligibility and the birth or adoption evidence are verified.'],
 adoption:['The adoption order is verified and the child meets the age and relationship requirements.'],
 extended_medical:['The medical certificate covers this extension and ordinary Medical leave has been reconciled.'],
 extended_medical_minister:['The medical certificate covers this extension and the prior medical extension is complete.'],
 lwop:['The purpose justifies unpaid leave and other leave is unavailable for this purpose.'],
 official:['The travel is outside the Republic for an official purpose and the required documents are verified.'],
 witness_republic:['Court documents confirm the required attendance as a Republic witness.'],
 witness_other:['Court documents confirm the required attendance as an unpaid witness.'],
 teacher_recreation:['The teacher appointment, dates and Education processing requirements are verified.'],
 attendance:['The employee’s response and the supporting attendance evidence have been considered.'],
 amendment:['The requested cancellation or early return and any payroll correction have been checked.'],
 long_service:['Prior usage, the benefit unit and payment calculation have been checked.'],
 furlough:['Prior usage, the benefit unit and any payment calculation have been checked.'],
 recreation_encashment:['Available Recreation credit and the payment calculation have been checked.'],
 recreation_separation:['The cessation reason, available Recreation credit and payment calculation have been checked.'],
}[code]||[]);

export function simpleCaseDetails(value={},code=null) {
 const details=typeof value==='string'?JSON.parse(value):value;
 if(!details||typeof details!=='object'||Array.isArray(details)||JSON.stringify(details).length>10000)throw new Error('Use valid leave details.');
 const allowed=['sex_eligibility','pregnancy_number','expected_birth_date','event_kind','child_birth_date','spouse_or_stepchild','extension_basis','salary_percent','allowance_amount','action','requested_units','duration_unit','prior_consumed','prior_history_reference','transition_resolution_reference','salary_valuation_reference','payable_amount','entitlement_id','outcome'];
 const fields={maternity:['sex_eligibility','pregnancy_number','expected_birth_date'],paternity:['sex_eligibility','event_kind','child_birth_date'],adoption:['sex_eligibility','child_birth_date','spouse_or_stepchild'],lwop:['extension_basis'],extended_medical_minister:['salary_percent'],official:['allowance_amount'],attendance:['outcome'],amendment:['action']};
 const financial=['action','requested_units','duration_unit','prior_consumed','prior_history_reference','transition_resolution_reference','salary_valuation_reference','payable_amount','entitlement_id'];
 const permitted=code?(['long_service','furlough','recreation_encashment','recreation_separation'].includes(code)?financial:fields[code]||[]):allowed;
 return Object.fromEntries(permitted.filter(key=>details[key]!==undefined&&details[key]!=='').map(key=>[key,details[key]]));
}

// The recorded approval is the authority; no signed HR/Secretary references
// or separately entered salary periods are manufactured for this workflow.
export function simpleCaseInput(context,input,details,source) {
 const confirmations={
  maternity:['parenthood_verified','certificate_complete','fitness_certified'],
  paternity:['parenthood_verified','certificate_complete','adoption_order_verified'],
  adoption:['parenthood_verified','adoption_order_verified'],
  extended_medical:['certificate_complete','ordinary_medical_reconciled'],
  extended_medical_minister:['certificate_complete','ordinary_medical_reconciled'],
  lwop:['genuine_purpose','no_other_leave_accessible'],
  official:['outside_republic','official_documents_verified'],
  witness_republic:['court_evidence_verified'],witness_other:['court_evidence_verified'],
  long_service:['prior_history_reconciled'],furlough:['prior_history_reconciled'],
  recreation_encashment:['prior_history_reconciled'],recreation_separation:['prior_history_reconciled'],
 };
 const facts={...simpleCaseDetails(input.case_details,input.code),...simpleCaseDetails(details,input.code),eligibility_confirmed:true,
  ...Object.fromEntries((confirmations[input.code]||[]).map(key=>[key,true])),
  approval_basis:'assigned_approver',review_reference:source};
 if(facts.pregnancy_number!==undefined)facts.pregnancy_number=Number(facts.pregnancy_number);
 if(facts.spouse_or_stepchild==='false')facts.spouse_or_stepchild=false;
 if(facts.spouse_or_stepchild==='true')facts.spouse_or_stepchild=true;
 if(['paternity','adoption'].includes(input.code))facts.event_date=input.start_date;
 if(input.code==='adoption')facts.event_kind='adoption';
 if(input.code==='extended_medical_minister')facts.prior_extended_request_id=input.related_request_id;
 if(input.code==='amendment'){facts.original_request_id=input.related_request_id;facts.action=input.amendment_action||facts.action;facts.salary_correction_reference=source;}
 if(facts.allowance_amount!==undefined)facts.allowance_reference=source;
 facts.currency='AUD';
 let rate=['lwop','witness_other','amendment'].includes(input.code)?'0':input.code==='attendance'?(facts.outcome==='excused_paid'?'100':'0'):input.code==='extended_medical_minister'?facts.salary_percent:'100';
 const pay=[];
 if(['maternity','paternity','adoption'].includes(input.code)){
  const six=serviceFacts(context,input.start_date).milestone(6);
  if(!six)throw new Error('Verified service must establish the six-month milestone.');
  rate=input.code==='maternity'&&facts.pregnancy_number>=5?'50':'100';
  if(six>input.start_date){pay.push({start_date:input.start_date,end_date:six>input.end_date?input.end_date:isoDay(dayNumber(six)-1),salary_percent:'0'});}
  if(six<=input.end_date)pay.push({start_date:six>input.start_date?six:input.start_date,end_date:input.end_date,salary_percent:rate});
 }else pay.push({start_date:input.start_date,end_date:input.end_date,salary_percent:rate});
 return {facts,pay_segments:pay,source_reference:source,evidence_reference:`leave-application:${input.request_id}`};
}

export function scheduledBenefitUnits(evaluation,unit){return decimal(evaluation.segments.reduce((n,s)=>n+(unit==='calendar_days'?1000000n:unit==='roster_shifts'?(s.scheduled_hours>0?1000000n:0n):s.holiday?0n:units(s.charge)),0n));}

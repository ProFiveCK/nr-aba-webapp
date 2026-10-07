import {dayNumber,isoDay,monthBoundary,serviceFacts,units,decimal,fingerprint} from './governmentLeaveRules.js';
export const CASE_CODES=['teacher_recreation','extended_medical','extended_medical_minister','maternity','paternity','adoption','official','lwop','long_service','furlough','recreation_encashment','recreation_separation','witness_republic','witness_other','attendance','amendment'];
export const FINANCIAL_CODES=['long_service','furlough','recreation_encashment','recreation_separation'];
export const NON_ABSENCE_CODES=['long_service','recreation_encashment','recreation_separation','attendance','amendment'];
const requireFact=(condition,message)=>{if(!condition)throw new Error(message);};
const reference=(facts,key)=>requireFact(typeof facts[key]==='string'&&facts[key].trim().length>=5&&facts[key].length<=500,`Record the signed ${key.replace(/_/g,' ')}.`);
const uuid=(facts,key)=>{reference(facts,key);requireFact(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(facts[key]),`Use a valid ${key.replace(/_/g,' ')}.`);};
const confirmed=(facts,key)=>requireFact(facts[key]===true,`Verify ${key.replace(/_/g,' ')}.`);
export const isCase=code=>CASE_CODES.includes(code);
export function caseLevels(code){return ['division','department','hr_verifier',...(['lwop','extended_medical','extended_medical_minister','amendment'].includes(code)?['relevant_secretary']:[]),...(code==='extended_medical_minister'?['minister']:[]),'chief_secretary'];}
export function caseFoundation(context,input){
 requireFact(isCase(input.code),'Choose a supported assisted case.');
 const start=dayNumber(input.start_date),end=dayNumber(input.end_date);requireFact(end>=start&&end-start<=730,'An assisted case supports up to 731 calendar dates.');
 requireFact(context.employee.leave_policy_regime==='government','Enroll the employee in the government regime.');
 const segments=[];
 for(let n=start;n<=end;n++){
  const date=isoDay(n),policy=context.policies.find(p=>p.status==='published'&&p.effective_from<=date&&p.effective_to>=date),period=context.periods.find(p=>p.start_date<=date&&(!p.end_date||p.end_date>=date)),service=serviceFacts(context,date),calendar=context.calendars.find(c=>c.effective_from<=date&&c.effective_to>=date);
  requireFact(policy&&policy.evaluator_version==='gov-foundation-1','Published supported policy must cover every case date.');
  const serviceIssues=service.issues.filter(issue=>issue!=='An anniversary crosses unverified future service.');requireFact(period&&!serviceIssues.length,serviceIssues.join(' ')||'Verified appointment must cover every case date.');
  requireFact(!['unknown','casual','probationary'].includes(period.employment_category),'Resolve the legal employment category before an assisted application.');
  if(['maternity','paternity','adoption'].includes(input.code))requireFact(period.employment_category!=='temporary','Temporary parental applications are excluded by the September confirmation.');
  if(input.code==='lwop')requireFact(period.employment_category==='permanent','LWOP is restricted to permanent employees.');
  if(input.code==='teacher_recreation'){requireFact(period.is_teacher===true,'Teacher recreation requires a verified teacher appointment.');if(period.employment_category==='temporary'){const threshold=service.milestone(12);requireFact(threshold&&date>=threshold,'Temporary teacher recreation requires twelve months of credited service.');}}
  if(['long_service','furlough','witness_republic','witness_other'].includes(input.code))requireFact(['permanent','contract'].includes(period.employment_category),'This category requires a signed policy variation before this leave can be enabled.');
  let charge='0.000000',hours=0,rosterId=null,patternId=null;
  if(!NON_ABSENCE_CODES.includes(input.code)){
   requireFact(!context.exclusions.some(x=>x.kind==='lwop'&&x.start_date<=date&&x.end_date>=date),'The case overlaps a recorded LWOP service exclusion. Reconcile it first.');
   requireFact(calendar,'Approved holiday coverage is missing.');
   if(service.basis.schedule_mode==='roster'){
    const roster=context.rosters.find(r=>r.day===date);requireFact(roster,'Published roster coverage, including off-duty dates, is required.');charge=decimal(units(roster.policy_days));hours=Number(roster.paid_hours);rosterId=roster.id;
   }else{
    const pattern=context.patterns.find(p=>p.id===period.work_pattern_id);requireFact(pattern&&context.pattern_approvals.some(p=>p.work_pattern_id===pattern.id),'Verify the work pattern and policy-day conversion.');patternId=pattern.id;
    if(pattern.working_weekdays.includes(new Date(n*86400000).getUTCDay()||7)){charge='1.000000';hours=Number(pattern.hours_per_day);}
   }
  }
  segments.push({date,charge,scheduled_hours:hours,policy_version_id:policy.id,calendar_id:calendar?.id||null,service_basis_id:service.basis.id,service_period_id:period.id,employment_category:period.employment_category,is_teacher:period.is_teacher===true,roster_id:rosterId,work_pattern_id:patternId,holiday:calendar?.holidays.some(h=>h.date===date)||false});
 }
 const facts=serviceFacts(context,input.start_date);
 // Retain the records consumed by the dated decision. Unrelated later policy,
 // roster and service additions must not force already reviewed cases to restart.
 const used=(rows,key,segmentKey)=>rows.filter(row=>segments.some(segment=>segment[segmentKey]===row[key]));
 const bases=used(context.bases,'id','service_basis_id'),historyStart=bases.reduce((date,basis)=>basis.continuity_start<date?basis.continuity_start:date,input.start_date);
 const dependency={segments,
  periods:context.periods.filter(p=>p.start_date<=input.end_date&&(!p.end_date||p.end_date>=historyStart)).map(p=>({...p,end_date:p.end_date&&p.end_date<input.end_date?p.end_date:input.end_date})),
  bases,exclusions:context.exclusions.filter(x=>x.start_date<=input.end_date&&x.end_date>=historyStart).map(x=>({...x,end_date:x.end_date<input.end_date?x.end_date:input.end_date})),
  patterns:used(context.patterns,'id','work_pattern_id'),pattern_approvals:used(context.pattern_approvals,'work_pattern_id','work_pattern_id'),rosters:used(context.rosters,'id','roster_id'),
  policies:used(context.policies,'id','policy_version_id').map(({effective_from:_from,effective_to:_to,...policy})=>policy),
  calendars:used(context.calendars,'id','calendar_id').map(({effective_from:_from,effective_to:_to,...calendar})=>({...calendar,holidays:calendar.holidays.filter(h=>h.date>=input.start_date&&h.date<=input.end_date)})),
 };
 return {engine_version:'gov-assisted-1',snapshot_projection_version:2,segments,scheduled_hours:segments.reduce((n,s)=>n+s.scheduled_hours,0),charge:'0.000000',allocations:[],policy_versions:dependency.policies,service_basis_id:facts.basis.id,snapshot_hash:fingerprint(dependency)};
}
export function validatePaySegments(input,segments){
 requireFact(Array.isArray(segments)&&segments.length>=1&&segments.length<=24,'Record one to 24 complete dated pay segments.');let cursor=input.start_date;
 return segments.map(segment=>{
  dayNumber(segment.start_date);dayNumber(segment.end_date);requireFact(segment.start_date===cursor&&segment.end_date>=cursor&&segment.end_date<=input.end_date,'Pay segments must be ordered and cover the complete case without gaps or overlap.');
  const rate=units(segment.salary_percent);requireFact(rate>=0n&&rate<=100000000n,'Salary percentage must be between 0 and 100.');cursor=isoDay(dayNumber(segment.end_date)+1);
  return {start_date:segment.start_date,end_date:segment.end_date,salary_percent:decimal(rate)};
 }).map((s,i,array)=>{if(i===array.length-1)requireFact(cursor===isoDay(dayNumber(input.end_date)+1),'Pay segments must cover the final date.');return s;});
}
export function determineCase(context,input,data){
 const evaluation=caseFoundation(context,input),facts=structuredClone(data.facts||{});requireFact(facts&&typeof facts==='object'&&!Array.isArray(facts)&&JSON.stringify(facts).length<=12000,'Use a bounded factual determination.');
 reference(data,'source_reference');reference(data,'evidence_reference');confirmed(facts,'eligibility_confirmed');
 const pay=validatePaySegments(input,data.pay_segments),count=dayNumber(input.end_date)-dayNumber(input.start_date)+1,service=serviceFacts(context,input.start_date),six=service.milestone(6);
 const allRate=rate=>requireFact(pay.every(s=>units(s.salary_percent)===units(rate)),`This case requires ${rate}% salary throughout.`);
 const before=isoDay(dayNumber(input.start_date)-1),durationEnd=months=>isoDay(dayNumber(monthBoundary(input.start_date,months,service.basis.leap_day_method))-1);
 let benefit=null,tasks=[],discretion=[];
 if(['maternity','paternity','adoption'].includes(input.code)){
  confirmed(facts,'parenthood_verified');requireFact(six,'Certified future service must establish the six-month milestone.');
  const expectedDays=input.code==='paternity'?14:84;
  if(input.code==='adoption')requireFact(count<=84,'Adoption leave cannot exceed twelve calendar weeks.');
  else {const endPeriod=context.periods.find(p=>p.start_date<=input.start_date&&(!p.end_date||p.end_date>=input.start_date));requireFact(count===expectedDays||(endPeriod.end_date===input.end_date&&count<expectedDays),'Use calendar weeks, shortened only by the verified employment cessation date.');}
  if(input.code==='maternity'){
   requireFact(facts.sex_eligibility==='female','Verify the female-employee eligibility specified by the reference.');
   requireFact(Number.isInteger(facts.pregnancy_number)&&facts.pregnancy_number>=1&&facts.pregnancy_number<=30,'Verify the pregnancy count.');confirmed(facts,'certificate_complete');dayNumber(facts.expected_birth_date);
   if(input.start_date>isoDay(dayNumber(facts.expected_birth_date)-42))confirmed(facts,'fitness_certified');
   tasks.push({kind:'return_confirmation',due_date:isoDay(dayNumber(input.end_date)-28),description:'Contact Chief Secretary four weeks before leave ends; record same/equivalent position and retained benefits on return.'});
  }else{
   requireFact(facts.sex_eligibility===(input.code==='paternity'?'male':'female'),'Verify the employee eligibility specified by the reference.');dayNumber(facts.event_date);
   requireFact(input.start_date===facts.event_date,'Parental leave must start at the recorded birth/adoption event.');
   if(input.code==='adoption'||facts.event_kind==='adoption'){
    confirmed(facts,'adoption_order_verified');dayNumber(facts.child_birth_date);requireFact(facts.child_birth_date<=facts.event_date&&facts.event_date<monthBoundary(facts.child_birth_date,12),'Child must be under twelve months at adoption.');
    if(input.code==='adoption')requireFact(facts.spouse_or_stepchild===false,'Adoption excludes spouse’s children and step-children.');
   }else {confirmed(facts,'certificate_complete');tasks.push({kind:'birth_register',due_date:null,description:'Obtain Births Register extract as soon as practicable; verify parenthood.'});}
  }
  if(['maternity','paternity'].includes(input.code)&&monthBoundary(input.notice_date,3)>input.start_date){reference(facts,'late_notice_authority_reference');discretion.push('late_parental_notice');}
  const ambiguous=input.code==='maternity'&&facts.pregnancy_number>=5&&six>input.start_date&&six<=input.end_date;
  if(ambiguous)reference(facts,'conflict_resolution_reference');
  for(const p of pay){
   if(p.start_date<six&&p.end_date>=six)throw new Error('Split the pay segment at the six-month service milestone.');
   const expected=p.end_date<six?'0':input.code==='maternity'&&facts.pregnancy_number>=5?'50':'100';
   if(ambiguous&&p.start_date>=six)requireFact(['50.000000','100.000000'].includes(p.salary_percent),'Signed ambiguous maternity determination must select half or full salary.');
   else requireFact(units(p.salary_percent)===units(expected),`The service/pregnancy rule requires ${expected}% salary for this dated segment.`);
  }
 }else if(input.code.startsWith('extended_medical')){
  confirmed(facts,'certificate_complete');confirmed(facts,'ordinary_medical_reconciled');reference(facts,'certificate_reference');
  requireFact(input.end_date<=durationEnd(input.code==='extended_medical'?3:12),'Extended medical period exceeds the statutory calendar-month limit.');
  if(input.code==='extended_medical')allRate('100');else uuid(facts,'prior_extended_request_id');
 }else if(input.code==='lwop'){
  confirmed(facts,'genuine_purpose');confirmed(facts,'no_other_leave_accessible');allRate('0');
  if(input.end_date>durationEnd(12)){requireFact(['relevant_study','exceptional_circumstances'].includes(facts.extension_basis),'LWOP beyond twelve months requires relevant study or exceptional circumstances.');reference(facts,'extension_authority_reference');discretion.push('extended_lwop');}
  tasks.push({kind:'return_to_duty',due_date:isoDay(dayNumber(input.end_date)+1),description:'Verify return and service pause. Reconcile affected accrual/service plans before resuming jobs.'});
 }else if(input.code==='official'){
  confirmed(facts,'outside_republic');reference(facts,'gazette_reference');confirmed(facts,'official_documents_verified');allRate('100');
  if(facts.allowance_amount!==undefined){requireFact(/^\d{1,10}(\.\d{1,2})?$/.test(String(facts.allowance_amount)),'Record a signed allowance amount with at most two decimal places.');reference(facts,'allowance_reference');}
  else requireFact(!facts.allowance_reference,'Record the approved allowance amount alongside its Minister-rate authority.');
  tasks.push({kind:'trip_outcome',due_date:isoDay(dayNumber(input.end_date)+1),description:'Record trip completion, early return or cancellation. Non-completion requires prompt return and five-working-day allowance recovery.'});
 }else if(input.code.startsWith('witness_')){
  confirmed(facts,'court_evidence_verified');reference(facts,'hod_notification_reference');allRate(input.code==='witness_republic'?'100':'0');
  if(input.code==='witness_other'){reference(facts,'conflict_resolution_reference');reference(facts,'grant_authority_reference');}
  else tasks.push({kind:'witness_remittance',due_date:null,description:'Record Republic witness fees excluding travel expenses, and actual remittance reference. No automatic payment.'});
 }else if(input.code==='teacher_recreation'){
  reference(facts,'education_processing_reference');reference(facts,'duration_unit_reference');allRate('100');tasks.push({kind:'teacher_timesheet',due_date:null,description:'Record Education timesheet reference and approved processing order.'});
 }else if(FINANCIAL_CODES.includes(input.code)){
  reference(facts,'prior_history_reference');confirmed(facts,'prior_history_reconciled');reference(facts,'duration_unit_reference');
  const prior=units(facts.prior_consumed||'0');requireFact(prior>=0n,'Prior usage/payouts cannot be negative.');const amount=units(facts.requested_units);requireFact(amount>0n,'Specify positive benefit units.');
  requireFact(['working_days','calendar_days','roster_shifts'].includes(facts.duration_unit),'Choose the signed benefit unit.');
  let years=0;for(let y=1;y<=50;y++){const milestone=service.milestone(y*12);if(!milestone||milestone>(input.notice_date<input.start_date?input.notice_date:input.start_date))break;years=y;}
  const gross=input.code==='long_service'?years>=5&&years<8?20:years>=8&&years<10?40:0:input.code==='furlough'?years>=10?60+9*(years-10):0:0;
  if(!['recreation_encashment','recreation_separation'].includes(input.code))requireFact(gross>0,'Certified credited service has not reached this benefit tier.');
  if(input.code==='long_service')requireFact(['encashment','contract_expiry','retirement','medical_retirement','redundancy','termination_without_cause','resignation','death_in_service'].includes(facts.action),'Long service is a separation benefit or Chief Secretary-authorised encashment.');
  if(input.code==='furlough')requireFact(['take_leave','encashment','contract_expiry','retirement','medical_retirement','redundancy','termination_without_cause','resignation','death_in_service'].includes(facts.action),'Choose taking leave, encashment or a qualified separation event.');
  if(facts.action!=='take_leave')requireFact(input.start_date===input.end_date,'Financial decisions use the event date; they do not create a calendar absence.');
  else {requireFact(input.code==='furlough','Only furlough is a taking-leave benefit.');const scheduleAmount=facts.duration_unit==='calendar_days'?BigInt(count)*1000000n:evaluation.segments.reduce((n,s)=>n+(facts.duration_unit==='roster_shifts'?(s.scheduled_hours>0?1000000n:0n):(s.holiday?0n:units(s.charge))),0n);requireFact(amount===scheduleAmount,'Benefit units must equal the verified dated absence segments.');allRate('100');}
  if(['recreation_encashment','recreation_separation'].includes(input.code)){if(input.code==='recreation_separation'){requireFact(['contract_expiry','retirement','medical_retirement','redundancy','termination_without_cause','termination_misconduct','resignation','death_in_service'].includes(facts.action),'Record the signed employment cessation reason without blanket forfeiture.');reference(facts,'separation_valuation_reference');}else {requireFact(facts.action==='encashment','Recreation cash-out is an exceptional encashment case.');reference(facts,'chief_direction_reference');}uuid(facts,'entitlement_id');}
  else requireFact(prior+amount<=BigInt(gross)*1000000n,'Request plus certified prior consumption exceeds the service-tier benefit.');
  if(facts.action!=='take_leave'){reference(facts,'salary_valuation_reference');requireFact(/^\d{1,10}(\.\d{1,2})?$/.test(String(facts.payable_amount)),'Record the signed payable monetary amount with at most two decimal places.');requireFact(facts.currency==='AUD','The supplied valuation must specify AUD.');}
  benefit={gross:decimal(BigInt(gross)*1000000n),requested:decimal(amount),prior:decimal(prior),service_years:years,unit:facts.duration_unit,action:facts.action};
  tasks.push({kind:'benefit_reconciliation',due_date:null,description:'Obtain Salary Unit acknowledgement of leave taken or payment. This case commits units once and never generates ABA.'});
 }else if(input.code==='attendance'){
  reference(facts,'due_process_reference');requireFact(['excused_paid','reviewed_unpaid'].includes(facts.outcome),'Record a reviewed attendance outcome, without an automatic disciplinary decision.');allRate(facts.outcome==='excused_paid'?'100':'0');
 }else if(input.code==='amendment'){
  uuid(facts,'original_request_id');requireFact(['cancel_grant','shorten_grant'].includes(facts.action),'Use cancellation or early-return shortening. A replacement application retains its own approvals.');reference(facts,'salary_correction_reference');
 }
 return {facts,pay_segments:pay,evaluation,benefit,tasks,discretion,source_reference:data.source_reference.trim(),evidence_reference:data.evidence_reference.trim(),notice_date:input.notice_date,previous_day:before};
}

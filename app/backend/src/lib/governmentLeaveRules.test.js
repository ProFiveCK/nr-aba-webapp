import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DEFAULT_RULES,calculateEvaluation,serviceFacts,units,decimal,dayNumber,monthBoundary,validateRules} from './governmentLeaveRules.js';
function context(category='permanent') {return {employee:{id:'employee',status:'active'},policies:[{id:'policy',status:'published',effective_from:'2026-01-01',effective_to:'2027-12-31',rules:DEFAULT_RULES}],calendars:[{id:'calendar',effective_from:'2026-01-01',effective_to:'2027-12-31',holidays:[{date:'2026-10-26',name:'Synthetic holiday'}]}],periods:[{id:'period',start_date:'2026-01-01',end_date:null,employment_category:category,counts_for_service:true,work_pattern_id:'pattern',is_intern:false,is_teacher:false}],bases:[{id:'basis',effective_from:'2026-01-01',continuity_start:'2026-01-01',anniversary_method:'calendar',leap_day_method:'feb28',schedule_mode:'weekly'}],exclusions:[],patterns:[{id:'pattern',working_weekdays:[1,2,3,4,5],hours_per_day:'7'}],pattern_approvals:[{id:'approval',work_pattern_id:'pattern'}],rosters:[],entitlements:['recreation','medical','special'].map(code=>({id:code,code,period_start:'2026-01-01',period_end:'2026-12-31',as_of:'2026-01-01',available:'20'}))};}
const input=(code='recreation',start='2026-10-27',end=start)=>({code,start_date:start,end_date:end,notice_date:'2026-10-01',certificate_available:true,justification_available:true});
test('ordinary three-month and temporary twelve-month recreation are distinct; temporary Medical/Special and intern category remain distinct',()=>{
 let c=context();assert.ok(calculateEvaluation(c,{...input('recreation','2026-04-01'),notice_date:'2026-03-01'}).eligible_for_preview);assert.match(calculateEvaluation(c,input('recreation','2026-03-31')).issues.join(),/3 months/);
 c=context('temporary');assert.match(calculateEvaluation(c,input()).issues.join(),/12 months/);assert.ok(calculateEvaluation(c,input('medical')).eligible_for_preview);assert.ok(calculateEvaluation(c,input('special')).eligible_for_preview);
 c.periods[0].is_intern=true;assert.ok(calculateEvaluation(c,input('medical')).eligible_for_preview);c.periods[0].employment_category='unknown';assert.match(calculateEvaluation(c,input('medical')).issues.join(),/applicable legal terms/);
 assert.match(calculateEvaluation(context('temporary'),input('maternity')).issues.join(),/excluded/);assert.match(calculateEvaluation(context('contract'),input('lwop')).issues.join(),/permanent/);
});
test('notice uses calendar days; holidays exempt only recreation/medical; medical eight days use one pool',()=>{
 const c=context();assert.ok(calculateEvaluation(c,{...input('recreation','2026-10-15'),notice_date:'2026-10-01'}).eligible_for_preview);assert.match(calculateEvaluation(c,{...input('recreation','2026-10-14'),notice_date:'2026-10-01'}).issues.join(),/14 calendar/);
 assert.equal(calculateEvaluation(c,input('recreation','2026-10-26','2026-10-27')).charge,'1.000000');assert.equal(calculateEvaluation(c,input('medical','2026-10-26','2026-10-27')).charge,'1.000000');assert.equal(calculateEvaluation(c,input('special','2026-10-26','2026-10-27')).charge,'2.000000');
 const eight=calculateEvaluation(c,input('medical','2026-11-02','2026-11-11'));assert.equal(eight.charge,'8.000000');assert.ok(eight.eligible_for_preview);assert.match(calculateEvaluation(c,{...input('medical','2026-11-02','2026-11-11'),certificate_available:false}).issues.join(),/certificate/);
});
test('missing pattern/calendar/roster fails closed; verified 12-hour and off-duty roster are explicit',()=>{
 const c=context();c.pattern_approvals=[];assert.match(calculateEvaluation(c,input()).issues.join(),/conversion/);c.bases[0].schedule_mode='roster';assert.match(calculateEvaluation(c,input()).issues.join(),/roster coverage/);
 c.rosters=[{id:'r',day:'2026-10-27',paid_hours:'12',policy_days:'1.5'},{id:'off',day:'2026-10-28',paid_hours:'0',policy_days:'0'}];const result=calculateEvaluation(c,input('recreation','2026-10-27','2026-10-28'));assert.equal(result.charge,'1.500000');assert.equal(result.scheduled_hours,12);assert.ok(result.eligible_for_preview);
 c.calendars=[];assert.match(calculateEvaluation(c,input()).issues.join(),/calendar/);
});
test('LWOP pauses credited thresholds without resetting continuity; breaks and unknown credit require review',()=>{
 const c=context();c.exclusions=[{start_date:'2026-02-01',end_date:'2026-02-28',kind:'lwop'}];assert.equal(serviceFacts(c,'2026-05-01').milestone(3),'2026-04-29');assert.equal(serviceFacts(c,'2026-05-01').credited_days,92);
 c.bases[0].anniversary_method='pause_exclusions';assert.equal(serviceFacts(c,'2026-05-01').period_end,'2027-01-28');assert.match(calculateEvaluation(c,input('medical','2026-02-10')).issues.join(),/overlaps recorded LWOP/);
 c.exclusions[0].kind='continuity_break';assert.match(serviceFacts(c,'2026-05-01').issues.join(),/new certified/);c.periods[0].counts_for_service=null;assert.match(serviceFacts(c,'2026-05-01').issues.join(),/unresolved/);
});
test('long exclusions and service-year splits are bounded, leap convention explicit and exact precision preserved',()=>{
 const c=context();c.exclusions=[{start_date:'2026-01-02',end_date:'2026-08-01',kind:'lwop'}];assert.equal(serviceFacts(c,'2026-10-27').milestone(3),'2026-10-30');
 assert.equal(monthBoundary('2024-02-29',12,'feb28'),'2025-02-28');assert.equal(monthBoundary('2024-02-29',12,'mar1'),'2025-03-01');assert.equal(decimal(units('0.769231')*26n),'20.000006');assert.throws(()=>units('0.1234567'));assert.throws(()=>dayNumber('2026-02-30'));
 const split=context();split.entitlements.push({id:'medical-next',code:'medical',period_start:'2027-01-01',period_end:'2027-12-31',as_of:'2027-01-01',available:'10'});const result=calculateEvaluation(split,input('medical','2026-12-31','2027-01-04'));assert.equal(result.allocations.length,2);assert.equal(result.segments.at(-1).service_period_start,'2027-01-01');
});
test('policy publication boundaries retain versions and no forecast or discretionary event becomes a fake balance',()=>{
 const c=context();c.policies[0].effective_to='2026-10-27';c.policies.push({...c.policies[0],id:'policy-next',effective_from:'2026-10-28',effective_to:'2027-12-31'});const result=calculateEvaluation(c,input('medical','2026-10-27','2026-10-28'));assert.equal(result.policy_versions.length,2);assert.notEqual(result.segments[0].policy_version_id,result.segments[1].policy_version_id);
 const mismatch=context();mismatch.entitlements[0].period_start='2025-12-31';assert.match(calculateEvaluation(mismatch,input()).issues.join(),/opening entitlement/);c.entitlements=[];assert.match(calculateEvaluation(c,input()).issues.join(),/forecast accrual/);assert.match(calculateEvaluation(context(),input('official')).issues.join(),/assisted case/);const teacher=context();teacher.periods[0].is_teacher=true;assert.match(calculateEvaluation(teacher,input()).issues.join(),/Teacher/);
 assert.equal(result.engine_version,'gov-foundation-1');assert.equal(result.required_offices.at(-1),'chief_secretary');const unknown=context();unknown.policies[0].evaluator_version='future-unsupported';assert.match(calculateEvaluation(unknown,input()).issues.join(),/unsupported/i);assert.throws(()=>validateRules({...DEFAULT_RULES,arbitrary_formula:'eval'}));assert.throws(()=>validateRules({...DEFAULT_RULES,recreation_cap_days:'1'}));
});

test('trusted Medical shift exception still requires one paid roster date and bounded shift conversion',()=>{
 const c=context();c.bases[0].schedule_mode='roster';c.rosters=[{id:'shift',day:'2026-10-27',paid_hours:'12',policy_days:'1.5'},{id:'off',day:'2026-10-28',paid_hours:'0',policy_days:'0'}];
 const request={...input('medical'),certificate_available:false};assert.match(calculateEvaluation(c,request).issues.join(),/certificate/);
 assert.ok(calculateEvaluation(c,{...request,verified_single_shift_exemption:true}).eligible_for_preview);
 assert.match(calculateEvaluation(c,{...request,end_date:'2026-10-28',verified_single_shift_exemption:true}).issues.join(),/certificate/);
 c.rosters[0].paid_hours='0';assert.match(calculateEvaluation(c,{...request,verified_single_shift_exemption:true}).issues.join(),/certificate/);
 c.rosters[0].paid_hours='20';c.rosters[0].policy_days='2.5';assert.match(calculateEvaluation(c,{...request,verified_single_shift_exemption:true}).issues.join(),/certificate/);
});

test('optional calendar coverage uses scheduled days and preserves entered holiday exemptions',()=>{
 const c=context();c.calendar_settings={require_calendar_coverage:false};c.calendars=[];
 const result=calculateEvaluation(c,input('medical'));
 assert.equal(result.eligible_for_preview,true,result.issues.join(' '));assert.equal(result.charge,'1.000000');assert.equal(result.segments[0].calendar_id,null);assert.equal(result.warnings.length,1);
 c.calendar_settings.require_calendar_coverage=true;
 assert.match(calculateEvaluation(c,input('medical')).issues.join(' '),/calendar/);
 c.calendar_settings.require_calendar_coverage=false;
 c.calendars=[{id:'entered',effective_from:'2026-10-27',effective_to:'2026-10-27',holidays:[{date:'2026-10-27',name:'Entered holiday'}]}];
 const mixed=calculateEvaluation(c,{...input('medical'),end_date:'2026-10-28',certificate_available:true});
 assert.equal(mixed.eligible_for_preview,true,mixed.issues.join(' '));assert.equal(mixed.charge,'1.000000');assert.equal(mixed.segments[0].holiday_exempt,true);assert.equal(mixed.segments[1].calendar_id,null);
});

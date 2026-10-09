import {test} from 'node:test';
import assert from 'node:assert/strict';
import {caseFoundation,determineCase,validatePaySegments} from './governmentLeaveCaseRules.js';
import {DEFAULT_RULES,isoDay,dayNumber} from './governmentLeaveRules.js';
const context=(start='2010-01-01')=>({employee:{id:'e',status:'active',leave_policy_regime:'government'},policies:[{id:'p',status:'published',evaluator_version:'gov-foundation-1',effective_from:'2026-01-01',effective_to:'2027-12-31',rules:DEFAULT_RULES}],calendars:[{id:'c',effective_from:'2026-01-01',effective_to:'2027-12-31',holidays:[{date:'2026-11-02'}]}],periods:[{id:'s',start_date:start,end_date:null,employment_category:'permanent',counts_for_service:true,work_pattern_id:'w'}],bases:[{id:'b',effective_from:start,continuity_start:start,anniversary_method:'pause_exclusions',leap_day_method:'feb28',schedule_mode:'weekly'}],exclusions:[],rosters:[],patterns:[{id:'w',working_weekdays:[1,2,3,4,5],hours_per_day:7}],pattern_approvals:[{work_pattern_id:'w'}],entitlements:[]});
const input=(code,start='2026-11-01',days=1)=>({code,start_date:start,end_date:isoDay(dayNumber(start)+days-1),notice_date:'2026-10-07'});
const data=(i,facts,rate='100')=>({source_reference:'Synthetic signed case authority',evidence_reference:'Synthetic retained document verification',facts:{eligibility_confirmed:true,...facts},pay_segments:[{start_date:i.start_date,end_date:i.end_date,salary_percent:rate}]});
test('pay segmentation rejects uncovered dates, overlaps, unordered dates and out-of-range rates',()=>{
 const i=input('official','2026-11-01',5);for(const segments of [[],[{start_date:'2026-11-02',end_date:'2026-11-05',salary_percent:'100'}],[{start_date:'2026-11-01',end_date:'2026-11-04',salary_percent:'100'}],[{start_date:'2026-11-01',end_date:'2026-11-05',salary_percent:'100.01'}]])assert.throws(()=>validatePaySegments(i,segments));
 assert.equal(validatePaySegments(i,[{start_date:'2026-11-01',end_date:'2026-11-02',salary_percent:'50'},{start_date:'2026-11-03',end_date:'2026-11-05',salary_percent:'100'}]).length,2);
});
test('fifth pregnancy has half salary after established six-month service; calendar weeks do not shrink for holidays',()=>{
 const i=input('maternity','2026-11-01',84),facts={parenthood_verified:true,sex_eligibility:'female',pregnancy_number:5,certificate_complete:true,expected_birth_date:'2026-12-13',late_notice_authority_reference:'Synthetic Chief Secretary late notice consent'};
 assert.throws(()=>determineCase(context(),i,data(i,facts)),/requires 50/);const r=determineCase(context(),i,data(i,facts,'50'));assert.equal(r.pay_segments[0].salary_percent,'50.000000');assert.equal(r.evaluation.segments.length,84);assert.equal(r.evaluation.charge,'0.000000');
});
test('LWOP beyond twelve calendar months needs a supported reason and explicit Chief Secretary determination',()=>{
 const i=input('lwop','2026-11-01',367),facts={genuine_purpose:true,no_other_leave_accessible:true};assert.throws(()=>determineCase(context(),i,data(i,facts,'0')),/beyond twelve/);const r=determineCase(context(),i,data(i,{...facts,extension_basis:'relevant_study',extension_authority_reference:'Synthetic relevant public service study direction'},'0'));assert.deepEqual(r.discretion,['extended_lwop']);
});
test('benefit service milestones are five/eight/ten years with preserved pause days and no forecast encashment',()=>{
 const i=input('long_service','2026-10-07'),facts={action:'encashment',requested_units:'20',duration_unit:'working_days',duration_unit_reference:'Synthetic working-day authority',prior_consumed:'0',prior_history_reference:'Synthetic prior-payout register',prior_history_reconciled:true,salary_valuation_reference:'Synthetic reviewed valuation',payable_amount:'500',currency:'AUD'};
 assert.equal(determineCase(context('2021-10-07'),i,data(i,facts)).benefit.gross,'20.000000');assert.equal(determineCase(context('2018-10-07'),i,data(i,{...facts,requested_units:'40'})).benefit.gross,'40.000000');assert.throws(()=>determineCase(context('2016-10-07'),i,data(i,facts)),/benefit tier/);
 const paused=context('2021-10-07');paused.exclusions=[{kind:'lwop',start_date:'2026-01-01',end_date:'2026-01-10'}];assert.throws(()=>determineCase(paused,i,data(i,facts)),/benefit tier/);
 const future=input('furlough','2027-10-07');assert.throws(()=>determineCase(context('2016-10-08'),future,data(future,{...facts,requested_units:'60'})),/benefit tier/);
});
test('furlough signed working days exclude a Gazette holiday; signed calendar-day unit counts the full period',()=>{
 const i=input('furlough','2026-11-02',5),facts={action:'take_leave',duration_unit:'working_days',requested_units:'4',duration_unit_reference:'Synthetic holiday-excluding working-day schedule',prior_history_reference:'Synthetic reconciled historic payout register',prior_history_reconciled:true,prior_consumed:'0'};
 assert.equal(determineCase(context(),i,data(i,facts)).benefit.requested,'4.000000');assert.throws(()=>determineCase(context(),i,data(i,{...facts,requested_units:'5'})),/verified dated absence/);assert.equal(determineCase(context(),i,data(i,{...facts,duration_unit:'calendar_days',requested_units:'5'})).benefit.requested,'5.000000');
});
test('assisted foundation stops uncovered calendar, unknown category and service changes without inventing annual credit',()=>{
 const i=input('official');const c=context();c.calendars=[];assert.throws(()=>caseFoundation(c,i),/holiday coverage/);const unknown=context();unknown.periods[0].employment_category='unknown';assert.throws(()=>caseFoundation(unknown,i),/legal employment category/);
 const c1=context(),before=caseFoundation(c1,i);c1.exclusions.push({kind:'other_excluded',start_date:'2026-01-01',end_date:'2026-01-03'});assert.notEqual(caseFoundation(c1,i).snapshot_hash,before.snapshot_hash);
});

test('dated case dependencies ignore unrelated future publications but retain consumed policy, schedule and service',()=>{
 const c=context(),i=input('official','2026-11-02',3),before=caseFoundation(c,i);
 c.policies.push({...c.policies[0],id:'future',effective_from:'2028-01-01',effective_to:'2029-12-31'});
 c.calendars.push({...c.calendars[0],id:'future-calendar',effective_from:'2028-01-01',effective_to:'2029-12-31'});
 c.rosters.push({id:'future-roster',day:'2028-01-01',paid_hours:8,policy_days:'1'});
 c.patterns.push({id:'unused',working_weekdays:[1],hours_per_day:8});
 c.periods.push({...c.periods[0],id:'future-period',start_date:'2028-01-01'});
 assert.equal(caseFoundation(c,i).snapshot_hash,before.snapshot_hash);
 c.policies[0]={...c.policies[0],rules:{...DEFAULT_RULES,special_annual_days:'4'}};
 assert.notEqual(caseFoundation(c,i).snapshot_hash,before.snapshot_hash);
 c.policies[0].rules=DEFAULT_RULES;c.patterns[0].hours_per_day=8;
 assert.notEqual(caseFoundation(c,i).snapshot_hash,before.snapshot_hash);
});

test('an optional holiday calendar also permits scheduled assisted-case dates',()=>{
 const c=context();c.calendars=[];c.calendar_settings={require_calendar_coverage:false};
 const result=caseFoundation(c,input('official'));assert.ok(result.segments.length);assert.equal(result.segments[0].calendar_id,null);
 c.calendar_settings.require_calendar_coverage=true;assert.throws(()=>caseFoundation(c,input('official')),/holiday coverage/);
});

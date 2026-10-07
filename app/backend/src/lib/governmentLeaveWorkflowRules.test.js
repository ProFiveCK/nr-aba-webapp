import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fortnightAmount,separatedMedicalDates,medicalAssessment} from './governmentLeaveWorkflowRules.js';
import {units,decimal} from './governmentLeaveRules.js';
const context=()=>({calendars:[{effective_from:'2026-01-01',effective_to:'2027-12-31',holidays:[]}],bases:[{effective_from:'2026-01-01',schedule_mode:'weekly'}],periods:[{start_date:'2026-01-01',work_pattern_id:'week'}],patterns:[{id:'week',working_weekdays:[1,2,3,4,5]}],pattern_approvals:[{work_pattern_id:'week'}],rosters:[],entitlements:[{id:'medical',period_start:'2026-01-01'}],policies:[{id:'policy',rules:{medical_uncertified_occasions:3}}]});
test('26 approved full fortnight postings preserve the annual quantum exactly; proration is explicit',()=>{
 let total=0n;for(let i=0;i<26;i++)total+=units(fortnightAmount('20',i,14));assert.equal(decimal(total),'20.000000');
 assert.equal(fortnightAmount('20',0,7),'0.384615');assert.equal(fortnightAmount('20',26,14),fortnightAmount('20',0,14));assert.throws(()=>fortnightAmount('20',0,15));
});
test('medical adjacency uses the approved scheduled-day definition, including weekend/holiday and missing roster coverage',()=>{
 const c=context();assert.equal(separatedMedicalDates(c,'2026-11-06','2026-11-09'),false);assert.equal(separatedMedicalDates(c,'2026-11-06','2026-11-10'),true);
 c.calendars[0].holidays=[{date:'2026-11-09'}];assert.equal(separatedMedicalDates(c,'2026-11-06','2026-11-10'),false);c.bases[0].schedule_mode='roster';assert.equal(separatedMedicalDates(c,'2026-11-06','2026-11-10'),null);
});
test('uncertified counter counts baseline and pending holds; adjacent certified requests cannot silently extend an exemption',()=>{
 const c=context(),config={medical_period_start:'2026-01-01',medical_history:[{start_date:'2026-02-02',end_date:'2026-02-02',uncertified:true,period_start:'2026-01-01'}]},result={charge:'1.000000',allocations:[{entitlement_id:'medical'}],segments:[{policy_version_id:'policy'}]},input={code:'medical',start_date:'2026-11-06',end_date:'2026-11-06',medical_mode:'exemption'};
 const history=[{start_date:'2026-03-02',end_date:'2026-03-02',uncertified:true,period_start:'2026-01-01'},{start_date:'2026-04-02',end_date:'2026-04-02',uncertified:true,period_start:'2026-01-01'}];
 assert.match(medicalAssessment(c,config,input,result,history).issues.join(),/already committed/);
 assert.match(medicalAssessment(c,config,{...input,start_date:'2026-11-09',end_date:'2026-11-09',medical_mode:'certificate'},result,[{start_date:'2026-11-06',end_date:'2026-11-06',uncertified:true,period_start:'2026-01-01'}]).issues.join(),/Adjacent/);
 assert.match(medicalAssessment(c,config,{...input,end_date:'2026-11-09'},result).issues.join(),/one calendar date/);
});

test('verified single-shift exception charges roster days while old approvals keep exactly one day',()=>{
 const c=context();c.bases[0].schedule_mode='roster';c.rosters=[{day:'2026-11-06',paid_hours:'12',policy_days:'1.5'}];
 const config={medical_rule:'single_verified_shift_nonadjacent_scheduled_days',medical_period_start:'2026-01-01',medical_history:[]},input={code:'medical',start_date:'2026-11-06',end_date:'2026-11-06',medical_mode:'exemption'},result={charge:'1.500000',allocations:[{entitlement_id:'medical'}],segments:[{policy_version_id:'policy'}]};
 assert.deepEqual(medicalAssessment(c,config,input,result).issues,[]);
 assert.match(medicalAssessment(c,{...config,medical_rule:'single_calendar_date_nonadjacent_scheduled_days'},input,result).issues.join(),/exactly one policy day/);
 assert.match(medicalAssessment(c,config,input,{...result,charge:'1.000000'}).issues.join(),/verified roster shift/);
 c.rosters=[];assert.match(medicalAssessment(c,config,input,result).issues.join(),/verified roster shift/);
 c.rosters=[{day:'2026-11-06',paid_hours:'12',policy_days:'2.5'}];assert.match(medicalAssessment(c,config,input,{...result,charge:'2.500000'}).issues.join(),/verified roster shift/);
 c.rosters=[{day:'2026-11-06',paid_hours:'12',policy_days:'1.5'}];const history=[1,2,3].map(n=>({start_date:`2026-0${n}-05`,end_date:`2026-0${n}-05`,uncertified:true,period_start:'2026-01-01'}));assert.match(medicalAssessment(c,config,input,result,history).issues.join(),/already committed/);
});

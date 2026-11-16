import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parentalEntitlements} from './governmentLeaveParentalEntitlements.js';
import {DEFAULT_RULES} from './governmentLeaveRules.js';

const context=()=>({employee:{id:'employee',status:'active',leave_policy_regime:'government'},policies:[{id:'policy',status:'published',evaluator_version:'gov-foundation-1',effective_from:'2026-01-01',effective_to:'2027-12-31',rules:DEFAULT_RULES}],calendars:[{id:'c',effective_from:'2026-01-01',effective_to:'2027-12-31',holidays:[]}],periods:[{id:'period',start_date:'2020-01-01',end_date:null,employment_category:'permanent',counts_for_service:true,work_pattern_id:'pattern'}],bases:[{id:'basis',effective_from:'2020-01-01',continuity_start:'2020-01-01',anniversary_method:'calendar',leap_day_method:'feb28',schedule_mode:'weekly'}],patterns:[{id:'pattern',working_weekdays:[1,2,3,4,5],hours_per_day:7}],pattern_approvals:[{work_pattern_id:'pattern'}],exclusions:[],rosters:[],entitlements:[]});

test('parental allowances remain visible without accrued accounts or opening balances and never become credits',()=>{
 const c=context(),before=structuredClone(c),summary=parentalEntitlements(c,'2026-11-16');
 assert.equal(summary.status,'conditional');assert.deepEqual(summary.items.map(i=>[i.code,i.working_days??i.calendar_days,i.maximum]),[['paternity',10,false],['maternity',84,false],['adoption',84,true]]);
 assert.equal(summary.six_month_service_date,'2020-07-01');
 assert.ok(summary.items.every(i=>!('available' in i)&&!('balance' in i)));
 assert.deepEqual(c,before);
});
test('appointment and policy gaps remain undetermined rather than asserting personal eligibility',()=>{
 for(const field of ['periods','bases','policies','patterns']){
  const c=context();c[field]=[];const summary=parentalEntitlements(c,'2026-11-16');
  assert.equal(summary.status,'review_required',field);assert.ok(summary.reason);assert.equal(summary.items[0].working_days,10);
 }
});
test('inactive and temporary appointments do not display a currently usable parental entitlement',()=>{
 const inactive=context();inactive.employee.status='inactive';assert.equal(parentalEntitlements(inactive,'2026-11-16').status,'unavailable');
 const temporary=context();temporary.periods[0].employment_category='temporary';assert.equal(parentalEntitlements(temporary,'2026-11-16').status,'unavailable');
 const unknown=context();unknown.periods[0].employment_category='unknown';assert.equal(parentalEntitlements(unknown,'2026-11-16').status,'review_required');
});
test('service milestones follow the verified service basis without exposing private source evidence',()=>{
 const c=context();c.bases[0].continuity_start='2026-08-01';c.bases[0].source_reference='PRIVATE personnel reference';
 const summary=parentalEntitlements(c,'2026-11-16');assert.equal(summary.six_month_service_date,'2027-02-01');assert.ok(!JSON.stringify(summary).includes('PRIVATE'));
 c.employee.leave_policy_regime='legacy';assert.equal(parentalEntitlements(c,'2026-11-16'),null);
});

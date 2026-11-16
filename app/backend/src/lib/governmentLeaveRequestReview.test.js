import {test} from 'node:test';
import assert from 'node:assert/strict';
import {leaveRequestReview} from './governmentLeaveRequestReview.js';
import {DEFAULT_RULES} from './governmentLeaveRules.js';
import {determineCase,parentalLeavePeriod} from './governmentLeaveCaseRules.js';
import {simpleCaseInput} from './governmentLeaveSimpleApproval.js';

const context=(start='2010-01-01')=>({employee:{id:'synthetic',status:'active',leave_policy_regime:'government'},policies:[{id:'p',status:'published',evaluator_version:'gov-foundation-1',effective_from:'2026-01-01',effective_to:'2027-12-31',rules:DEFAULT_RULES}],calendars:[],periods:[{id:'s',start_date:start,end_date:null,employment_category:'permanent',counts_for_service:true,work_pattern_id:'w'}],bases:[{id:'b',effective_from:start,continuity_start:start,anniversary_method:'pause_exclusions',leap_day_method:'feb28',schedule_mode:'weekly'}],exclusions:[],rosters:[],patterns:[{id:'w',working_weekdays:[1,2,3,4,5],hours_per_day:7}],pattern_approvals:[{work_pattern_id:'w'}],entitlements:[]});
const request=(code='paternity',end='2026-11-27')=>({id:'request',code,employee_id:'synthetic',status:'pending',start_date:'2026-11-12',end_date:end,charge:'0.000000',application_snapshot:{input:{request_id:'request',notice_date:'2026-11-13',case_details:{sex_eligibility:'male',event_kind:'birth',child_birth_date:'2026-11-12'}}}});
const account=(id='a',overrides={})=>({id,code:'recreation',period_start:'2026-01-01',period_end:'2026-12-31',balance:'20',held:'5',available:'15',...overrides});
const allocated=()=>({...request('recreation','2026-11-13'),charge:'2',application_snapshot:{evaluation:{allocations:[{entitlement_id:'a',amount:'2'}]}}});

test('16 calendar days are distinct from zero balance charge; the review and final validator agree',()=>{
 const c=context(),r=request(),before=structuredClone({c,r});
 const review=leaveRequestReview(c,r);
 assert.equal(review.parental.requested_days,16);assert.equal(review.parental.allowance_days,14);assert.equal(review.parental.valid,false);
 assert.equal(review.parental.expected_end,'2026-11-25');assert.match(review.issues[0],/16 calendar days.*14 calendar days/);
 const input={...r.application_snapshot.input,code:r.code,start_date:r.start_date,end_date:r.end_date};
 assert.throws(()=>determineCase(c,input,simpleCaseInput(c,input,{},'Synthetic review'),{assignedApproval:true}),/calendar weeks/);
 assert.deepEqual({c,r},before);
});
test('a full fortnight and employment cessation use the same period rule as approval',()=>{
 const c=context(),r=request('paternity','2026-11-25');
 assert.equal(leaveRequestReview(c,r).parental.valid,true);
 r.end_date='2026-11-24';assert.equal(leaveRequestReview(c,r).parental.valid,false);
 c.periods[0].end_date=r.end_date;
 assert.deepEqual(parentalLeavePeriod(c,r),{requested_days:13,allowance_days:14,allowed_days:13,expected_end:'2026-11-24',valid:true});
});
test('parental pay splits at six months; missing service produces unknown pay rather than full salary',()=>{
 const c=context('2026-05-20'),r=request('paternity','2026-11-25');
 const review=leaveRequestReview(c,r);
 assert.deepEqual(review.parental.pay_segments,[{start_date:'2026-11-12',end_date:'2026-11-19',salary_percent:'0'},{start_date:'2026-11-20',end_date:'2026-11-25',salary_percent:'100'}]);
 c.bases=[];const unknown=leaveRequestReview(c,r);assert.equal(unknown.parental.pay_segments.length,0);assert.ok(unknown.parental.pay_issue);
});
test('maternity pay preview uses the submitted pregnancy count and does not invent a rate when it is missing',()=>{
 const r=request('maternity','2027-02-03');r.application_snapshot.input.case_details={pregnancy_number:5};
 assert.equal(leaveRequestReview(context(),r).parental.pay_segments[0].salary_percent,'50');
 delete r.application_snapshot.input.case_details.pregnancy_number;
 assert.match(leaveRequestReview(context(),r).parental.pay_issue,/pregnancy number/);
});
test('other pending holds stay reserved and approval does not subtract this request twice',()=>{
 const c=context();c.entitlements=[account()];
 const review=leaveRequestReview(c,allocated(),[{entitlement_id:'a',amount:'2'}]);
 assert.deepEqual(review.periods[0],{entitlement_id:'a',period_start:'2026-01-01',period_end:'2026-12-31',request_charge:'2.000000',balance:'20.000000',available:'15.000000',request_held:'2.000000',other_held:'3.000000',available_before_request:'17.000000',available_after_approval:'15.000000'});
 assert.deepEqual(review.issues,[]);
});
test('cross-year and fractional charges retain their own entitlement accounts',()=>{
 const c=context(),r=allocated();c.entitlements=[account('a'),account('b',{period_start:'2027-01-01',period_end:'2027-12-31',balance:'3',held:'0.5',available:'2.5'})];
 r.application_snapshot.evaluation.allocations.push({entitlement_id:'b',amount:'0.5'});
 const result=leaveRequestReview(c,r,[{entitlement_id:'a',amount:'2'},{entitlement_id:'b',amount:'0.5'}]);
 assert.equal(result.periods.length,2);assert.equal(result.periods[1].available_after_approval,'2.500000');assert.equal(result.periods[1].request_charge,'0.500000');
});
test('missing or inconsistent reservations are undetermined rather than a fabricated remaining balance',()=>{
 const c=context();c.entitlements=[account()];
 for(const holds of [[],[{entitlement_id:'a',amount:'6'}]]){
  const review=leaveRequestReview(c,allocated(),holds);assert.ok(review.issues.length);assert.equal(review.periods[0].available_after_approval,null);
 }
 const missing=leaveRequestReview(c,{...allocated(),application_snapshot:{}});assert.equal(missing.periods.length,0);assert.match(missing.issues[0],/missing/);
});
test('approved balances and retained pay are read as posted without applying another deduction or current pay rule',()=>{
 const c=context();c.entitlements=[account()];const r={...allocated(),status:'approved'};
 const period=leaveRequestReview(c,r).periods[0];assert.equal(period.available,'15.000000');assert.equal(period.available_after_approval,null);
 const parental={...request(),status:'approved',grant_snapshot:{case_determination:{pay_segments:[{start_date:'2026-11-12',end_date:'2026-11-27',salary_percent:'50'}]}}};
 const result=leaveRequestReview(c,parental);assert.deepEqual(result.issues,[]);assert.equal(result.parental.pay_segments[0].salary_percent,'50');
});
test('summary does not return unrelated employee, service or application evidence',()=>{
 const c=context();c.employee.private_reference='SECRET';c.bases[0].source_reference='SECRET';const r=request();r.reason='SECRET';
 assert.ok(!JSON.stringify(leaveRequestReview(c,r)).includes('SECRET'));
});

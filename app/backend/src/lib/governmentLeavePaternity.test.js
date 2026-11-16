import {test} from 'node:test';
import assert from 'node:assert/strict';
import {paternityBalance} from './governmentLeavePaternity.js';
const context=()=>({bases:[{effective_from:'2020-05-01',continuity_start:'2020-05-01',anniversary_method:'calendar',leap_day_method:'feb28'}],periods:[{start_date:'2020-05-01',end_date:null,counts_for_service:true}],exclusions:[]});
const evaluation=(dates,holiday=null)=>({segments:dates.map(date=>({date,scheduled_hours:7,holiday:date===holiday}))});
const request=(id,status,dates,effect=null)=>({id,status,effect,application_snapshot:{evaluation:evaluation(dates)},grant_snapshot:status==='approved'?{evaluation:evaluation(dates)}:null});
test('ten working days renew on the employee service anniversary and do not carry forward',()=>{
 const result=paternityBalance(context(),{asOf:'2026-05-01',requests:[request('old','approved',['2026-04-30']),request('new','approved',['2026-05-01'])]});
 assert.deepEqual(result.periods.map(p=>[p.period_start,p.period_end,p.allowance_days,p.approved_days,p.available_days]),[['2026-05-01','2027-04-30',10,1,9]]);
});
test('pending reservations and approved usage share one annual allowance without double deduction',()=>{
 const requests=[request('past','approved',['2026-06-01','2026-06-02']),request('other','pending',['2026-07-01']),request('self','pending',['2026-08-01'])];
 let result=paternityBalance(context(),{requests,evaluation:evaluation(['2026-08-01']),requestId:'self',status:'pending'}).periods[0];
 assert.equal(result.available_before_request,7);assert.equal(result.available_after_approval,6);assert.equal(result.pending_days,2);
 requests[2].status='approved';result=paternityBalance(context(),{requests,evaluation:evaluation(['2026-08-01']),requestId:'self',status:'approved'}).periods[0];
 assert.equal(result.available_days,6);assert.equal(result.approved_days,3);
});
test('a request spanning the service anniversary consumes the working dates in each year',()=>{
 const periods=paternityBalance(context(),{evaluation:evaluation(['2026-04-30','2026-05-01']),status:'pending'}).periods;
 assert.equal(periods.length,2);assert.deepEqual(periods.map(p=>[p.requested_days,p.available_after_approval]),[[1,9],[1,9]]);
});
test('off-duty dates and public holidays are excluded; a long rostered shift counts as one working day',()=>{
 const e=evaluation(['2026-06-01','2026-06-02','2026-06-03'],'2026-06-02');e.segments[0].scheduled_hours=0;e.segments[2].scheduled_hours=12;e.segments[2].charge='1.5';
 assert.equal(paternityBalance(context(),{evaluation:e,status:'pending'}).periods[0].requested_days,1);
});
test('cancelled grants, early returns, rejected applications and own cancellation restore actual usage',()=>{
 const requests=[request('cancel','approved',['2026-06-01'],{action:'cancel_grant'}),request('return','approved',['2026-06-01','2026-06-02'],{action:'shorten_grant',effective_end:'2026-06-01'}),request('reject','rejected',['2026-06-03'])];
 assert.equal(paternityBalance(context(),{requests,asOf:'2026-06-04'}).periods[0].available_days,9);
 assert.equal(paternityBalance(context(),{requests,evaluation:evaluation(['2026-06-01']),requestId:'cancel',status:'approved',effect:{action:'cancel_grant'}}).periods[0].available_days,9);
});
test('missing retained history in the relevant year is undetermined rather than ten unused days',()=>{
 assert.throws(()=>paternityBalance(context(),{asOf:'2026-06-01',requests:[{id:'legacy',status:'approved',start_date:'2026-05-02',end_date:'2026-05-02'}]}),/retained paternity work schedule/);
 assert.equal(paternityBalance(context(),{asOf:'2026-06-01',requests:[{id:'old',status:'approved',start_date:'2025-05-02',end_date:'2025-05-02'}]}).periods[0].available_days,10);
});

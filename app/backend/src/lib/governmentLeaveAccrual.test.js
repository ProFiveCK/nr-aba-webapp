import assert from 'node:assert/strict';
import {test} from 'node:test';
import {transitionFortnightAmount} from './governmentLeaveAccrual.js';
import {fortnightAmount} from './governmentLeaveWorkflowRules.js';
import {units,decimal} from './governmentLeaveRules.js';
test('same-policy weighting preserves approved cumulative floor for every payroll phase and proration',()=>{
  let total=0n;
  for(let i=0;i<52;i++)for(let days=0;days<=14;days++) {
    const amount=transitionFortnightAmount([{annual_days:'20',credited_calendar_days:days}],i);
    assert.equal(amount,fortnightAmount('20',i,days));if(i<26&&days===14)total+=units(amount);
  }
  assert.equal(decimal(total),'20.000000');
});
test('a mid-fortnight replacement weights old/new quanta once without resetting payroll phase',()=>{
  const segments=[{annual_days:'20',credited_calendar_days:7},{annual_days:'26',credited_calendar_days:7}];
  assert.equal(transitionFortnightAmount(segments,0),'0.884615');
  assert.equal(transitionFortnightAmount(segments,1),'0.884615');
  assert.equal(transitionFortnightAmount([{annual_days:'20',credited_calendar_days:3},{annual_days:'26',credited_calendar_days:4}],0),'0.450549');
  assert.throws(()=>transitionFortnightAmount([{annual_days:'20',credited_calendar_days:8},{annual_days:'26',credited_calendar_days:7}],0),/fourteen/);
});

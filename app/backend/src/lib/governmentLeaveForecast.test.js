import {test} from 'node:test';
import assert from 'node:assert/strict';
import {forecastAccountFunding} from './governmentLeaveForecast.js';

const credits=[{date:'2026-10-28',amount:'1'},{date:'2026-11-11',amount:'1'}];
test('later projected credit cannot fund an earlier leave deadline',()=>{
  assert.equal(forecastAccountFunding({balance:'0',held:'0',reservations:[],credits,amount:'2',through:'2026-11-10'}).valid,false);
  assert.equal(forecastAccountFunding({balance:'0',held:'0',reservations:[],credits,amount:'2',through:'2026-11-11'}).valid,true);
});
test('earlier and later applications can each use their own earned-by-end credit',()=>{
  const reservations=[{request_id:'early',status:'held',amount:'1',deadline:'2026-11-02'}, {request_id:'late',status:'held',amount:'1',deadline:'2026-11-11'}];
  assert.equal(forecastAccountFunding({balance:'0',held:'2',reservations,credits,amount:'1',through:'2026-11-02',excludeReservationId:'early'}).valid,true);
  assert.equal(forecastAccountFunding({balance:'0',held:'2',reservations,credits,amount:'1',through:'2026-11-03'}).valid,false);
});
test('approval moves a reservation to a deduction without creating forecast credit',()=>{
  const reservations=[{request_id:'early',status:'consumed',amount:'1',used:'1',deadline:'2026-11-02'}];
  assert.equal(forecastAccountFunding({balance:'-1',held:'0',reservations,credits,amount:'1',through:'2026-11-11'}).valid,true);
  assert.equal(forecastAccountFunding({balance:'-1',held:'0',reservations,credits,amount:'2',through:'2026-11-11'}).valid,false);
});
test('returned leave and non-application holds remain part of available capacity',()=>{
  const reservations=[{request_id:'early',status:'consumed',amount:'1',used:'0.5',deadline:'2026-11-02'}];
  assert.equal(forecastAccountFunding({balance:'-0.5',held:'0.5',reservations,credits,amount:'1',through:'2026-11-11'}).valid,true);
  assert.equal(forecastAccountFunding({balance:'-0.5',held:'0.5',reservations,credits,amount:'1.1',through:'2026-11-11'}).valid,false);
});
test('a later approved booking does not label its projected funding as credit used by an earlier application',()=>{
 const funding=forecastAccountFunding({balance:'18',held:'0',reservations:[{request_id:'late',status:'consumed',amount:'2',used:'2',deadline:'2026-11-11'}],credits,amount:'20',through:'2026-10-31'});
 assert.equal(funding.valid,true);assert.equal(funding.posted_capacity,'20.000000');assert.equal(funding.available,'20.000000');
});

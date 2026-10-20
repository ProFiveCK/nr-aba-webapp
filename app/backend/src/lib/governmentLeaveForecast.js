import {units,decimal} from './governmentLeaveRules.js';

// Test every application's funding deadline, including later bookings. Moving
// a pending hold to an approved deduction must leave these commitments equal.
export function forecastAccountFunding({balance,held,reservations,credits,amount,through,excludeReservationId=null}) {
  const heldReservations=reservations.filter(r=>r.status==='held').reduce((n,r)=>n+units(r.amount),0n);
  const consumed=reservations.filter(r=>r.status==='consumed').reduce((n,r)=>n+units(r.used),0n);
  const base=units(balance)+consumed-(units(held)-heldReservations);
  const demands=reservations.filter(r=>r.request_id!==excludeReservationId).map(r=>({date:r.deadline,amount:units(r.status==='held'?r.amount:r.used)}));
  const deadlines=[...new Set([through,...demands.map(d=>d.date)])].sort();
  let available=null,valid=true;
  for(const date of deadlines) {
    const capacity=base+credits.filter(c=>c.date<=date).reduce((n,c)=>n+units(c.amount),0n)-demands.filter(d=>d.date<=date).reduce((n,d)=>n+d.amount,0n);
    if(capacity-(date>=through?units(amount):0n)<0n)valid=false;
    if(date>=through&&(available===null||capacity<available))available=capacity;
  }
  const postedCapacity=base-demands.filter(d=>d.date<=through).reduce((n,d)=>n+d.amount,0n);
  return {valid,available:decimal(available??0n),posted_capacity:decimal(postedCapacity)};
}

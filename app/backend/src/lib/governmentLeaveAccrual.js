import {units,decimal} from './governmentLeaveRules.js';
// One fixed payroll phase applies throughout the independently approved plan.
// Weight each day's governing quantum, then floor once after summing segments.
// A transition never resets the 26-cycle phase or creates a second posting.
export function transitionFortnightAmount(segments,index) {
  if(!Number.isInteger(index)||index<0||!Array.isArray(segments)||!segments.length)throw new Error('Invalid approved fortnight calculation.');
  const i=BigInt(index%26);let numerator=0n,credited=0;
  for(const segment of segments) {
    const days=segment.credited_calendar_days;
    if(!Number.isInteger(days)||days<0||days>14)throw new Error('Invalid credited calendar days.');
    const quantum=units(segment.annual_days);
    if(quantum<=0n)throw new Error('The annual Recreation quantum must be positive.');
    credited+=days;numerator+=(quantum*(i+1n)/26n-quantum*i/26n)*BigInt(days);
  }
  if(credited>14)throw new Error('A payroll fortnight cannot credit more than fourteen days.');
  return decimal(numerator/14n);
}

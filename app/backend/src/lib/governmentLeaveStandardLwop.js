import {dayNumber,isoDay,monthBoundary} from './governmentLeaveRules.js';

export function standardLwopPeriod(input,leapDayMethod='feb28') {
 return input.code==='lwop'&&input.end_date<=isoDay(dayNumber(monthBoundary(input.start_date,12,leapDayMethod))-1);
}
export const isStandardLwop=request=>request.code==='lwop'&&(request.application_snapshot?.standard_lwop===true||request.route_correction?.standard_lwop===true);

// Unpaid leave has a fixed rate. The assigned approver reviews the application;
// there is no separately prepared HR pay determination or fabricated HR facts.
export function standardLwopTerms(request,evaluation) {
 return {id:null,reason:request.reason,determination:{
  source_reference:`leave-application:${request.id}`,evidence_reference:`leave-application:${request.id}`,
  facts:{approval_basis:'configured_approval_route'},evaluation,benefit:null,discretion:[],
  pay_segments:[{start_date:request.start_date,end_date:request.end_date,salary_percent:'0.000000'}],
  tasks:[{kind:'return_to_duty',due_date:isoDay(dayNumber(request.end_date)+1),description:'Confirm the employee returned from leave without pay.'}],
 }};
}

// A small HR team does not need to explain routine setup: the audit log already records who changed what
// and when. A blank or very short reason on a routine change is filled in here so the record stays
// readable. Changes whose "why" matters later still need a real reason: balance corrections and
// reversals, appointment corrections, offboarding, and cancelling, rejecting or amending leave.
export const ROUTINE_REASON='Routine change; no reason given.';
const REASON_NEEDED=[
  /\/corrections$/,
  /\/movements\/[^/]+\/reverse$/,
  /^\/adjustments$/,
  /^\/directory\/service-corrections\//,
  /\/offboard$/,
  /^\/government\/workflow\/requests(\/|$)/,
  /^\/government\/workflow\/(employees\/[^/]+\/)?(cases|assisted-requests)$/,
];
export function routineReason(req,_res,next) {
  if(req.method!=='GET'&&typeof req.body?.reason==='string'&&!REASON_NEEDED.some(pattern=>pattern.test(req.path))) {
    const given=req.body.reason.trim();
    if(given.length<10)req.body.reason=given?`Routine change: ${given}`:ROUTINE_REASON;
  }
  next();
}

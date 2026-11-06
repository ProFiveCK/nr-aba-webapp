import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routineReason,ROUTINE_REASON} from './routineReason.js';
const run=(path,reason,method='POST')=>{const req={method,path,body:{reason}};routineReason(req,{},()=>{});return req.body.reason;};
test('routine changes need no reason',()=>{
  assert.equal(run('/directory/','') ,ROUTINE_REASON);
  assert.equal(run('/directory/accounts/a/employee-link','  '),ROUTINE_REASON);
  assert.equal(run('/government/calendars','typo'),'Routine change: typo');
  assert.equal(run('/access-scopes/','A full explanation was given here.'),'A full explanation was given here.');
});
test('corrections, offboarding and leave decisions keep the reason they were given',()=>{
  for(const path of ['/government/employees/e/corrections','/government/employees/e/movements/m/reverse','/directory/service-corrections/employees/e/periods/p','/onboarding/employees/e/offboard','/government/workflow/requests/r/cancel','/government/workflow/requests','/government/workflow/cases','/adjustments'])assert.equal(run(path,''),'',path);
});

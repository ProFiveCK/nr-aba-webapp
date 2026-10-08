import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,describe,test} from 'node:test';
import {connectTestDatabase,resetLeaveTables,skipWithoutDatabase,upsertLeaveType} from '../test-support/database.js';
import {withTransaction} from '../lib/transaction.js';
import {DEFAULT_RULES} from '../lib/governmentLeaveRules.js';
describe('government policy/service/calendar and certified subledger',{skip:skipWithoutDatabase},()=>{
 let pool,s,auth,central,certifier,scoped,owner,employee,policy,department,server,base;
 const reason='Synthetic HR and Salary Unit reconciliation verification.';
 before(async()=>{pool=await connectTestDatabase();s=await import('../services/governmentLeave.js');auth=await import('../services/authService.js');const express=(await import('express')).default,errors=await import('../middleware/errors.js');errors.enableAsyncErrors();const app=express();app.use(express.json());app.use('/api/hr',(await import('./hr.js')).default);app.use(errors.notFoundHandler);app.use(errors.errorHandler);server=await new Promise(resolve=>{const v=app.listen(0,'127.0.0.1',()=>resolve(v));});base=`http://127.0.0.1:${server.address().port}`;});
 after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.query("UPDATE hr_leave_types SET is_active=FALSE WHERE name='Synthetic Legacy Accrual'");await pool?.end();});
 async function account(permissions,type='staff'){return(await pool.query("INSERT INTO reviewers(email,display_name,role,password_hash,permissions,account_type) VALUES ($1,'Synthetic Actor','user','x',$2,$3) RETURNING *",[`${randomUUID()}@example.test`,permissions,type])).rows[0];}
 const user=row=>({...row,permissions:row.permissions});
 const input=(code='recreation',start='2026-11-02',end=start)=>({code,start_date:start,end_date:end,notice_date:'2026-10-01',certificate_available:true,justification_available:true});
 async function call(path,body,row=central,method=body?'POST':'GET'){const session=await auth.createSession(row.id),token=auth.buildTokenPayload(row,session.tokenId,session.expiresAt);const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};}
 const ctx=()=>s.loadContext(pool,employee.id);
 async function opening(code='recreation',amount='20'){
  const row=await s.prepareOpening(pool,{user:user(central),actor:central,employeeId:employee.id,data:{code,amount,policy_version_id:policy.id,period_start:'2026-01-01',period_end:'2026-12-31',as_of:'2026-10-01',source_reference:'Synthetic HR balance register',payroll_reference:'Synthetic Salary Unit signed opening',reason}});
  await s.certifyOpening(pool,{user:user(certifier),actor:certifier,id:row.id,reason});return(await ctx()).entitlements.find(e=>e.code===code);
 }
 const reserve=(requestId=randomUUID(),changes={})=>s.reserveEvaluation(pool,{employeeId:employee.id,input:{...input(),...changes},requestId,actor:owner,authorize:async()=>true});
 const finish=(requestId,action='consumed',extra={})=>s.finishReservation(pool,{employeeId:employee.id,requestId,action,actor:central,reason,authorize:async()=>true,...extra});
 beforeEach(async()=>{
  await resetLeaveTables(pool);await pool.query('TRUNCATE hr_gov_policy_versions,hr_gov_calendars,hr_gov_pattern_approvals CASCADE');
  central=await account({hr_admin:true,hr_access:true,hr_balance_manage:true});certifier=await account({hr_admin:true,hr_access:true});scoped=await account({hr_access:true,hr_staff_manage:true});owner=await account({hr_access:true,hr_leave_apply:true},'employee');
  department=(await pool.query("INSERT INTO hr_departments(name) VALUES ('Synthetic Foundation') RETURNING *")).rows[0];employee=(await pool.query("INSERT INTO hr_employees(display_name,department_id,department_code,reviewer_id,leave_policy_regime) VALUES ('Synthetic Government Employee',$1,'Synthetic Foundation',$2,'government') RETURNING *",[department.id,owner.id])).rows[0];
  const pattern=(await pool.query("INSERT INTO hr_work_patterns(name,working_weekdays,hours_per_day) VALUES ($1,ARRAY[1,2,3,4,5],7) RETURNING *",[`Synthetic Weekly ${randomUUID()}`])).rows[0];
  await pool.query("INSERT INTO hr_employee_service_periods(employee_id,start_date,employment_category,counts_for_service,work_pattern_id,reason) VALUES ($1,'2026-01-01','permanent',TRUE,$2,$3)",[employee.id,pattern.id,reason]);
  await s.addFoundationRecord(pool,{user:user(central),actor:central,kind:'pattern',data:{work_pattern_id:pattern.id,source_reference:'Signed one working day = one policy day',reason}});
  await s.addFoundationRecord(pool,{user:user(central),actor:central,employeeId:employee.id,kind:'basis',data:{effective_from:'2026-01-01',continuity_start:'2026-01-01',anniversary_method:'calendar',leap_day_method:'feb28',schedule_mode:'weekly',source_reference:'Signed service determination',reason}});
  policy=await s.createPolicy(pool,{user:user(central),actor:central,data:{label:'Synthetic government policy',effective_from:'2026-01-01',effective_to:'2027-12-31',rules:DEFAULT_RULES,source_reference:'Synthetic approved schedule',reason}});await s.publishPolicy(pool,{user:user(central),actor:central,id:policy.id,reason});
  await s.createCalendar(pool,{user:user(central),actor:central,data:{label:'Synthetic Calendar',effective_from:'2026-01-01',effective_to:'2027-12-31',holidays:[],source_reference:'Synthetic calendar authority',reason}});
 });
 test('published immutable versions reject overlaps and unknown typed formula keys',async()=>{
  const row=await s.createPolicy(pool,{user:user(central),actor:central,data:{label:'Overlap',effective_from:'2026-06-01',effective_to:'2027-06-01',source_reference:'Signed review',reason}});await assert.rejects(s.publishPolicy(pool,{user:user(central),actor:central,id:row.id,reason}),e=>e.status===409);
  await assert.rejects(pool.query("UPDATE hr_gov_policy_versions SET rules='{}' WHERE id=$1",[policy.id]),/immutable/);
  await assert.rejects(s.createPolicy(pool,{user:user(central),actor:central,data:{rules:{...DEFAULT_RULES,formula:'eval'},reason}}),e=>e.status===400);
 });
 test('within-period replacement needs a signed independent revision and retains immutable original policy facts',async()=>{
  const replacement=await s.createPolicy(pool,{user:user(central),actor:central,data:{label:'Signed policy replacement',effective_from:'2026-10-08',effective_to:'2027-12-31',rules:{...DEFAULT_RULES,recreation_annual_days:'26'},source_reference:'Corrected typed authority schedule',supersedes_policy_id:policy.id,authority_reference:'Signed Cabinet decision reference 2026/42',reason}});
  await assert.rejects(s.publishPolicy(pool,{user:user(central),actor:central,id:replacement.id,reason,expected_revision:1}),/different central/);
  await assert.rejects(s.publishPolicy(pool,{user:user(certifier),actor:certifier,id:replacement.id,reason,expected_revision:2}),/changed/);
  await assert.rejects(s.publishPolicy(pool,{user:user(certifier),actor:certifier,id:replacement.id,reason}),/revision/);
  await s.publishPolicy(pool,{user:user(certifier),actor:certifier,id:replacement.id,reason,expected_revision:1});
  const context=await ctx();assert.equal(context.policies.find(p=>p.id===policy.id).effective_to,'2026-10-07');assert.equal(context.policies.find(p=>p.id===policy.id).original_effective_to,'2027-12-31');
  assert.equal(context.policies.find(p=>p.id===replacement.id).effective_from,'2026-10-08');
  const original=(await pool.query("SELECT to_char(effective_to,'YYYY-MM-DD') AS effective_to FROM hr_gov_policy_versions WHERE id=$1",[policy.id])).rows[0];assert.equal(original.effective_to,'2027-12-31');
  await assert.rejects(pool.query("UPDATE hr_gov_policy_transitions SET reason='changed' WHERE successor_id=$1",[replacement.id]),/immutable/);
  const stale=await s.createPolicy(pool,{user:user(central),actor:central,data:{label:'Stale replacement',effective_from:'2026-11-01',effective_to:'2027-12-31',rules:DEFAULT_RULES,source_reference:'Signed stale policy review',supersedes_policy_id:policy.id,authority_reference:'Signed stale decision reference 2026/43',reason}});
  await assert.rejects(s.publishPolicy(pool,{user:user(certifier),actor:certifier,id:stale.id,reason,expected_revision:1}),/already been replaced/);
 });
 const draftData=()=>({label:'Government review draft',effective_from:'2028-01-01',effective_to:'2028-12-31',rules:DEFAULT_RULES,source_reference:'HR corrected policy reference',reason});
 test('central HR can edit draft dates and rules with a before/after audit; protected publication and ownership fields are ignored',async()=>{
  const created=await call('/api/hr/government/policies',draftData());assert.equal(created.status,201);assert.equal(created.body.revision,1);
  const data={...draftData(),label:'Corrected draft',effective_from:'2028-02-01',effective_to:'2029-01-31',rules:{...DEFAULT_RULES,special_annual_days:'4'},source_reference:'Corrected signed reference',reason:'Corrected dates and Special after local review.',expected_revision:1,status:'published',prepared_by:owner.id,published_by:owner.id,revision:99};
  const changed=await call(`/api/hr/government/policies/${created.body.id}`,data,central,'PUT');assert.equal(changed.status,200);assert.equal(changed.cache,'no-store');assert.equal(changed.body.id,created.body.id);assert.equal(changed.body.status,'draft');assert.equal(changed.body.revision,2);assert.equal(changed.body.label,data.label);assert.equal(changed.body.rules.special_annual_days,'4');assert.equal(changed.body.prepared_by,central.id);assert.equal(changed.body.published_by,null);
  const listed=await call('/api/hr/government/configuration');const saved=listed.body.policies.find(p=>p.id===created.body.id);assert.equal(saved.effective_from,data.effective_from);assert.equal(saved.effective_to,data.effective_to);assert.equal(saved.revision,2);assert.equal(saved.source_reference,data.source_reference);
  const {rows:[entry]}=await pool.query("SELECT before,after,actor_id FROM audit_log WHERE action='hr.gov.policy.updated' AND entity_id=$1",[created.body.id]);assert.equal(entry.before.label,created.body.label);assert.equal(entry.before.revision,1);assert.equal(entry.after.label,data.label);assert.equal(entry.after.revision,2);assert.equal(entry.actor_id,central.id);
  assert.equal((await ctx()).entitlements.length,0);assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_leave_applications')).rows[0].n,0);
 });
 test('draft editing validates complete rules, dates, reason, revision and HR authority',async()=>{
  const created=await call('/api/hr/government/policies',draftData()),path=`/api/hr/government/policies/${created.body.id}`,data={...draftData(),expected_revision:1};
  assert.equal((await call(path,data,scoped,'PUT')).status,403);assert.equal((await call(path,data,owner,'PUT')).status,403);
  assert.equal((await fetch(base+path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})).status,401);
  for(const [change,status] of [[{effective_to:'2027-01-01'},400],[{effective_from:'2028-02-30'},422],[{label:'x'},422],[{source_reference:'x'},422],[{reason:'short'},422],[{expected_revision:undefined},422],[{expected_revision:0},422],[{expected_revision:1.5},422],[{rules:undefined},422],[{rules:{...DEFAULT_RULES,formula:'eval'}},400],[{rules:{...DEFAULT_RULES,recreation_cap_days:'1'}},400]])assert.equal((await call(path,{...data,...change},central,'PUT')).status,status);
  assert.equal((await call(`/api/hr/government/policies/${randomUUID()}`,data,central,'PUT')).status,404);
  await assert.rejects(s.updatePolicy(pool,{user:user(scoped),actor:scoped,id:created.body.id,data}),e=>e.status===403);
  assert.equal((await pool.query('SELECT revision FROM hr_gov_policy_versions WHERE id=$1',[created.body.id])).rows[0].revision,1);
 });
 test('competing draft edits reject stale saves and stale publication; published versions stay immutable',async()=>{
  const created=await call('/api/hr/government/policies',draftData()),path=`/api/hr/government/policies/${created.body.id}`,data={...draftData(),expected_revision:1};
  const changes=await Promise.all(['First correction','Second correction'].map(label=>call(path,{...data,label},central,'PUT')));assert.deepEqual(changes.map(r=>r.status).sort(),[200,409]);
  const publish=`${path}/publish`;assert.equal((await call(publish,{reason,expected_revision:1})).status,409);assert.equal((await call(publish,{reason})).status,422);
  assert.equal((await call(publish,{reason,expected_revision:2})).status,200);assert.equal((await call(path,{...data,expected_revision:2},central,'PUT')).status,409);
  await assert.rejects(pool.query('UPDATE hr_gov_policy_versions SET label=$2 WHERE id=$1',[created.body.id,'Changed published policy']),/immutable/);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_log WHERE action='hr.gov.policy.updated' AND entity_id=$1",[created.body.id])).rows[0].n,1);
 });
 test('failed draft-edit audit rolls back changes and leaves the previous revision available',async()=>{
  const created=await s.createPolicy(pool,{user:user(central),actor:central,data:draftData()});
  await assert.rejects(s.updatePolicy(pool,{user:user(central),actor:{...central,id:randomUUID()},id:created.id,data:{...draftData(),label:'Must roll back',expected_revision:1}}));
  const {rows:[saved]}=await pool.query('SELECT label,revision FROM hr_gov_policy_versions WHERE id=$1',[created.id]);assert.equal(saved.label,created.label);assert.equal(saved.revision,1);
 });
 test('draft deletion is recoverable, hides active choices and blocks edit/publication until restored with an audit trail',async()=>{
  const created=await call('/api/hr/government/policies',draftData()),path=`/api/hr/government/policies/${created.body.id}`;
  const removed=await call(path,{reason,expected_revision:1},central,'DELETE');assert.equal(removed.status,200);assert.equal(removed.body.status,'draft');assert.equal(removed.body.revision,2);assert.ok(removed.body.deleted_at);assert.equal(removed.body.deleted_by,central.id);
  let config=(await call('/api/hr/government/configuration')).body;assert.ok(!config.policies.some(p=>p.id===created.body.id));assert.equal(config.deleted_policies.find(p=>p.id===created.body.id).deletion_reason,reason);
  assert.equal((await call(path,{...draftData(),expected_revision:2},central,'PUT')).status,409);assert.equal((await call(`${path}/publish`,{reason,expected_revision:2})).status,409);
  const restored=await call(`${path}/restore`,{reason:'Restore after correcting the review decision.',expected_revision:2});assert.equal(restored.status,200);assert.equal(restored.body.revision,3);assert.equal(restored.body.deleted_at,null);assert.equal(restored.body.status,'draft');assert.deepEqual(restored.body.rules,created.body.rules);assert.equal(restored.body.prepared_by,created.body.prepared_by);
  config=(await call('/api/hr/government/configuration')).body;assert.ok(config.policies.some(p=>p.id===created.body.id));assert.ok(!config.deleted_policies.some(p=>p.id===created.body.id));
  const {rows:history}=await pool.query("SELECT action,before,after,metadata FROM audit_log WHERE entity_id=$1 AND action IN ('hr.gov.policy.draft_deleted','hr.gov.policy.draft_restored') ORDER BY id",[created.body.id]);assert.equal(history.length,2);assert.equal(history[0].before.deleted_at,null);assert.ok(history[0].after.deleted_at);assert.equal(history[1].after.deleted_at,null);assert.equal(history[1].metadata.reason,'Restore after correcting the review decision.');
 });
 test('draft removal and restoration enforce HR authority, revision checks and published-policy protection',async()=>{
  const created=await call('/api/hr/government/policies',draftData()),path=`/api/hr/government/policies/${created.body.id}`,data={reason,expected_revision:1};
  for(const [url,method] of [[path,'DELETE'],[`${path}/restore`,'POST']]){assert.equal((await call(url,data,scoped,method)).status,403);assert.equal((await call(url,{reason},central,method)).status,422);assert.equal((await call(url,{...data,reason:'short'},central,method)).status,422);}
  assert.equal((await call(`/api/hr/government/policies/${policy.id}`,data,central,'DELETE')).status,409);assert.equal((await call(`/api/hr/government/policies/${policy.id}/restore`,data)).status,409);assert.equal((await call(`/api/hr/government/policies/${randomUUID()}`,data,central,'DELETE')).status,404);
  assert.equal((await call(`${path}/restore`,data)).status,409);assert.equal((await call(path,{...draftData(),label:'Updated before removal',expected_revision:1},central,'PUT')).status,200);assert.equal((await call(path,data,central,'DELETE')).status,409);
  assert.equal((await call(path,{reason,expected_revision:2},central,'DELETE')).status,200);assert.equal((await call(`${path}/restore`,{reason,expected_revision:2})).status,409);assert.equal((await call(path,{reason,expected_revision:3},central,'DELETE')).status,409);
  await assert.rejects(pool.query('UPDATE hr_gov_policy_versions SET deleted_at=NOW() WHERE id=$1',[policy.id]),/immutable/);
 });
 test('draft removal and competing edit serialize, and audit failure rolls back removal and restoration',async()=>{
  const created=await call('/api/hr/government/policies',draftData()),path=`/api/hr/government/policies/${created.body.id}`;
  const results=await Promise.all([call(path,{reason,expected_revision:1},central,'DELETE'),call(path,{...draftData(),label:'Competing edit',expected_revision:1},central,'PUT')]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const another=await s.createPolicy(pool,{user:user(central),actor:central,data:draftData()}),args={user:user(central),actor:central,id:another.id,reason,expected_revision:1,deleted:true};
  const rejectAudit = async (action) => pool.query(`CREATE FUNCTION policy_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='${action}' THEN RAISE EXCEPTION 'synthetic policy audit failure'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER policy_test_reject_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION policy_test_reject_audit()`);
  const restoreAudit = () => pool.query('DROP TRIGGER policy_test_reject_audit ON audit_log; DROP FUNCTION policy_test_reject_audit()');
  await rejectAudit('hr.gov.policy.draft_deleted');
  try { await assert.rejects(s.setPolicyDraftDeleted(pool,args), /synthetic policy audit failure/); } finally { await restoreAudit(); }
  let saved=(await pool.query('SELECT * FROM hr_gov_policy_versions WHERE id=$1',[another.id])).rows[0];assert.equal(saved.deleted_at,null);assert.equal(saved.revision,1);
  await s.setPolicyDraftDeleted(pool,args);
  await rejectAudit('hr.gov.policy.draft_restored');
  try { await assert.rejects(s.setPolicyDraftDeleted(pool,{...args,expected_revision:2,deleted:false}), /synthetic policy audit failure/); } finally { await restoreAudit(); }
  saved=(await pool.query('SELECT * FROM hr_gov_policy_versions WHERE id=$1',[another.id])).rows[0];assert.ok(saved.deleted_at);assert.equal(saved.revision,2);
 });
 test('opening preview retains legacy data; independent certification, stale checks, overlap and retries are safe',async()=>{
  const type=await upsertLeaveType(pool,{name:'Synthetic Historical Special',defaultDays:5});await pool.query('INSERT INTO hr_leave_balances(employee_id,leave_type_id,year,balance,pending) VALUES ($1,$2,2026,5,1)',[employee.id,type.id]);
  const data={code:'special',amount:'5',policy_version_id:policy.id,period_start:'2026-01-01',period_end:'2026-12-31',as_of:'2026-10-01',source_reference:'Synthetic historical reconciliation',payroll_reference:'Salary Unit sign-off',reason};
  const prepared=await s.prepareOpening(pool,{user:user(central),actor:central,employeeId:employee.id,data});assert.equal((await ctx()).entitlements.length,0);assert.equal(prepared.historical_snapshot[0].balance,'5.00');
  await assert.rejects(s.certifyOpening(pool,{user:user(central),actor:central,id:prepared.id,reason}),e=>e.status===403);await s.certifyOpening(pool,{user:user(certifier),actor:certifier,id:prepared.id,reason});await s.certifyOpening(pool,{user:user(certifier),actor:certifier,id:prepared.id,reason});assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_ledger')).rows[0].n,1);await assert.rejects(pool.query('UPDATE hr_gov_openings SET amount=100 WHERE id=$1',[prepared.id]),/immutable/);assert.equal((await pool.query('SELECT balance FROM hr_leave_balances WHERE employee_id=$1',[employee.id])).rows[0].balance,'5.00');
  const overlap=await s.prepareOpening(pool,{user:user(central),actor:central,employeeId:employee.id,data});await assert.rejects(s.certifyOpening(pool,{user:user(certifier),actor:certifier,id:overlap.id,reason}),e=>e.status===409);
  const pending=await s.prepareOpening(pool,{user:user(central),actor:central,employeeId:employee.id,data:{...data,code:'medical',amount:'10'}});await pool.query('UPDATE hr_leave_balances SET balance=4 WHERE employee_id=$1',[employee.id]);await assert.rejects(s.certifyOpening(pool,{user:user(certifier),actor:certifier,id:pending.id,reason}),e=>e.status===409);
 });
 test('precision, idempotent event keys, immutable history and explicit reversals reconcile',async()=>{
  const entitlement=await opening(),key=randomUUID(),data={entitlement_id:entitlement.id,amount:'0.000001',effective_date:'2026-10-07',event_key:key,source_reference:'Signed correction',reason};
  const movement=await s.correctLedger(pool,{user:user(central),actor:central,employeeId:employee.id,data});await s.correctLedger(pool,{user:user(central),actor:central,employeeId:employee.id,data});assert.equal((await ctx()).entitlements[0].balance,'20.000001');await assert.rejects(s.correctLedger(pool,{user:user(central),actor:central,employeeId:employee.id,data:{...data,amount:'2'}}),e=>e.status===409);
  await assert.rejects(pool.query('UPDATE hr_gov_ledger SET amount=1 WHERE id=$1',[movement.id]),/immutable/);await s.reverseMovement(pool,{user:user(central),actor:central,employeeId:employee.id,id:movement.id,data:{effective_date:'2026-10-08',source_reference:'Signed correction reversal',reason}});await s.reverseMovement(pool,{user:user(central),actor:central,employeeId:employee.id,id:movement.id,data:{effective_date:'2026-10-08',source_reference:'Signed correction reversal',reason}});assert.equal((await ctx()).entitlements[0].balance,'20.000000');
 });
 test('competing applications cannot over-reserve; identical retries reuse the hold and altered retries fail',async()=>{
  await opening('recreation','1');const responses=await Promise.allSettled([reserve(),reserve()]);assert.equal(responses.filter(r=>r.status==='fulfilled').length,1);assert.equal(responses.filter(r=>r.status==='rejected')[0].reason.status,409);
  const request=responses.find(r=>r.status==='fulfilled').value;assert.equal((await reserve(request.id)).id,request.id);assert.equal((await ctx()).entitlements[0].available,'0.000000');await assert.rejects(pool.query("UPDATE hr_gov_reservation_requests SET evaluation_snapshot='{}' WHERE id=$1",[request.id]),/immutable/);await assert.rejects(reserve(request.id,{end_date:'2026-11-03'}),e=>e.status===409);assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_reservations')).rows[0].n,1);
 });
 test('release and consume each happen once, competing completion cannot grant after release, authority callback is mandatory',async()=>{
  await opening('recreation','2');const held=await reserve();await finish(held.id,'released');await finish(held.id,'released');assert.equal((await ctx()).entitlements[0].available,'2.000000');await assert.rejects(finish(held.id),e=>e.status===409);
  const granted=await reserve();await finish(granted.id);await finish(granted.id);const account=(await ctx()).entitlements[0];assert.equal(account.balance,'1.000000');assert.equal(account.held,'0');assert.equal((await pool.query("SELECT count(*)::int AS n FROM hr_gov_ledger WHERE kind='use'")).rows[0].n,1);await assert.rejects(finish(granted.id,'consumed',{authorize:undefined}),e=>e.status===403);
 });
 test('a negative correction cannot consume held entitlement, and recreation accrual stops at cap',async()=>{
  const account=await opening('recreation','60');const held=await reserve();await assert.rejects(s.correctLedger(pool,{user:user(central),actor:central,employeeId:employee.id,data:{entitlement_id:account.id,amount:'-60',effective_date:'2026-10-07',event_key:randomUUID(),source_reference:'Signed decrease',reason}}),e=>e.status===409);
  await assert.rejects(withTransaction(pool,client=>s.postMovement(client,{entitlementId:account.id,kind:'accrual',amount:'0.000001',effectiveDate:'2026-10-07',eventKey:'Synthetic cap',sourceReference:'Synthetic fortnight',actor:central,reason})),e=>e.status===409);await finish(held.id,'released');
 });
 test('calendar and roster successors retain old versions and force refreshed final calculations',async()=>{
  await opening();const held=await reserve(),calendar=(await ctx()).calendars[0];await s.createCalendar(pool,{user:user(central),actor:central,data:{label:'Declared holiday correction',effective_from:'2026-01-01',effective_to:'2027-12-31',supersedes_id:calendar.id,holidays:[{date:'2026-11-02',name:'Declared holiday'}],source_reference:'Synthetic Gazette successor',reason}});assert.equal((await ctx()).calendars.length,1);assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_calendars')).rows[0].n,2);await assert.rejects(finish(held.id),e=>e.status===409);assert.equal((await ctx()).entitlements[0].held,'1.000000');await finish(held.id,'released');
  await s.addFoundationRecord(pool,{user:user(central),actor:central,employeeId:employee.id,kind:'roster',data:{day:'2026-11-03',paid_hours:'12',policy_days:'1.5',source_reference:'Signed twelve-hour conversion',reason}});const old=(await ctx()).rosters[0];await s.addFoundationRecord(pool,{user:user(central),actor:central,employeeId:employee.id,kind:'roster',data:{day:old.day,paid_hours:'0',policy_days:'0',supersedes_id:old.id,source_reference:'Signed off-duty correction',reason}});assert.equal((await ctx()).rosters[0].policy_days,'0.000000');
 });
 test('server preview and pages are scoped; caller cannot supply notice date or charges; no public grant route exists',async()=>{
  await opening();const response=await call(`/api/hr/government/employees/${employee.id}/evaluate`,{...input(),charge:'0',notice_date:'1900-01-01'},owner);assert.equal(response.status,200);assert.equal(response.body.charge,'1.000000');assert.equal(response.body.submission_enabled,false);assert.equal(response.cache,'no-store');assert.notEqual(response.body.input.notice_date,'1900-01-01');
  for(const path of [`/api/hr/government/employees/${employee.id}`,`/api/hr/government/employees/${employee.id}/ledger`])assert.equal((await call(path,undefined,scoped)).status,404);
  await pool.query("INSERT INTO hr_access_scopes(reviewer_id,department_id,capabilities,effective_from,granted_by,reason) VALUES ($1,$2,ARRAY['hr_staff_manage'],'2026-01-01',$3,$4)",[scoped.id,department.id,central.id,reason]);
  assert.equal((await call(`/api/hr/government/employees/${employee.id}`,undefined,scoped)).status,200);
  assert.equal((await call(`/api/hr/government/employees/${employee.id}/ledger`,undefined,scoped)).status,404);
  assert.equal((await call(`/api/hr/government/employees/${employee.id}/evaluate`,{...input(),end_date:'2028-01-01'})).status,400);
  assert.equal((await call('/api/hr/government/configuration',undefined,scoped)).status,403);assert.equal((await call(`/api/hr/government/employees/${employee.id}/consume`,{request_id:randomUUID()})).status,404);assert.equal((await call(`/api/hr/government/employees/${employee.id}/ledger`)).body.movements.length,1);
  assert.equal((await call(`/api/hr/government/employees/${employee.id}/corrections`,{entitlement_id:randomUUID(),amount:'1',effective_date:'2026-10-07',event_key:randomUUID(),source_reference:'Valid reference',reason},scoped)).status,403);
 });
 test('service exclusions are explicit, withdrawn by append-only record, and a successor basis is needed after a break',async()=>{
  const excluded=await s.addFoundationRecord(pool,{user:user(central),actor:central,employeeId:employee.id,kind:'exclusion',data:{start_date:'2026-02-01',end_date:'2026-02-28',kind:'lwop',source_reference:'Signed approved LWOP',reason}});assert.equal((await ctx()).exclusions.length,1);await s.addFoundationRecord(pool,{user:user(central),actor:central,employeeId:employee.id,kind:'withdraw-exclusion',data:{exclusion_id:excluded.id,source_reference:'Verified incorrect source correction',reason}});assert.equal((await ctx()).exclusions.length,0);assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_service_exclusions')).rows[0].n,1);await s.addFoundationRecord(pool,{user:user(central),actor:central,employeeId:employee.id,kind:'exclusion',data:{start_date:'2026-02-01',end_date:'2026-02-28',kind:'lwop',source_reference:'Corrected verified LWOP source',reason}});assert.equal((await ctx()).exclusions.length,1);
 });
 test('audit failure rolls back certification and reservation completion together',async()=>{
  const pending=await s.prepareOpening(pool,{user:user(central),actor:central,employeeId:employee.id,data:{code:'medical',amount:'10',policy_version_id:policy.id,period_start:'2026-01-01',period_end:'2026-12-31',as_of:'2026-10-01',source_reference:'HR source',payroll_reference:'Salary Unit source',reason}});
  await assert.rejects(s.certifyOpening(pool,{user:user(certifier),actor:{...certifier,id:randomUUID()},id:pending.id,reason}));assert.equal((await ctx()).entitlements.length,0);
  await opening();const held=await reserve();await assert.rejects(finish(held.id,'consumed',{actor:{id:randomUUID()}}));assert.equal((await ctx()).entitlements[0].held,'1.000000');assert.equal((await ctx()).entitlements[0].balance,'20.000000');
 });
 test('legacy accrual cannot write into government historical balances',async()=>{
  const type=await upsertLeaveType(pool,{name:'Synthetic Legacy Accrual',accruable:true,perFortnight:1});await pool.query('INSERT INTO hr_leave_balances(employee_id,leave_type_id,year,balance,pending) VALUES ($1,$2,2026,12,0)',[employee.id,type.id]);const {runLeaveAccrual}=await import('../services/leaveAccrual.js');await withTransaction(pool,client=>runLeaveAccrual(client,{periodEnd:'2026-10-07',actorId:central.id}));assert.equal((await pool.query('SELECT balance FROM hr_leave_balances WHERE employee_id=$1',[employee.id])).rows[0].balance,'12.00');
 });
});

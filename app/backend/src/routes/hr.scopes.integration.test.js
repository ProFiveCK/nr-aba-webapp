import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,describe,test} from 'node:test';
import {connectTestDatabase,createEmployee,resetLeaveTables,skipWithoutDatabase,upsertLeaveType} from '../test-support/database.js';

describe('HR scope isolation through actual HTTP routes',{skip:skipWithoutDatabase},()=>{
  let pool,auth,access,central,staff,approver,owner,other,department,division,sibling,foreign,employee,peer,outsider,type,approved,pending,attachment,server,base;
  const reason='Synthetic HR access verified from appointment and identity records.';
  before(async()=>{
    pool=await connectTestDatabase();auth=await import('../services/authService.js');access=await import('../services/hrAccess.js');
    const express=(await import('express')).default,errors=await import('../middleware/errors.js');errors.enableAsyncErrors();
    const {default:router}=await import('./hr.js');const app=express();app.use(express.json());app.use('/api/hr',router);app.use(errors.errorHandler);
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base=`http://127.0.0.1:${server.address().port}/api/hr`;
  });
  after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await pool?.end();});
  const account=async(name,permissions={})=>(await pool.query(`INSERT INTO reviewers(email,display_name,role,password_hash,permissions) VALUES ($1,$2,'user','x',$3) RETURNING *`,[`scope-${randomUUID()}@example.test`,name,permissions])).rows[0];
  async function token(row){const session=await auth.createSession(row.id);return auth.buildTokenPayload(row,session.tokenId,session.expiresAt);}
  async function call(row,path,body,method=body?'POST':'GET',bearer){const res=await fetch(`${base}${path}`,{method,headers:{Authorization:`Bearer ${bearer||await token(row)}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:res.status,body:(res.headers.get('content-type')||'').includes('json')?await res.json():await res.text(),cache:res.headers.get('cache-control')};}
  const grant=(row,caps,div=division.id,dept=department.id,extra={})=>access.grantHrScope(pool,{user:{id:central.id,permissions:{hr_admin:true}},actor:central,data:{reviewer_id:row.id,department_id:dept,division_id:div,capabilities:caps,effective_from:'2020-01-01',reason,...extra}});
  async function application(person,status='approved'){return(await pool.query(`INSERT INTO hr_leave_applications(employee_id,leave_type_id,start_date,end_date,days,reason,status,reviewed_by,reviewed_at) VALUES ($1,$2,'2026-10-08','2026-10-09',2,'Synthetic scoped leave',$3,$4,NOW()) RETURNING *`,[person.id,type.id,status,approver.id])).rows[0];}
  beforeEach(async()=>{
    await resetLeaveTables(pool);central=await account('Central HR',{hr_admin:true,hr_access:true});staff=await account('Scoped HR');approver=await account('Scoped approver');owner=await account('Applicant',{hr_access:true,hr_leave_apply:true});other=await account('Outside applicant',{hr_access:true,hr_leave_apply:true});
    department=(await pool.query("INSERT INTO hr_departments(name) VALUES ('Scope Finance') RETURNING *")).rows[0];foreign=(await pool.query("INSERT INTO hr_departments(name) VALUES ('Scope Health') RETURNING *")).rows[0];
    division=(await pool.query("INSERT INTO hr_divisions(department_id,name) VALUES ($1,'Treasury') RETURNING *",[department.id])).rows[0];sibling=(await pool.query("INSERT INTO hr_divisions(department_id,name) VALUES ($1,'Budget') RETURNING *",[department.id])).rows[0];
    employee=await createEmployee(pool,{name:'Treasury Person'});peer=await createEmployee(pool,{name:'Sibling Person'});outsider=await createEmployee(pool,{name:'Outside Person'});await createEmployee(pool,{name:'Unverified placement',department:department.name});
    await pool.query('UPDATE hr_employees SET department_id=$2,division_id=$3,department_code=$4,division_code=$5,reviewer_id=$6 WHERE id=$1',[employee.id,department.id,division.id,department.name,division.name,owner.id]);
    await pool.query('UPDATE hr_employees SET department_id=$2,division_id=$3,department_code=$4 WHERE id=$1',[peer.id,department.id,sibling.id,department.name]);
    await pool.query('UPDATE hr_employees SET department_id=$2,department_code=$3,reviewer_id=$4 WHERE id=$1',[outsider.id,foreign.id,foreign.name,other.id]);
    type=await upsertLeaveType(pool,{name:'T:Scope Leave',defaultDays:10});approved=await application(employee);pending=await application(employee,'pending');await application(peer);await application(outsider);
    attachment=(await pool.query(`INSERT INTO hr_leave_attachments(application_id,file_name,content_type,file_data,byte_size,uploaded_by,checksum) VALUES ($1,'synthetic-evidence.pdf','application/pdf',$2,5,$3,'synthetic-checksum') RETURNING *`,[approved.id,Buffer.from('%PDF-'),owner.id])).rows[0];
    await pool.query('INSERT INTO hr_leave_balances(employee_id,leave_type_id,year,balance) VALUES ($1,$2,2026,10)',[employee.id,type.id]);
  });
  test('legacy staff capability alone no longer gives global records or exports',async()=>{
    const legacy=await account('Unscoped HR',{hr_access:true,hr_staff_manage:true});assert.deepEqual((await call(legacy,'/employees')).body,[]);assert.equal((await call(legacy,'/directory')).body.total,0);
    assert.equal((await call(legacy,`/directory/${employee.id}/profile`)).status,404);assert.equal((await call(legacy,`/employees/${employee.id}`,{position_title:'Unauthorized'},'PUT')).status,404);
    assert.equal((await call(legacy,'/report?from=2026-10-01&to=2026-10-31')).status,403);assert.equal((await call(legacy,'/adjustments',{employee_id:employee.id,leave_type_id:type.id,amount:1,reason})).status,403);
  });
  test('division scope filters both directories, references and calendar including guessed IDs',async()=>{
    await grant(staff,['hr_staff_manage']);await pool.query('UPDATE hr_employees SET manager_id=$2 WHERE id=$1',[employee.id,outsider.id]);
    const list=await call(staff,'/directory');assert.equal(list.status,200);assert.equal(list.body.total,1);assert.equal(list.body.employees[0].id,employee.id);assert.equal(list.cache,'no-store');
    const old=await call(staff,'/employees');assert.equal(old.body.length,1);assert.equal(old.body[0].manager_name,null);
    assert.equal((await call(staff,`/directory?department_id=${foreign.id}`)).body.total,0);assert.equal((await call(staff,'/directory?search=Outside Person')).body.total,0);
    for(const person of [peer,outsider])assert.equal((await call(staff,`/directory/${person.id}/profile`)).status,404);
    const profile=await call(staff,`/directory/${employee.id}/profile`);assert.equal(profile.body.employee.manager_id,outsider.id);assert.match(profile.body.employee.manager_name,/Outside your assigned scope/);assert.equal(profile.body.employee.daily_rate,undefined);
    const org=await call(staff,'/org-units');assert.equal(org.body.length,1);assert.deepEqual(org.body[0].divisions.map(v=>v.id),[division.id]);
    assert.deepEqual((await call(staff,'/calendar?from=2026-10-01&to=2026-10-31')).body.map(a=>a.employee_name),['Treasury Person']);
  });
  test('whole-department scope includes siblings, excludes unverified placement and other departments',async()=>{
    await grant(staff,['hr_staff_manage'],null);assert.equal((await call(staff,'/directory')).body.total,2);assert.equal((await call(staff,'/org-units')).body[0].divisions.length,2);
  });
  test('scoped edits cannot transfer, link identities, set status or change central configuration',async()=>{
    await grant(staff,['hr_staff_manage']);const details={display_name:'Verified Treasury Person',position_title:'Officer',status:'active',manager_id:null,email:null,reason};
    assert.equal((await call(staff,`/directory/${employee.id}/details`,details,'PUT')).status,200);
    assert.equal((await call(staff,`/directory/${outsider.id}/details`,details,'PUT')).status,404);assert.equal((await call(staff,`/directory/${employee.id}/details`,{...details,manager_id:outsider.id},'PUT')).status,404);
    assert.equal((await call(staff,`/directory/${employee.id}/details`,{...details,status:'inactive'},'PUT')).status,403);assert.equal((await call(staff,`/employees/${employee.id}`,{department_code:foreign.name},'PUT')).status,403);
    const blocked=[['/directory/accounts'],['/directory/imports'],['/directory/imports/preview',{csv:'x',export_date:'2026-10-07'}],['/employees/import',{rows:[{display_name:'x'}]}],['/employees',{display_name:'x'}],[`/employees/${employee.id}`,{},'DELETE'],[`/directory/${employee.id}/account-link`,{reviewer_id:staff.id,reason},'PUT'],[`/directory/${employee.id}/organisation`,{department_id:foreign.id,reason},'PUT'],[`/directory/${employee.id}/service-periods`,{start_date:'2026-01-01',employment_category:'permanent',reason}],['/directory/approval-assignments',{level:'chief_secretary',approver_employee_id:employee.id,effective_from:'2026-10-07',reason}],['/overview'],['/policies'],['/access-scopes']];
    for(const[path,body,method]of blocked)assert.equal((await call(staff,path,body,method)).status,403,path);
  });
  test('direct historical reporting-line edits cannot create a manager cycle',async()=>{
    await grant(staff,['hr_staff_manage'],null);
    assert.equal((await call(staff,`/employees/${employee.id}`,{manager_id:peer.id},'PUT')).status,200);
    const result=await call(staff,`/employees/${peer.id}`,{manager_id:employee.id},'PUT');
    assert.equal(result.status,400);assert.match(result.body.message,/manager cycle/);
    assert.equal((await pool.query('SELECT manager_id FROM hr_employees WHERE id=$1',[peer.id])).rows[0].manager_id,null);
  });
  test('balances, reports, personnel PDFs and evidence have separate scoped rights',async()=>{
    await grant(staff,['hr_staff_manage']);assert.equal((await call(staff,`/employees/${employee.id}/balances`)).status,403);assert.equal((await call(staff,`/leaves/${approved.id}/payroll-form`)).status,404);assert.equal((await call(staff,`/leaves/${approved.id}/attachments/${attachment.id}`)).status,404);
    await grant(staff,['hr_balance_manage','hr_report_read']);assert.equal((await call(staff,'/employees/balances?year=2026')).body.employees.length,1);assert.equal((await call(staff,`/employees/${outsider.id}/balances`)).status,404);
    assert.deepEqual((await call(staff,'/report?from=2026-10-01&to=2026-10-31')).body.rows.map(r=>r.employee_name),['Treasury Person']);assert.equal((await call(staff,`/leaves/${approved.id}/application.pdf`)).status,200);
    const foreignApp=(await pool.query('SELECT id FROM hr_leave_applications WHERE employee_id=$1',[outsider.id])).rows[0];assert.equal((await call(staff,`/leaves/${foreignApp.id}/payroll-form`)).status,404);
    assert.equal((await call(staff,'/adjustments',{employee_id:employee.id,leave_type_id:type.id,amount:1,reason,year:2026})).status,201);assert.equal((await call(staff,'/adjustments',{employee_id:outsider.id,leave_type_id:type.id,amount:1,reason,year:2026})).status,404);
    assert.equal((await call(staff,`/leaves/${approved.id}/attachments/${attachment.id}`)).status,404);await grant(staff,['hr_evidence_read']);assert.equal((await call(staff,`/leaves/${approved.id}/attachments/${attachment.id}`)).status,200);
  });
  test('revocation invalidates a live session and future/expired grants confer no access',async()=>{
    const scope=await grant(staff,['hr_staff_manage']),bearer=await token(staff);assert.equal((await call(staff,'/directory',undefined,'GET',bearer)).body.total,1);
    assert.equal((await call(central,`/access-scopes/${scope.id}/revoke`,{reason})).status,200);assert.equal((await call(staff,'/directory',undefined,'GET',bearer)).status,401);
    await grant(staff,['hr_staff_manage'],division.id,department.id,{effective_from:'2099-01-01'});assert.equal((await call(staff,'/directory')).status,403);await grant(staff,['hr_staff_manage'],division.id,department.id,{effective_to:'2020-12-31'});assert.equal((await call(staff,'/directory')).status,403);
  });
  test('transfer immediately removes old access even for the original approver',async()=>{
    await grant(approver,['hr_leave_approve','hr_evidence_read']);const bearer=await token(approver);assert.equal((await call(approver,'/approvals',undefined,'GET',bearer)).body.length,1);assert.equal((await call(approver,`/leaves/${approved.id}/payroll-form`)).status,200);
    await pool.query('UPDATE hr_employees SET department_id=$2,division_id=NULL WHERE id=$1',[employee.id,foreign.id]);assert.equal((await call(approver,'/approvals',undefined,'GET',bearer)).body.length,0);
    assert.equal((await call(approver,`/leaves/${approved.id}/payroll-form`)).status,404);assert.equal((await call(approver,`/leaves/${approved.id}/attachments/${attachment.id}`)).status,404);assert.equal((await call(approver,`/leaves/${pending.id}/decision`,{decision:'approved'})).status,404);
  });
  test('owners retain their documents; foreign manager links cannot bypass placement',async()=>{
    assert.equal((await call(owner,`/leaves/${approved.id}/payroll-form`)).status,200);assert.equal((await call(owner,`/leaves/${approved.id}/attachments/${attachment.id}`)).status,200);assert.equal((await call(other,`/leaves/${approved.id}/application.pdf`)).status,404);
    const manager=await createEmployee(pool,{name:'Foreign manager'});await pool.query('UPDATE hr_employees SET reviewer_id=$2,department_id=$3 WHERE id=$1',[manager.id,approver.id,foreign.id]);await pool.query('UPDATE reviewers SET permissions=$2 WHERE id=$1',[approver.id,{hr_access:true,hr_leave_approve:true}]);await pool.query('UPDATE hr_employees SET manager_id=$2 WHERE id=$1',[employee.id,manager.id]);
    assert.equal((await call(approver,'/team')).body.length,0);assert.equal((await call(approver,`/leaves/${approved.id}/attachments/${attachment.id}`)).status,404);
    await pool.query('UPDATE hr_employees SET department_id=$2,division_id=$3 WHERE id=$1',[manager.id,department.id,division.id]);assert.equal((await call(approver,'/team')).body.length,1);
  });
  test('scope assignment validates boundaries and denies central escalation, retains explicit overrides and audit',async()=>{
    const data={reviewer_id:staff.id,department_id:department.id,capabilities:['hr_staff_manage'],effective_from:'2020-01-01',reason};assert.equal((await call(staff,'/access-scopes',data)).status,403);assert.equal((await call(central,'/access-scopes',{...data,department_id:foreign.id,division_id:division.id})).status,400);assert.equal((await call(central,'/access-scopes',{...data,capabilities:['hr_admin']})).status,422);
    const scope=await grant(staff,['hr_staff_manage']);await pool.query('UPDATE reviewers SET permissions=$2 WHERE id=$1',[staff.id,{hr_staff_manage:false}]);assert.equal((await call(staff,'/directory')).status,403);
    await assert.rejects(access.grantHrScope(pool,{user:{permissions:{hr_admin:true}},actor:{id:randomUUID()},data}),{code:'23503'});assert.equal((await call(central,'/access-scopes')).body.total,1);assert.equal((await pool.query("SELECT count(*)::int n FROM audit_log WHERE entity_id=$1 AND action='hr.access_scope.granted'",[scope.id])).rows[0].n,1);
  });
  test('a queued balance write rechecks placement after a concurrent transfer',async()=>{
    await grant(staff,['hr_balance_manage']);const bearer=await token(staff),lock=await pool.connect();
    let request;
    try {
      await lock.query('BEGIN');await lock.query('SELECT id FROM hr_employees WHERE id=$1 FOR UPDATE',[employee.id]);
      request=call(staff,'/adjustments',{employee_id:employee.id,leave_type_id:type.id,amount:3,reason,year:2026},'POST',bearer);
      let waiting=false;
      for(let i=0;i<50;i++){
        const {rows:[state]}=await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM hr_employees WHERE id=%') AS waiting");
        if(state.waiting){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(waiting,true,'the API reached the placement lock');
      await lock.query('UPDATE hr_employees SET department_id=$2,division_id=NULL WHERE id=$1',[employee.id,foreign.id]);await lock.query('COMMIT');
      assert.equal((await request).status,404);
      assert.equal(Number((await pool.query('SELECT balance FROM hr_leave_balances WHERE employee_id=$1',[employee.id])).rows[0].balance),10);
    } finally {await lock.query('ROLLBACK');lock.release();if(request)await request;}
  });
  test('an audit insert failure rolls back a grant and its session revocation',async()=>{
    const bearer=await token(staff);
    await pool.query(`CREATE OR REPLACE FUNCTION reject_scope_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='hr.access_scope.granted' THEN RAISE EXCEPTION 'Synthetic audit unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_scope_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_scope_audit()`);
    try {
      await assert.rejects(grant(staff,['hr_staff_manage']),/Synthetic audit unavailable/);
      assert.equal((await pool.query('SELECT count(*)::int n FROM hr_access_scopes')).rows[0].n,0);
      const response=await call(staff,'/directory',undefined,'GET',bearer);assert.equal(response.status,403,'session remains valid, scope was not committed');
    } finally {await pool.query('DROP TRIGGER reject_scope_audit ON audit_log; DROP FUNCTION reject_scope_audit()');}
  });
  test('approval queues withhold evidence metadata, self decisions remain blocked and notifications require current authority',async()=>{
    await grant(approver,['hr_leave_approve']);const queue=await call(approver,'/approvals?status=approved');assert.deepEqual(queue.body[0].attachments,[]);
    await grant(approver,['hr_evidence_read']);assert.equal((await call(approver,'/approvals?status=approved')).body[0].attachments.length,1);
    await grant(owner,['hr_leave_approve']);assert.equal((await call(owner,`/leaves/${pending.id}/decision`,{decision:'approved'})).status,403);
    const manager=await createEmployee(pool,{name:'Foreign notification manager'});await pool.query('UPDATE hr_employees SET reviewer_id=$2,department_id=$3 WHERE id=$1',[manager.id,approver.id,foreign.id]);await pool.query('UPDATE hr_employees SET manager_id=$2 WHERE id=$1',[employee.id,manager.id]);
    await pool.query('UPDATE hr_access_scopes SET revoked_at=NOW() WHERE reviewer_id=$1',[approver.id]);
    const {leaveApprovers}=await import('../services/leaveService.js');const targets=await leaveApprovers(pool,employee);
    assert.ok(!targets.some(row=>row.email===approver.email),'a foreign manager must not receive the leave notification');assert.ok(targets.some(row=>row.email===central.email));
  });

});

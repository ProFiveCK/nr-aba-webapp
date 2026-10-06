import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {after,before,beforeEach,describe,test} from 'node:test';
import {connectTestDatabase,resetLeaveTables,skipWithoutDatabase} from '../test-support/database.js';

describe('verified employee onboarding and lifecycle over real HTTP',{skip:skipWithoutDatabase},()=>{
  let pool,service,auth,central,hr,scoped,employee,department,server,base,alias;
  const reason='Synthetic verified identity and individual handover authority.';
  before(async()=>{
    pool=await connectTestDatabase();service=await import('../services/employeeOnboarding.js');auth=await import('../services/authService.js');
    const express=(await import('express')).default,errors=await import('../middleware/errors.js');errors.enableAsyncErrors();
    const app=express();app.use(express.json());app.use('/api/hr',(await import('./hr.js')).default);app.use('/api/auth',(await import('./auth.js')).default);app.get('/api/finance-check',auth.requireAuth(),(_req,res)=>res.json({ok:true}));app.use(errors.errorHandler);
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base=`http://127.0.0.1:${server.address().port}`;
  });
  after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await pool?.end();});
  async function account(name,permissions={},extra={}) {return (await pool.query(`INSERT INTO reviewers(email,display_name,role,password_hash,permissions,account_type)
    VALUES ($1,$2,'user','x',$3,$4) RETURNING *`,[`${randomUUID()}@example.test`,name,permissions,extra.type||'staff'])).rows[0];}
  async function session(row){const s=await auth.createSession(row.id);return auth.buildTokenPayload(row,s.tokenId,s.expiresAt);}
  async function call(path,body,actor=central,method=body?'POST':'GET',token){const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(actor?{Authorization:`Bearer ${token||await session(actor)}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:res.status,body:res.status===204?null:await res.json(),cache:res.headers.get('cache-control')};}
  async function person(name='Synthetic Employee',id=`000-${randomUUID()}`,email=null){const row=(await pool.query(`INSERT INTO hr_employees(display_name,department_id,department_code,email) VALUES ($1,$2,'Lifecycle',$3) RETURNING *`,[name,department.id,email])).rows[0];if(id)await pool.query(`INSERT INTO hr_employee_external_ids(employee_id,source,external_id,verified_by,reason) VALUES ($1,'techone_payroll',$2,$3,$4)`,[row.id,id,central.id,reason]);return row;}
  async function prepare(mode='payroll',ids=[employee.id]){return service.previewOnboarding(pool,{employeeIds:ids,loginMode:mode,actor:central,reason});}
  const apply=batch=>service.applyOnboarding(pool,{batchId:batch.id,actor:central,reason});
  async function provision(){const batch=await prepare();await apply(batch);return(await pool.query('SELECT r.* FROM reviewers r JOIN hr_employees e ON e.reviewer_id=r.id WHERE e.id=$1',[employee.id])).rows[0];}
  async function issue(purpose='activation'){return service.issueEmployeeLink(pool,{employeeId:employee.id,purpose,handover:'in_person',actor:central,reason});}
  const raw=link=>link.activation_url.split('#activate-leave=')[1];
  beforeEach(async()=>{
    await resetLeaveTables(pool);central=await account('Central provisioner',{hr_admin:true,admin:true,hr_access:true});hr=await account('Central HR only',{hr_admin:true,hr_access:true});scoped=await account('Departmental staff',{hr_staff_manage:true,hr_access:true});
    department=(await pool.query("INSERT INTO hr_departments(name) VALUES ('Lifecycle') RETURNING *")).rows[0];alias=`000001-Ab-${randomUUID()}`;employee=await person('Synthetic Employee',alias);
  });
  test('disabled Payroll-alias accounts retain exact IDs, minimal grants and idempotent apply',async()=>{
    const batch=await prepare(),result=await apply(batch),again=await apply(batch);assert.equal(result.created,1);assert.equal(again.status,'applied');
    const row=(await pool.query('SELECT r.* FROM reviewers r JOIN hr_employees e ON e.reviewer_id=r.id WHERE e.id=$1',[employee.id])).rows[0];assert.equal(row.email,null);assert.equal(row.login_alias,alias);assert.equal(row.status,'inactive');assert.equal(row.onboarding_state,'pending');assert.equal(row.account_type,'employee');assert.match(row.password_hash,/^!activation-required:/);
    assert.deepEqual((await auth.loadCapabilities(row.id)).sort(),['hr_access','hr_leave_apply']);assert.equal((await call('/api/auth/login',{login_alias:alias,password:alias},null)).status,401);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_employee_account_links WHERE employee_id=$1',[employee.id])).rows[0].n,1);
  });
  test('2,000-person cohorts stage, apply and paginate without passwords or token payloads',async()=>{
    await pool.query(`INSERT INTO hr_employees(display_name,department_id,department_code) SELECT 'Synthetic Scale '||lpad(n::text,4,'0'),$1,'Lifecycle' FROM generate_series(1,1999) n`,[department.id]);
    await pool.query(`INSERT INTO hr_employee_external_ids(employee_id,source,external_id,verified_by,reason)
      SELECT id,'techone_payroll','SCALE-'||id::text,$1,$2 FROM hr_employees WHERE id<>$3`,[central.id,reason,employee.id]);
    const batch=await service.previewOnboarding(pool,{departmentId:department.id,loginMode:'payroll',actor:central,reason});
    const first=await call(`/api/hr/onboarding/batches/${batch.id}`),second=await call(`/api/hr/onboarding/batches/${batch.id}?page=2`);assert.equal(first.body.total,2000);assert.equal(first.body.rows.length,50);assert.equal(second.body.rows.length,50);assert.equal(first.cache,'no-store');assert.equal(new Set([...first.body.rows,...second.body.rows].map(row=>row.id)).size,100);
    assert.ok(!JSON.stringify(first.body).includes('password_hash'));assert.ok(!JSON.stringify(first.body).includes('token_hash'));
    const applied=await call(`/api/hr/onboarding/batches/${batch.id}/apply`,{reason,confirmed:true});assert.equal(applied.status,200);assert.equal(applied.body.created,2000);const accounts=await call('/api/hr/onboarding/accounts?page=2');assert.equal(accounts.body.total,2000);assert.equal(accounts.body.accounts.length,50);assert.ok(accounts.body.accounts.every(row=>row.onboarding_state==='pending'));
  });
  test('email cohorts block missing identities/shared contacts and do not auto-link matching accounts',async()=>{
    const missing=await prepare('email');assert.equal((await call(`/api/hr/onboarding/batches/${missing.id}/apply`,{reason,confirmed:true})).status,409);
    const email=`shared-${randomUUID()}@example.test`;await pool.query('UPDATE hr_employees SET email=$2 WHERE id=$1',[employee.id,email]);const peer=await person('Synthetic Shared Contact','000002-Ab',email);const shared=await prepare('email',[employee.id,peer.id]);assert.equal((await call(`/api/hr/onboarding/batches/${shared.id}`)).body.counts[0].decision,'blocked');
    const existing=await account('Verified Existing',{hr_access:true,hr_leave_apply:true});await pool.query('UPDATE hr_employees SET email=$2 WHERE id=$1',[employee.id,existing.email]);const batch=await prepare('email'),row=(await call(`/api/hr/onboarding/batches/${batch.id}`)).body.rows[0];assert.equal(row.decision,'blocked');assert.equal((await pool.query('SELECT reviewer_id FROM hr_employees WHERE id=$1',[employee.id])).rows[0].reviewer_id,null);
    assert.equal((await call(`/api/hr/onboarding/batches/${batch.id}/rows/${row.id}`,{decision:'link',reviewer_id:existing.id,reason})).status,200);await apply(batch);assert.equal((await pool.query('SELECT reviewer_id FROM hr_employees WHERE id=$1',[employee.id])).rows[0].reviewer_id,existing.id);assert.deepEqual((await auth.loadCapabilities(existing.id)).sort(),['hr_access','hr_leave_apply']);
    assert.equal((await call('/api/hr/leaves',{leave_type_id:randomUUID(),start_date:'2026-10-08',end_date:'2026-10-09',reason},existing)).status,409);
  });
  test('changed employee facts reject a stale batch atomically',async()=>{
    const peer=await person(),batch=await prepare('payroll',[employee.id,peer.id]);await pool.query('UPDATE hr_employees SET display_name=$2 WHERE id=$1',[peer.id,'Changed since review']);await assert.rejects(apply(batch),error=>error.status===409);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_employees WHERE reviewer_id IS NOT NULL')).rows[0].n,0);assert.equal((await pool.query('SELECT status FROM hr_onboarding_batches WHERE id=$1',[batch.id])).rows[0].status,'preview');
  });
  test('central preparation does not give provisioning rights; departmental users cannot manage lifecycle',async()=>{
    const batch=await prepare();assert.equal((await call(`/api/hr/onboarding/batches/${batch.id}/apply`,{reason,confirmed:true},hr)).status,403);assert.equal((await call('/api/hr/onboarding/preview',{reason,login_mode:'payroll'},scoped)).status,403);
    assert.equal((await call(`/api/hr/onboarding/employees/${employee.id}/link`,{reason,purpose:'activation',handover:'in_person'},hr)).status,403);assert.equal((await call(`/api/hr/onboarding/employees/${employee.id}/offboard`,{reason},scoped)).status,403);
  });
  test('activation links are hashed, single-use and absent from audit/list responses',async()=>{
    const row=await provision(),link=await issue(),token=raw(link),stored=(await pool.query('SELECT * FROM hr_account_tokens WHERE reviewer_id=$1',[row.id])).rows[0];assert.equal(stored.token_hash,createHash('sha256').update(token).digest('hex'));assert.notEqual(stored.token_hash,token);
    const audit=(await pool.query("SELECT after FROM audit_log WHERE action='hr.employee.activation_link.issued' AND entity_id=$1",[employee.id])).rows;assert.ok(!JSON.stringify(audit).includes(token));assert.ok(!JSON.stringify((await call('/api/hr/onboarding/accounts')).body).includes(token));
    const results=await Promise.all([call('/api/auth/activate-leave',{token,new_password:'Synthetic unique password 1'},null),call('/api/auth/activate-leave',{token,new_password:'Synthetic unique password 2'},null)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal((await call('/api/auth/activate-leave',{token,new_password:'Synthetic later password'},null)).status,400);
    assert.equal((await pool.query('SELECT status,onboarding_state FROM reviewers WHERE id=$1',[row.id])).rows[0].onboarding_state,'ready');
  });
  test('reissue, expiry and Payroll identity changes invalidate links',async()=>{
    await provision();const first=await issue(),second=await issue();await assert.rejects(service.activateEmployee(pool,{token:raw(first),password:'Synthetic secure password'}),error=>error.status===400);
    await pool.query('UPDATE hr_account_tokens SET expires_at=NOW()-INTERVAL \'1 second\' WHERE id=$1',[second.id]);await assert.rejects(service.activateEmployee(pool,{token:raw(second),password:'Synthetic secure password'}),error=>error.status===400);
    const third=await issue();await pool.query("UPDATE hr_employee_external_ids SET external_id='Changed-Payroll-ID' WHERE employee_id=$1",[employee.id]);await assert.rejects(service.activateEmployee(pool,{token:raw(third),password:'Synthetic secure password'}),error=>error.status===400);
  });
  test('exact alias login works without email and employee-only sessions cannot use finance or submit government leave',async()=>{
    const row=await provision(),link=await issue();await service.activateEmployee(pool,{token:raw(link),password:'Synthetic verified password'});
    const login=await call('/api/auth/login',{login_alias:alias,password:'Synthetic verified password'},null);assert.equal(login.status,200);assert.equal(login.body.reviewer.account_type,'employee');assert.equal(login.body.reviewer.email,'');assert.equal(login.body.reviewer.permissions.submit_aba,undefined);
    const picker=await call(`/api/hr/directory/accounts?search=${encodeURIComponent(alias)}`);assert.equal(picker.body.total,1);assert.equal(picker.body.accounts[0].login_alias,alias);assert.equal(picker.body.accounts[0].password_hash,undefined);
    assert.equal((await call('/api/auth/login',{login_alias:alias.toLowerCase(),password:'Synthetic verified password'},null)).status,401);
    const me=await call('/api/hr/me',undefined,row,'GET',login.body.token);assert.equal(me.status,200);assert.deepEqual(me.body.balances,[]);assert.equal((await pool.query('SELECT 1 FROM hr_leave_balances WHERE employee_id=$1',[employee.id])).rowCount,0);assert.equal((await call('/api/finance-check',undefined,row,'GET',login.body.token)).status,403);
    assert.equal((await call('/api/hr/leaves',{leave_type_id:randomUUID(),start_date:'2026-10-08',end_date:'2026-10-09',reason},row,'POST',login.body.token)).status,409);
    await pool.query("UPDATE hr_employees SET reviewer_id=NULL WHERE id=$1",[employee.id]);assert.equal((await call('/api/auth/login',{login_alias:alias,password:'Synthetic verified password'},null)).status,401);
  });
  test('email activation and HR recovery replace credentials and invalidate old sessions',async()=>{
    const email=`individual-${randomUUID()}@example.test`;await pool.query('UPDATE hr_employees SET email=$2 WHERE id=$1',[employee.id,email]);await apply(await prepare('email'));
    const link=await issue();await service.activateEmployee(pool,{token:raw(link),password:'Synthetic first password'});const login=await call('/api/auth/login',{email,password:'Synthetic first password'},null);assert.equal(login.status,200);
    const recovery=await issue('recovery');assert.equal((await call('/api/auth/me',undefined,central,'GET',login.body.token)).status,401);await service.activateEmployee(pool,{token:raw(recovery),password:'Synthetic replacement password'});
    assert.equal((await call('/api/auth/login',{email,password:'Synthetic first password'},null)).status,401);assert.equal((await call('/api/auth/login',{email,password:'Synthetic replacement password'},null)).status,200);
  });
  test('email and Payroll aliases share one lockout budget; verified recovery clears it',async()=>{
    const email=`lockout-${randomUUID()}@example.test`;await pool.query('UPDATE hr_employees SET email=$2 WHERE id=$1',[employee.id,email]);await provision();const link=await issue();await service.activateEmployee(pool,{token:raw(link),password:'Synthetic original password'});
    const {AUTH_MAX_FAILED_ATTEMPTS}=await import('../config.js');
    for(let n=0;n<AUTH_MAX_FAILED_ATTEMPTS;n++) assert.equal((await call('/api/auth/login',{...(n%2?{email}:{login_alias:alias}),password:'Wrong synthetic password'},null)).status,401);
    assert.equal((await call('/api/auth/login',{email,password:'Synthetic original password'},null)).status,429);assert.equal((await call('/api/auth/login',{login_alias:alias,password:'Synthetic original password'},null)).status,429);
    const recovery=await issue('recovery');await service.activateEmployee(pool,{token:raw(recovery),password:'Synthetic recovered password'});assert.equal((await call('/api/auth/login',{login_alias:alias,password:'Synthetic recovered password'},null)).status,200);
  });
  test('offboarding revokes sessions, resets, tokens and scoped grants; restore requires fresh activation',async()=>{
    const row=await provision(),link=await issue();await service.activateEmployee(pool,{token:raw(link),password:'Synthetic employee password'});const bearer=await session(row),recovery=await issue('recovery');await pool.query("INSERT INTO password_reset_tokens(reviewer_id,token,expires_at) VALUES ($1,$2,NOW()+INTERVAL '1 hour')",[row.id,randomUUID()]);await pool.query("INSERT INTO hr_access_scopes(reviewer_id,department_id,capabilities,effective_from,reason) VALUES ($1,$2,ARRAY['hr_staff_manage'],'2020-01-01',$3)",[row.id,department.id,reason]);
    await pool.query("UPDATE reviewers SET permissions='{\"hr_admin\":true}'::jsonb WHERE id=$1",[row.id]);await pool.query("INSERT INTO reviewer_capabilities(reviewer_id,capability) VALUES ($1,'hr_leave_approve')",[row.id]);
    assert.equal((await call(`/api/hr/onboarding/employees/${employee.id}/offboard`,{reason})).status,200);assert.equal((await call('/api/auth/me',undefined,row,'GET',bearer)).status,401);assert.equal((await pool.query('SELECT 1 FROM password_reset_tokens WHERE reviewer_id=$1',[row.id])).rowCount,0);assert.equal((await pool.query('SELECT 1 FROM hr_access_scopes WHERE reviewer_id=$1 AND revoked_at IS NULL',[row.id])).rowCount,0);await assert.rejects(service.activateEmployee(pool,{token:raw(recovery),password:'Synthetic stolen recovery'}),error=>error.status===400);
    assert.equal((await call(`/api/hr/onboarding/employees/${employee.id}/restore`,{reason})).status,200);assert.equal((await pool.query('SELECT status FROM reviewers WHERE id=$1',[row.id])).rows[0].status,'inactive');const fresh=await issue();await service.activateEmployee(pool,{token:raw(fresh),password:'Synthetic reappointment password'});assert.equal((await pool.query('SELECT 1 FROM hr_access_scopes WHERE reviewer_id=$1 AND revoked_at IS NULL',[row.id])).rowCount,0);assert.equal((await pool.query("SELECT permissions->>'hr_admin' AS central FROM reviewers WHERE id=$1",[row.id])).rows[0].central,null);assert.deepEqual((await auth.loadCapabilities(row.id)).sort(),['hr_access','hr_leave_apply']);
  });
  test('relinking retires activation/recovery and self-service reset tokens',async()=>{
    const row=await provision(),link=await issue(),replacement=await account('Verified Replacement');await pool.query("INSERT INTO password_reset_tokens(reviewer_id,token,expires_at) VALUES ($1,$2,NOW()+INTERVAL '1 hour')",[row.id,randomUUID()]);
    assert.equal((await call(`/api/hr/directory/${employee.id}/account-link`,{reviewer_id:replacement.id,reason},central,'PUT')).status,200);assert.equal((await pool.query('SELECT 1 FROM password_reset_tokens WHERE reviewer_id=$1',[row.id])).rowCount,0);await assert.rejects(service.activateEmployee(pool,{token:raw(link),password:'Synthetic stale identity password'}),error=>error.status===400);
  });
  test('retained existing accounts gain only self-service grants and enroll in government gates',async()=>{
    const existing=await account('Already linked staff',{hr_access:true,hr_leave_apply:true});
    await (await import('../services/employeeDirectory.js')).setEmployeeAccount(pool,{employeeId:employee.id,reviewerId:existing.id,actor:central,reason});
    const batch=await prepare();assert.equal((await call(`/api/hr/onboarding/batches/${batch.id}`)).body.rows[0].decision,'retain');await apply(batch);
    assert.equal((await pool.query('SELECT leave_policy_regime FROM hr_employees WHERE id=$1',[employee.id])).rows[0].leave_policy_regime,'government');assert.deepEqual((await auth.loadCapabilities(existing.id)).sort(),['hr_access','hr_leave_apply']);
    assert.equal((await call('/api/hr/leaves',{leave_type_id:randomUUID(),start_date:'2026-10-08',end_date:'2026-10-09',reason},existing)).status,409);
  });
  test('legacy final decisions queued behind government enrollment cannot bypass the gate',async()=>{
    const type=(await pool.query("INSERT INTO hr_leave_types(name,default_days) VALUES ($1,10) RETURNING id",[`Lifecycle-${randomUUID()}`])).rows[0];
    const application=(await pool.query("INSERT INTO hr_leave_applications(employee_id,leave_type_id,start_date,end_date,days,reason,status) VALUES ($1,$2,'2026-10-08','2026-10-09',2,$3,'pending') RETURNING id",[employee.id,type.id,reason])).rows[0];
    const blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM hr_employees WHERE id=$1 FOR UPDATE',[employee.id]);
    const request=call(`/api/hr/leaves/${application.id}/decision`,{decision:'approved',reviewer_note:reason});
    try {
      let waiting=false;
      for(let n=0;n<100;n++){waiting=(await pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT reviewer_id FROM hr_employees%' ")).rowCount>0;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));}
      assert.ok(waiting,'actual decision is waiting for employee placement/identity lock');
      await blocker.query("UPDATE hr_employees SET leave_policy_regime='government' WHERE id=$1",[employee.id]);await blocker.query('COMMIT');assert.equal((await request).status,409);
      assert.equal((await pool.query('SELECT status FROM hr_leave_applications WHERE id=$1',[application.id])).rows[0].status,'pending');
    } finally {await blocker.query('ROLLBACK');blocker.release();}
  });
  test('private link withdrawal, handover validation and shared staff offboarding enforce distinct authority',async()=>{
    const row=await provision(),link=await issue();assert.equal((await call(`/api/hr/onboarding/employees/${employee.id}/link`,{reason,purpose:'activation',handover:'verified_email'})).status,400);
    assert.equal((await call(`/api/hr/onboarding/employees/${employee.id}/revoke-links`,{reason},hr)).status,200);await assert.rejects(service.activateEmployee(pool,{token:raw(link),password:'Synthetic secure password'}),error=>error.status===400);
    const fresh=await issue();await assert.rejects(service.activateEmployee(pool,{token:raw(fresh),password:'界'.repeat(30)}),error=>error.status===400);assert.equal((await pool.query('SELECT consumed_at FROM hr_account_tokens WHERE id=$1',[fresh.id])).rows[0].consumed_at,null);
    const staff=await account('Existing Staff');await (await import('../services/employeeDirectory.js')).setEmployeeAccount(pool,{employeeId:employee.id,reviewerId:staff.id,actor:central,reason});
    assert.equal((await call(`/api/hr/onboarding/employees/${employee.id}/offboard`,{reason},hr)).status,403);assert.equal((await pool.query('SELECT status FROM reviewers WHERE id=$1',[staff.id])).rows[0].status,'active');assert.equal((await call(`/api/hr/onboarding/employees/${employee.id}/offboard`,{reason})).status,200);assert.equal((await pool.query('SELECT status FROM reviewers WHERE id=$1',[staff.id])).rows[0].status,'inactive');assert.equal((await pool.query('SELECT status FROM reviewers WHERE id=$1',[row.id])).rows[0].status,'inactive');
  });
  test('audit failures roll back activation and offboarding',async()=>{
    const row=await provision(),link=await issue();await pool.query(`CREATE FUNCTION reject_lifecycle_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('hr.employee.account.activated','hr.employee.offboarded') THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);await pool.query('CREATE TRIGGER reject_lifecycle_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_lifecycle_audit()');
    try{await assert.rejects(service.activateEmployee(pool,{token:raw(link),password:'Synthetic secure password'}));assert.equal((await pool.query('SELECT status FROM reviewers WHERE id=$1',[row.id])).rows[0].status,'inactive');assert.equal((await pool.query('SELECT consumed_at FROM hr_account_tokens WHERE id=$1',[link.id])).rows[0].consumed_at,null);await assert.rejects(service.offboardEmployee(pool,{employeeId:employee.id,actor:central,reason,portalAdmin:true}));assert.equal((await pool.query('SELECT status FROM hr_employees WHERE id=$1',[employee.id])).rows[0].status,'active');}
    finally{await pool.query('DROP TRIGGER reject_lifecycle_audit ON audit_log');await pool.query('DROP FUNCTION reject_lifecycle_audit()');}
  });
});

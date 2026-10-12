import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach, describe } from 'node:test';
import { connectTestDatabase, createEmployee, resetLeaveTables, skipWithoutDatabase } from '../test-support/database.js';

describe('central HR management screens and bounded APIs', { skip: skipWithoutDatabase }, () => {
  let pool, management, directory, auth, actor, department, division, server, base;
  const reason = 'HR verified Payroll identity and signed appointment records.';
  before(async () => {
    pool=await connectTestDatabase(); management=await import('./employeeManagement.js'); directory=await import('./employeeDirectory.js'); auth=await import('./authService.js');
    const express=(await import('express')).default, errors=await import('../middleware/errors.js'); errors.enableAsyncErrors();
    const {default:router}=await import('../routes/hr.js'); const app=express(); app.use(express.json()); app.use('/api/hr',router); app.use(errors.errorHandler);
    server=await new Promise((resolve)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}); base=`http://127.0.0.1:${server.address().port}/api/hr/directory`;
  });
  after(async()=>{if(server) await new Promise((resolve)=>server.close(resolve)); await pool?.end();});
  beforeEach(async()=>{
    // Direct entry must work without any historical setup/adoption record.
    await pool.query('TRUNCATE hr_gov_initial_setups,hr_gov_initial_setup_revisions CASCADE');
    await pool.query('TRUNCATE hr_employee_import_batches,hr_work_patterns CASCADE'); await resetLeaveTables(pool);
    actor=await account({hr_admin:true});
    department=(await pool.query("INSERT INTO hr_departments(name) VALUES ('Finance') RETURNING *")).rows[0];
    division=(await pool.query("INSERT INTO hr_divisions(department_id,name) VALUES ($1,'Treasury') RETURNING *",[department.id])).rows[0];
  });
  async function account(permissions={},name='Synthetic Account') {return (await pool.query(`INSERT INTO reviewers(email,display_name,role,password_hash,permissions)
    VALUES ($1,$2,'user','x',$3) RETURNING *`,[`management-${randomUUID()}@example.test`,name,permissions])).rows[0];}
  async function token(row=actor) {const s=await auth.createSession(row.id);return auth.buildTokenPayload(row,s.tokenId,s.expiresAt);}
  async function call(path='',body,method=body?'POST':'GET',row=actor) {const response=await fetch(`${base}${path}`,{method,headers:{Authorization:`Bearer ${await token(row)}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};}
  const create=(extra={})=>management.createManagedEmployee(pool,{data:{display_name:'New Employee',external_id:'000001-A',department_id:department.id,division_id:division.id,...extra},actor,reason});
  async function createExisting(extra={}) {
    const employee=await create(extra);
    await pool.query("UPDATE hr_employees SET leave_policy_regime='legacy' WHERE id=$1",[employee.id]);
    return employee;
  }
  const edit=(id,data,who=actor)=>management.updateManagedEmployee(pool,{employeeId:id,data,actor:who,reason});

  test('manual verified creation is atomic, preserves text IDs and creates no login or balance',async()=>{
    const employee=await create(); const profile=await directory.employeeProfile(pool,employee.id);
    assert.equal(profile.employee.leave_policy_regime,'government');
    assert.equal((await pool.query('SELECT count(*)::int n FROM hr_gov_entitlements')).rows[0].n,0);
    assert.equal((await pool.query('SELECT count(*)::int n FROM hr_gov_workflow_configs')).rows[0].n,0);
    assert.equal(profile.external_ids[0].external_id,'000001-A'); assert.equal(profile.employee.reviewer_id,null);
    assert.equal((await pool.query('SELECT count(*)::int n FROM hr_leave_balances')).rows[0].n,0);
    await assert.rejects(create({display_name:'Duplicate ID'}),{status:409});
    assert.equal((await pool.query('SELECT count(*)::int n FROM hr_employees')).rows[0].n,1);
    await assert.rejects(management.createManagedEmployee(pool,{data:{display_name:'Bad audit',external_id:'000002',department_id:department.id},actor:{id:randomUUID()},reason}),{code:'23503'});
    assert.equal((await pool.query('SELECT count(*)::int n FROM hr_employees')).rows[0].n,1);
  });
  test('employee details ignore privilege/balance fields, preserve linked email, and revoke sessions on status change',async()=>{
    const employee=await create(); const login=await account();
    await pool.query('UPDATE hr_employees SET reviewer_id=$2,email=$3,join_date=$4,leave_entitled=FALSE WHERE id=$1',[employee.id,login.id,login.email,'2020-01-01']);
    const data={display_name:'Verified rename',position_title:'Officer',status:'active',email:login.email,manager_id:null,reviewer_id:actor.id,daily_rate:9999,leave_entitled:true};
    await edit(employee.id,data);
    let saved=(await pool.query('SELECT * FROM hr_employees WHERE id=$1',[employee.id])).rows[0];
    assert.equal(saved.reviewer_id,login.id);assert.equal(saved.daily_rate,null);assert.equal(saved.leave_entitled,false);assert.equal(saved.join_date,'2020-01-01');
    await assert.rejects(edit(employee.id,{...data,email:'changed@example.test'}),{status:400});
    const session=await auth.createSession(login.id);
    await edit(employee.id,{...data,status:'inactive'});assert.equal(await auth.lookupSession(session.tokenId),null);
    await pool.query(`CREATE FUNCTION management_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='hr.employee.details.verified' THEN RAISE EXCEPTION 'synthetic details audit failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER management_test_reject_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION management_test_reject_audit()`);
    try { await assert.rejects(edit(employee.id,{...data,status:'active'}), /synthetic details audit failure/); }
    finally { await pool.query('DROP TRIGGER management_test_reject_audit ON audit_log; DROP FUNCTION management_test_reject_audit()'); }
    saved=(await pool.query('SELECT status FROM hr_employees WHERE id=$1',[employee.id])).rows[0];assert.equal(saved.status,'inactive');
  });
  test('concurrent opposite manager edits cannot create a cycle',async()=>{
    const one=await create(),two=await create({external_id:'000002',display_name:'Second'});
    const details=(name,manager)=>({display_name:name,status:'active',email:null,manager_id:manager});
    const result=await Promise.allSettled([edit(one.id,details('One',two.id)),edit(two.id,details('Two',one.id))]);
    assert.equal(result.filter((r)=>r.status==='fulfilled').length,1);assert.equal(result.find((r)=>r.status==='rejected').reason.status,400);
  });
  test('preparation filters distinguish missing identity, placement and service facts',async()=>{
    const employee=await create(),missing=await createEmployee(pool,{name:'Missing Facts'});
    assert.equal((await directory.listEmployeeDirectory(pool,{readiness:'missing_id'})).employees[0].id,missing.id);
    assert.equal((await directory.listEmployeeDirectory(pool,{readiness:'missing_placement'})).employees[0].id,missing.id);
    assert.equal((await directory.listEmployeeDirectory(pool,{readiness:'missing_service'})).total,2);
    await directory.addServicePeriod(pool,{employeeId:employee.id,period:{start_date:'2020-01-01',employment_category:'temporary',is_intern:true,counts_for_service:false},actor,reason});
    const ready=await directory.listEmployeeDirectory(pool);assert.equal(ready.employees.find((e)=>e.id===employee.id).is_intern,true);
    assert.equal((await directory.listEmployeeDirectory(pool,{readiness:'missing_service'})).total,1);
    assert.equal((await directory.listEmployeeDirectory(pool,{readiness:'missing_pattern'})).total,2);
    assert.equal((await call('?readiness=invented')).status,422);
  });
  test('migration roster filters before pagination and returns separate accurate totals',async()=>{
    await pool.query(`INSERT INTO hr_employees(display_name,department_id,division_id,leave_policy_regime)
      SELECT 'Roster '||lpad(i::text,3,'0'),$1,$2,CASE WHEN i<=5 THEN 'government' ELSE 'legacy' END FROM generate_series(1,60)i`,[department.id,division.id]);
    const query=`?department_id=${department.id}&status=active`;
    const awaiting=await call(query+'&regime=legacy'),migrated=await call(query+'&regime=government'),second=await call(query+'&regime=legacy&page=2');
    assert.equal(awaiting.status,200);assert.equal(awaiting.body.total,55);assert.equal(awaiting.body.employees.length,50);assert.equal(second.body.employees.length,5);
    assert.ok(awaiting.body.employees.every(e=>e.leave_policy_regime==='legacy'));assert.equal(migrated.body.total,5);assert.ok(migrated.body.employees.every(e=>e.leave_policy_regime==='government'));
    assert.equal(new Set([...awaiting.body.employees,...second.body.employees].map(e=>e.id)).size,55);
    assert.equal((await call(query)).body.total,60);assert.equal((await call('?regime=invented')).status,422);
    await pool.query("UPDATE hr_employees SET leave_policy_regime='government' WHERE id=$1",[awaiting.body.employees[0].id]);
    assert.equal((await call(query+'&regime=legacy')).body.total,54);assert.equal((await call(query+'&regime=government')).body.total,6);
  });
  test('migration status filtering preserves department, active-staff and HR scope boundaries',async()=>{
    const employee=await create();await pool.query("UPDATE hr_employees SET leave_policy_regime='government' WHERE id=$1",[employee.id]);
    const outside=(await pool.query("INSERT INTO hr_departments(name) VALUES('Outside migration scope') RETURNING *")).rows[0];
    await pool.query("INSERT INTO hr_employees(display_name,department_id,leave_policy_regime,status) VALUES('Outside migrated',$1,'government','active'),('Inactive migrated',$2,'government','inactive')",[outside.id,department.id]);
    const staff=await account({hr_staff_manage:true});
    const scopes=await import('./hrAccess.js');await scopes.grantHrScope(pool,{user:actor,actor,data:{reviewer_id:staff.id,department_id:department.id,capabilities:['hr_staff_manage'],effective_from:'2020-01-01',reason}});
    const scoped=await call('?regime=government&status=active',undefined,'GET',staff);assert.equal(scoped.status,200);assert.equal(scoped.body.total,1);assert.equal(scoped.body.employees[0].id,employee.id);
    assert.equal((await call(`?regime=government&status=active&department_id=${outside.id}`,undefined,'GET',staff)).body.total,0);
    assert.equal((await call(`?regime=government&status=active&department_id=${department.id}`)).body.total,1);
  });
  test('only explicitly restricted contracts are excluded from the pending migration list',async()=>{
    const contract=await createExisting(),paid=await createExisting({external_id:'000002',display_name:'Paid contract'}),temp=await createExisting({external_id:'000003',display_name:'Temporary'});
    for(const [e,category] of [[contract,'contract'],[paid,'contract'],[temp,'temporary']])await directory.addServicePeriod(pool,{employeeId:e.id,period:{start_date:'2020-01-01',employment_category:category,counts_for_service:true},actor,reason});
    await pool.query('UPDATE hr_employees SET leave_entitled=FALSE WHERE id=ANY($1::uuid[])',[[contract.id,temp.id]]);
    const query=`?department_id=${department.id}&regime=legacy`;
    const pending=(await call(query+'&contract_without_leave=exclude')).body,excluded=(await call(query+'&contract_without_leave=only')).body;
    assert.equal(pending.total,2);assert.ok(pending.employees.some(e=>e.id===paid.id));assert.ok(pending.employees.some(e=>e.id===temp.id));assert.equal(excluded.total,1);assert.equal(excluded.employees[0].id,contract.id);
    assert.equal((await call(query)).body.total,3);assert.equal((await call('?contract_without_leave=invented')).status,422);
  });
  async function contractCorrectionFixture(){
    actor=(await pool.query("UPDATE reviewers SET role='admin' WHERE id=$1 RETURNING *",[actor.id])).rows[0];
    const employee=await createExisting();const period=await directory.addServicePeriod(pool,{employeeId:employee.id,period:{start_date:'2020-01-01',employment_category:'permanent',counts_for_service:true},actor,reason});
    const module=await import('./governmentLeaveInitialContractExclusions.js');const data={employee_ids:[employee.id],no_paid_leave_confirmed:true,source_reference:'Owner confirmed initial contract terms with no leave entitlement',reason};
    return {employee,period,module,data};
  }
  test('initial admin contract correction retains dates, schedule, identity and balances without opening Government leave',async()=>{
    const {employee,period,module,data}=await contractCorrectionFixture();
    const type=(await pool.query("INSERT INTO hr_leave_types(name,default_days,is_accruable) VALUES('Contract retained Annual',20,TRUE) RETURNING *")).rows[0];
    await pool.query('INSERT INTO hr_leave_balances(employee_id,leave_type_id,year,balance,pending) VALUES($1,$2,2026,20,0)',[employee.id,type.id]);
    const before=(await pool.query('SELECT * FROM hr_leave_balances WHERE employee_id=$1',[employee.id])).rows;
    const beforeEmployee=(await pool.query('SELECT * FROM hr_employees WHERE id=$1',[employee.id])).rows[0];
    const preview=await module.previewInitialContractExclusions(pool,{user:actor,data});assert.equal(preview.employees[0].start_date,period.start_date);
    await assert.rejects(module.applyInitialContractExclusions(pool,{user:actor,actor,data:{...data,snapshot_hash:'stale'}}),/changed/);
    await module.applyInitialContractExclusions(pool,{user:actor,actor,data:{...data,snapshot_hash:preview.snapshot_hash}});
    const after=(await pool.query('SELECT * FROM hr_employee_service_periods WHERE id=$1',[period.id])).rows[0];assert.deepEqual({...after,employment_category:period.employment_category},period);assert.equal(after.employment_category,'contract');
    const saved=(await pool.query('SELECT * FROM hr_employees WHERE id=$1',[employee.id])).rows[0];assert.equal(saved.leave_entitled,false);assert.equal(saved.leave_policy_regime,'legacy');assert.equal(saved.reviewer_id,beforeEmployee.reviewer_id);
    assert.deepEqual((await pool.query('SELECT * FROM hr_leave_balances WHERE employee_id=$1',[employee.id])).rows,before);assert.equal((await pool.query('SELECT count(*)::int n FROM hr_gov_entitlements WHERE employee_id=$1',[employee.id])).rows[0].n,0);
    const correction=(await pool.query('SELECT * FROM hr_employee_service_corrections WHERE employee_id=$1',[employee.id])).rows[0];assert.equal(correction.status,'approved');assert.equal(correction.prepared_by,actor.id);assert.equal(correction.approved_by,actor.id);
    await assert.rejects(pool.query("UPDATE hr_employee_service_corrections SET proposed='{}' WHERE id=$1",[correction.id]),/immutable/);
  });
  test('initial contract corrections require confirmed terms and roll back when their audit cannot be written',async()=>{
    const {employee,period,module,data}=await contractCorrectionFixture();
    await assert.rejects(module.previewInitialContractExclusions(pool,{user:actor,data:{...data,no_paid_leave_confirmed:false}}),/actual contract terms/);
    const preview=await module.previewInitialContractExclusions(pool,{user:actor,data});
    await pool.query("CREATE FUNCTION contract_correction_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='hr.gov.initial_contract_exclusion.applied' THEN RAISE EXCEPTION 'synthetic contract audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER contract_correction_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION contract_correction_audit_failure()");
    try{await assert.rejects(module.applyInitialContractExclusions(pool,{user:actor,actor,data:{...data,snapshot_hash:preview.snapshot_hash}}),/synthetic contract audit failure/);}finally{await pool.query('DROP TRIGGER contract_correction_audit_failure ON audit_log; DROP FUNCTION contract_correction_audit_failure()');}
    assert.equal((await pool.query('SELECT employment_category FROM hr_employee_service_periods WHERE id=$1',[period.id])).rows[0].employment_category,'permanent');assert.equal((await pool.query('SELECT leave_entitled FROM hr_employees WHERE id=$1',[employee.id])).rows[0].leave_entitled,true);assert.equal((await pool.query('SELECT count(*)::int n FROM hr_employee_service_corrections WHERE employee_id=$1',[employee.id])).rows[0].n,0);
    await pool.query("UPDATE hr_employees SET leave_policy_regime='government' WHERE id=$1",[employee.id]);await assert.rejects(module.previewInitialContractExclusions(pool,{user:actor,data}),/not migrated/);
  });
  test('account picker has bounded stable pages and excludes credentials and permissions',async()=>{
    await pool.query(`INSERT INTO reviewers(email,display_name,role,password_hash) SELECT 'synthetic-'||i||'@example.test','Picker Employee '||lpad(i::text,4,'0'),'user','x' FROM generate_series(1,2000) i`);
    const first=await management.listLinkableAccounts(pool,{search:'Picker Employee'}),second=await management.listLinkableAccounts(pool,{search:'Picker Employee',page:2});
    assert.equal(first.total,2000);assert.equal(first.accounts.length,50);assert.equal(new Set([...first.accounts,...second.accounts].map((a)=>a.id)).size,100);
    for(const row of first.accounts){assert.equal(row.password_hash,undefined);assert.equal(row.permissions,undefined);}
    const exact=await management.listLinkableAccounts(pool,{search:'synthetic-2000@example.test'});assert.equal(exact.total,1);
  });
  test('work patterns are explicit and case-insensitive duplicate creation is serialized',async()=>{
    const options={data:{name:'Standard Week',working_weekdays:[1,2,3,4,5],hours_per_day:8},actor,reason};
    const results=await Promise.allSettled([management.createWorkPattern(pool,options),management.createWorkPattern(pool,{...options,data:{...options.data,name:'STANDARD WEEK'}})]);
    assert.equal(results.filter((r)=>r.status==='fulfilled').length,1);
    await assert.rejects(management.createWorkPattern(pool,{...options,data:{...options.data,name:'Repeated',working_weekdays:[1,1]}}),{status:400});
    assert.equal((await call('/work-patterns',{...options.data,working_weekdays:[0],reason})).status,422);
  });
  test('central-HR gates protect every new operation and request responses are no-store',async()=>{
    const staff=await account({hr_staff_manage:true});const employee=await create();
    for(const [path,body,method] of [['/accounts',undefined,'GET'],['',{display_name:'Unauthorised',external_id:'000002',department_id:department.id,reason},'POST'],[`/${employee.id}/details`,{display_name:'Unauthorised',status:'active',manager_id:null,reason},'PUT']])assert.equal((await call(path,body,method,staff)).status,path.endsWith('/details')?404:403);
    assert.equal((await call('/work-patterns',undefined,'GET',staff)).status,200);
    assert.equal((await call('/accounts')).cache,'no-store');
    assert.equal((await call(`/${employee.id}/profile`)).body.employee.daily_rate,undefined);
    assert.equal((await call(`/${employee.id}/details`,{display_name:'Bad',status:'active',reason},'PUT')).status,422);
  });
  test('officeholder list exposes names and readiness without granting approval capabilities',async()=>{
    const employee=await create(),login=await account();
    await pool.query('UPDATE hr_employees SET reviewer_id=$2 WHERE id=$1',[employee.id,login.id]);
    const assigned=await call('/approval-assignments',{level:'department',department_id:department.id,approver_employee_id:employee.id,effective_from:'2026-01-01',reason});assert.equal(assigned.status,201);
    const listed=(await call('/approval-assignments')).body;assert.equal(listed.page_size,50);assert.equal(listed.assignments[0].department_name,'Finance');assert.ok(!listed.assignments[0].has_approval_grant);
    assert.equal((await pool.query("SELECT count(*)::int n FROM reviewer_capabilities WHERE reviewer_id=$1 AND capability='hr_leave_approve'",[login.id])).rows[0].n,0);
    assert.equal((await call('/approval-assignments',{level:'chief_secretary',department_id:department.id,approver_employee_id:employee.id,effective_from:'2026-01-01',reason})).status,400);
  });
});

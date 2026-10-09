import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,describe,test} from 'node:test';
import {connectTestDatabase,resetLeaveTables,skipWithoutDatabase} from '../test-support/database.js';

describe('Finance Treasury division hierarchy',{skip:skipWithoutDatabase},()=>{
 let pool,server,base,auth,admin,department,treasury,createOrganisationDivision,divisionPlacementIssue,assertEmployeeScope,employeeScopeSql,managerScopeSql;
 const reason='Synthetic approved initial organisation setup';
 async function account(permissions){return(await pool.query("INSERT INTO reviewers(email,display_name,role,password_hash,permissions) VALUES($1,'Synthetic hierarchy account','user','x',$2) RETURNING *",[`${randomUUID()}@example.test`,permissions])).rows[0];}
 async function call(path,data,by=admin,method=data?'POST':'GET'){
  const session=await auth.createSession(by.id),token=auth.buildTokenPayload(by,session.tokenId,session.expiresAt);
  const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
  return {status:response.status,body:await response.json()};
 }
 const child=name=>createOrganisationDivision(pool,{departmentId:department.id,name,parentDivisionId:treasury.id,actor:admin});
 before(async()=>{
  pool=await connectTestDatabase();({createOrganisationDivision,divisionPlacementIssue}=await import('../services/organisationHierarchy.js'));({assertEmployeeScope,employeeScopeSql,managerScopeSql}=await import('../services/hrAccess.js'));auth=await import('../services/authService.js');
  const express=(await import('express')).default,errors=await import('../middleware/errors.js');errors.enableAsyncErrors();
  const app=express();app.use(express.json());app.use('/api/hr',(await import('./hr.js')).default);app.use(errors.errorHandler);
  server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});base=`http://127.0.0.1:${server.address().port}/api/hr`;
 });
 beforeEach(async()=>{
  await resetLeaveTables(pool);admin=await account({hr_access:true,hr_admin:true});
  department=(await pool.query("INSERT INTO hr_departments(name) VALUES('Finance') RETURNING *")).rows[0];
  treasury=await createOrganisationDivision(pool,{departmentId:department.id,name:'Treasury',actor:admin});
 });
 after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await pool?.end();});
 test('admin creates all three divisions under Treasury without moving existing staff or rewriting balances',async()=>{
  const employee=(await pool.query("INSERT INTO hr_employees(display_name,department_id,division_id,join_date,leave_entitled) VALUES('Synthetic existing Treasury staff',$1,$2,'2025-05-19',FALSE) RETURNING *",[department.id,treasury.id])).rows[0];
  const before=(await pool.query('SELECT to_jsonb(e) AS row FROM hr_employees e WHERE id=$1',[employee.id])).rows;
  for(const name of ['Financial Systems','Economic and Fiscal','Accounting']){
   const result=await call(`/departments/${department.id}/divisions`,{name,parent_division_id:treasury.id});
   assert.equal(result.status,201);assert.equal(result.body.parent_division_id,treasury.id);
  }
  const result=await call('/org-units');assert.equal(result.status,200);
  const divisions=result.body.find(d=>d.id===department.id).divisions;
  assert.equal(divisions.length,4);
  assert.ok(divisions.filter(d=>d.id!==treasury.id).every(d=>d.parent_division_id===treasury.id&&d.parent_division_name==='Treasury'));
  assert.deepEqual((await pool.query('SELECT to_jsonb(e) AS row FROM hr_employees e WHERE id=$1',[employee.id])).rows,before);
  assert.equal(await divisionPlacementIssue(pool,divisions.find(d=>d.name==='Accounting').id),null);
  assert.match(await divisionPlacementIssue(pool,treasury.id),/actual division under Treasury/);
 });
 test('cross-department ancestry, deeper levels, ancestry changes and deleting a parent are rejected',async()=>{
  const accounting=await child('Accounting');
  const other=(await pool.query("INSERT INTO hr_departments(name) VALUES('Other') RETURNING *")).rows[0];
  assert.equal((await call(`/departments/${other.id}/divisions`,{name:'Wrong scope',parent_division_id:treasury.id})).status,400);
  assert.equal((await call(`/departments/${department.id}/divisions`,{name:'Too deep',parent_division_id:accounting.id})).status,400);
  await assert.rejects(pool.query('UPDATE hr_divisions SET parent_division_id=$2 WHERE id=$1',[accounting.id,null]),/ancestry cannot be rewritten/);
  await assert.rejects(pool.query('INSERT INTO hr_divisions(name,department_id,parent_division_id) VALUES($1,$2,$3)',['Wrong department',other.id,treasury.id]),e=>e.code==='23503');
  assert.equal((await call(`/divisions/${treasury.id}`,null,admin,'DELETE')).status,409);
  assert.equal((await call(`/departments/${department.id}/divisions`,{name:'Accounting',parent_division_id:treasury.id})).status,409);
 });
 test('creation requires central HR and audit failure rolls the new division back',async()=>{
  const limited=await account({hr_access:true,hr_staff_manage:true});
  assert.equal((await call(`/departments/${department.id}/divisions`,{name:'Accounting',parent_division_id:treasury.id},limited)).status,403);
  await pool.query("CREATE FUNCTION synthetic_hierarchy_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='hr.division.created' THEN RAISE EXCEPTION 'synthetic hierarchy audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER synthetic_hierarchy_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_hierarchy_failure()");
  try{await assert.rejects(child('Accounting'),/synthetic hierarchy audit failure/);assert.equal((await pool.query("SELECT 1 FROM hr_divisions WHERE name='Accounting'")).rowCount,0);}
  finally{await pool.query('DROP TRIGGER synthetic_hierarchy_failure ON audit_log; DROP FUNCTION synthetic_hierarchy_failure()');}
 });
 test('Treasury access reaches its divisions while leaf access and explicit managers stay scoped',async()=>{
  const accounting=await child('Accounting'),systems=await child('Financial Systems');
  const otherParent=await createOrganisationDivision(pool,{departmentId:department.id,name:'Other unit',actor:admin});
  const other=await createOrganisationDivision(pool,{departmentId:department.id,name:'Other division',parentDivisionId:otherParent.id,actor:admin});
  const limited=await account({hr_access:true,hr_staff_manage:true,hr_leave_approve:true});
  const manager=(await pool.query("INSERT INTO hr_employees(display_name,reviewer_id,department_id,division_id) VALUES('Synthetic manager',$1,$2,$3) RETURNING *",[limited.id,department.id,treasury.id])).rows[0];
  const employees=[];
  for(const node of [accounting,systems,other])employees.push((await pool.query("INSERT INTO hr_employees(display_name,department_id,division_id,manager_id) VALUES($1,$2,$3,$4) RETURNING *",[node.name,department.id,node.id,manager.id])).rows[0]);
  await pool.query("INSERT INTO hr_access_scopes(reviewer_id,department_id,division_id,capabilities,effective_from,granted_by,reason) VALUES($1,$2,$3,ARRAY['hr_staff_manage','hr_leave_approve'],'2026-01-01',$4,$5)",[limited.id,department.id,treasury.id,admin.id,reason]);
  const visible=async condition=>(await pool.query(`SELECT e.id FROM hr_employees e WHERE e.id=ANY($2::uuid[]) AND ${condition}`,[limited.id,employees.map(e=>e.id)])).rows.map(e=>e.id).sort();
  assert.deepEqual(await visible(employeeScopeSql(limited,'hr_staff_manage')),employees.slice(0,2).map(e=>e.id).sort());
  assert.deepEqual(await visible(managerScopeSql(limited)),employees.slice(0,2).map(e=>e.id).sort());
  await assertEmployeeScope(pool,limited,employees[0].id,'hr_staff_manage');
  await assert.rejects(assertEmployeeScope(pool,limited,employees[2].id,'hr_staff_manage'),e=>e.status===404);
  const read=await call('/org-units',null,limited);assert.equal(read.status,200);assert.equal(read.body[0].divisions.length,3);
  await pool.query('UPDATE hr_access_scopes SET division_id=$2 WHERE reviewer_id=$1',[limited.id,accounting.id]);
  assert.deepEqual(await visible(employeeScopeSql(limited,'hr_staff_manage')),[employees[0].id]);
  await assert.rejects(assertEmployeeScope(pool,limited,employees[1].id,'hr_staff_manage'),e=>e.status===404);
  await pool.query('UPDATE hr_employees SET manager_id=NULL WHERE id=$1',[employees[0].id]);
  assert.deepEqual(await visible(managerScopeSql(limited)),[employees[1].id]);
 });
});

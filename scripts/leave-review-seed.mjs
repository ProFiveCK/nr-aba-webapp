// Synthetic fixtures for the isolated review database. Never imports personnel files.
import {pool} from './src/db.js';
import {randomUUID} from 'node:crypto';
export async function seedReview(){
 const actors=[['local-hr@example.test','Local HR Preview',{hr_access:true,hr_admin:true,hr_staff_manage:true,hr_balance_manage:true,hr_leave_approve:true,hr_report_read:true,admin:true}],['local-certifier@example.test','Independent HR Certifier',{hr_access:true,hr_admin:true}],['local-scoped-hr@example.test','Scoped HR Preview',{hr_access:true,hr_staff_manage:true}],['local-government-division@example.test','Synthetic Government Division Approver',{hr_access:true,hr_leave_approve:true}],['local-government-hod@example.test','Synthetic Government HOD',{hr_access:true,hr_leave_approve:true}],['local-government-secretary@example.test','Synthetic Relevant Secretary',{hr_access:true,hr_leave_approve:true}],['local-government-chief@example.test','Synthetic Government Chief Secretary',{hr_access:true,hr_leave_approve:true}]];
 for(const [email,name,permissions] of actors)await pool.query("INSERT INTO reviewers(email,display_name,role,password_hash,permissions) VALUES ($1,$2,'user',$3,$4) ON CONFLICT(email) DO NOTHING",[email,name,`!review-only:${randomUUID()}`,permissions]);
 const {rows:[hr]}=await pool.query("SELECT id FROM reviewers WHERE email='local-hr@example.test'");
 await pool.query("INSERT INTO hr_departments(name) VALUES ('Synthetic Onboarding') ON CONFLICT DO NOTHING");const {rows:[department]}=await pool.query("SELECT id FROM hr_departments WHERE name='Synthetic Onboarding'");
 await pool.query("INSERT INTO hr_divisions(name,department_id) VALUES('Synthetic Onboarding Division',$1) ON CONFLICT DO NOTHING",[department.id]);
 const {rows:[division]}=await pool.query("SELECT id FROM hr_divisions WHERE department_id=$1 AND name='Synthetic Onboarding Division'",[department.id]);
 for(const [email,name] of actors.filter(([email])=>email==='local-certifier@example.test'||email.startsWith('local-government-'))){
   const {rows:[account]}=await pool.query('SELECT id FROM reviewers WHERE email=$1',[email]);
   if(!(await pool.query('SELECT 1 FROM hr_employees WHERE reviewer_id=$1',[account.id])).rowCount)await pool.query('INSERT INTO hr_employees(display_name,reviewer_id,department_id,division_id,department_code,division_code) VALUES($1,$2,$3,$4,$5,$6)',[name,account.id,department.id,division.id,'Synthetic Onboarding','Synthetic Onboarding Division']);
 }
 let {rows:[employee]}=await pool.query("SELECT e.id FROM hr_employees e JOIN hr_employee_external_ids x ON x.employee_id=e.id WHERE x.source='techone_payroll' AND x.external_id='DEMO-1E-00001-A'");
 if(!employee){
  const {rows:[account]}=await pool.query("INSERT INTO reviewers(display_name,role,account_type,email,login_alias,password_hash,permissions) VALUES ('Synthetic 1E Alias Employee','user','employee',NULL,'DEMO-1E-00001-A',$1,'{\"hr_access\":true,\"hr_leave_apply\":true}') RETURNING id",[`!review-only:${randomUUID()}`]);
  ({rows:[employee]}=await pool.query("INSERT INTO hr_employees(display_name,reviewer_id,department_id,division_id,department_code,division_code,leave_policy_regime) VALUES ('Synthetic 1E Alias Employee',$1,$2,$3,'Synthetic Onboarding','Synthetic Onboarding Division','government') RETURNING id",[account.id,department.id,division.id]));
  await pool.query("INSERT INTO hr_employee_external_ids(employee_id,source,external_id,verified_by,reason) VALUES ($1,'techone_payroll','DEMO-1E-00001-A',$2,'Synthetic review identity fixture')",[employee.id,hr.id]);
 }
 await pool.query("INSERT INTO hr_work_patterns(name,working_weekdays,hours_per_day) VALUES ('Synthetic Standard Office',ARRAY[1,2,3,4,5],7) ON CONFLICT DO NOTHING");
 const {rows:[pattern]}=await pool.query("SELECT id FROM hr_work_patterns WHERE name='Synthetic Standard Office'");
 if(!(await pool.query('SELECT 1 FROM hr_employee_service_periods WHERE employee_id=$1',[employee.id])).rowCount)await pool.query("INSERT INTO hr_employee_service_periods(employee_id,start_date,employment_category,counts_for_service,work_pattern_id,recorded_by,reason) VALUES ($1,'2026-01-01','permanent',TRUE,$2,$3,'Synthetic review appointment fixture; no real service assertion')",[employee.id,pattern.id,hr.id]);
 console.log('Synthetic review actors and appointment fixture ready.');
}

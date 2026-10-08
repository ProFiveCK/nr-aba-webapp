import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { FRONTEND_BASE_URL, PASS_HASH_ROUNDS, PASSWORD_MIN_LENGTH } from '../config.js';
import { ServiceError } from '../lib/serviceError.js';
import { withTransaction } from '../lib/transaction.js';
import { recordAudit } from './auditService.js';
import { setEmployeeAccount } from './employeeDirectory.js';
import { managementReason } from './employeeManagement.js';

const conflict = message => new ServiceError(409,message);
const invalidLink = () => new ServiceError(400,'This link is invalid, expired or no longer authorised. Ask HR for a new link.');
const hashToken = value => createHash('sha256').update(value).digest('hex');
const audit = (client,actor,action,id,after) => recordAudit({client,actor,action,entityType:'hr_employee',entityId:id,after});
const canonical = value => JSON.stringify(value, (_key,item) => item && typeof item==='object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))) : item);
const emailValid = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '') && value.length<=254;

// No passwords, permissions or tokens are included in a preview snapshot.
async function employeeSnapshot(client,id) {
  const {rows:[row]}=await client.query(`SELECT e.id,e.display_name,e.email,e.status,e.department_id,e.division_id,e.reviewer_id,e.leave_policy_regime,
    COALESCE((SELECT json_agg(json_build_object('external_id',x.external_id,'verified_by',x.verified_by) ORDER BY x.external_id)
      FROM hr_employee_external_ids x WHERE x.employee_id=e.id AND x.source='techone_payroll'),'[]'::json) AS payroll_ids
    FROM hr_employees e WHERE e.id=$1`,[id]);
  return row;
}
function payrollId(snapshot) {
  return snapshot?.payroll_ids?.length===1 && snapshot.payroll_ids[0].verified_by ? snapshot.payroll_ids[0].external_id : null;
}
async function readiness(client,snapshot,mode) {
  if(snapshot.status!=='active' || !snapshot.department_id) return {decision:'blocked',issue:'Active employee and verified department are required.'};
  const id=payrollId(snapshot);
  if(!id) return {decision:'blocked',issue:'Exactly one verified TechnologyOne Payroll ID is required. Reconcile identity history first.'};
  if(snapshot.reviewer_id) return {decision:'retain',reviewer_id:snapshot.reviewer_id,issue:'Existing link retained. Applying adds Leave self-service grants and enrolls the employee in the gated government regime; finance/approval rights are unchanged.'};
  const email=snapshot.email?.trim().toLowerCase() || null;
  if((mode==='email' && !emailValid(email)) || (email && !emailValid(email))) return {decision:'blocked',issue:'Verify an individual email in employee details, or prepare a Payroll-alias cohort without email.'};
  const {rows:[existing]}=await client.query('SELECT id FROM reviewers WHERE ($1::text IS NOT NULL AND lower(email)=$1) OR ($2::text IS NOT NULL AND login_alias=$2) LIMIT 1',[email,mode==='payroll'?id:null]);
  if(existing) return {decision:'blocked',reviewer_id:existing.id,issue:'An account already uses this email or alias. Explicitly verify a link or skip this person; no automatic match.'};
  return {decision:'create',issue:null};
}
export async function previewOnboarding(pool,{departmentId=null,employeeIds=null,loginMode,actor,reason}) {
  const verifiedReason=managementReason(reason);
  if(!['email','payroll'].includes(loginMode)) throw new ServiceError(400,'Choose email or Payroll login.');
  return withTransaction(pool,async client=>{
    const {rows:employees}=await client.query(`SELECT id FROM hr_employees WHERE ($1::uuid IS NULL OR department_id=$1)
      AND ($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY id LIMIT 2001`,[departmentId,employeeIds]);
    if(!employees.length) throw new ServiceError(400,'No employees match this cohort.');
    if(employees.length>2000) throw new ServiceError(400,'Prepare a cohort of at most 2,000 employees.');
    const {rows:[batch]}=await client.query(`INSERT INTO hr_onboarding_batches(login_mode,prepared_by,reason) VALUES ($1,$2,$3) RETURNING *`,[loginMode,actor.id,verifiedReason]);
    const snapshots=[];
    for(const employee of employees) snapshots.push(await employeeSnapshot(client,employee.id));
    const emailCounts=new Map();
    for(const snapshot of snapshots) {const email=snapshot.email?.trim().toLowerCase();if(email)emailCounts.set(email,(emailCounts.get(email)||0)+1);}
    for(const snapshot of snapshots) {
      const ready=await readiness(client,snapshot,loginMode);
      if(ready.decision==='create' && emailCounts.get(snapshot.email?.trim().toLowerCase())>1) {ready.decision='blocked';ready.issue='Multiple employee records share this email. Verify individual addresses before preparation.';}
      await client.query(`INSERT INTO hr_onboarding_rows(batch_id,employee_id,snapshot,decision,issue,reviewer_id) VALUES ($1,$2,$3,$4,$5,$6)`,[batch.id,snapshot.id,snapshot,ready.decision,ready.issue,ready.reviewer_id||null]);
    }
    await recordAudit({client,actor,action:'hr.onboarding.previewed',entityType:'hr_onboarding_batch',entityId:batch.id,after:{login_mode:loginMode,count:snapshots.length,reason:verifiedReason}});
    return batch;
  });
}
export async function reconcileOnboarding(pool,{batchId,rowId,decision,reviewerId,actor,reason}) {
  const verifiedReason=managementReason(reason);
  if(!['link','skip'].includes(decision)) throw new ServiceError(400,'Choose an explicit existing-account link or skip.');
  return withTransaction(pool,async client=>{
    const {rows:[batch]}=await client.query('SELECT * FROM hr_onboarding_batches WHERE id=$1 FOR UPDATE',[batchId]);
    if(!batch || batch.status!=='preview') throw conflict('This preview is no longer editable.');
    const {rows:[row]}=await client.query('SELECT * FROM hr_onboarding_rows WHERE id=$1 AND batch_id=$2 FOR UPDATE',[rowId,batchId]);
    if(!row || row.decision==='retain') throw new ServiceError(400,'Choose an unlinked preview row.');
    if(decision==='link') {
      const {rows:[account]}=await client.query("SELECT id FROM reviewers WHERE id=$1 AND status='active' AND onboarding_state='ready'",[reviewerId]);
      if(!account || (await client.query('SELECT 1 FROM hr_employees WHERE reviewer_id=$1',[reviewerId])).rowCount) throw conflict('Choose an active account without an employee link.');
      if(row.snapshot.status!=='active' || !row.snapshot.department_id || !payrollId(row.snapshot)) throw conflict('Verify the active employee, placement and Payroll identity before linking.');
    }
    await client.query('UPDATE hr_onboarding_rows SET decision=$2,reviewer_id=$3,decision_by=$4,decision_reason=$5 WHERE id=$1',[row.id,decision,decision==='link'?reviewerId:null,actor.id,verifiedReason]);
    await audit(client,actor,'hr.onboarding.row.reconciled',row.employee_id,{batch_id:batchId,decision,reviewer_id:decision==='link'?reviewerId:null,reason:verifiedReason});
  });
}
export async function applyOnboarding(pool,{batchId,actor,reason}) {
  const verifiedReason=managementReason(reason);
  return withTransaction(pool,async client=>{
    const {rows:[batch]}=await client.query('SELECT * FROM hr_onboarding_batches WHERE id=$1 FOR UPDATE',[batchId]);
    if(!batch) throw new ServiceError(404,'Onboarding preview not found.');
    if(batch.status==='applied') return batch;
    const {rows}=await client.query('SELECT * FROM hr_onboarding_rows WHERE batch_id=$1 ORDER BY employee_id FOR UPDATE',[batchId]);
    if(rows.some(row=>row.decision==='blocked')) throw conflict('Resolve or explicitly skip every blocked row first.');
    // Match the existing employee-management/import lock order. Never trust a stale preview.
    await client.query('SELECT id FROM hr_employees ORDER BY id FOR UPDATE');
    let created=0,linked=0;
    for(const row of rows) {
      if(row.decision==='skip') continue;
      const current=await employeeSnapshot(client,row.employee_id);
      if(canonical(current)!==canonical(row.snapshot)) throw conflict('Employee facts changed after preview. Prepare a new cohort.');
      if(['retain','link'].includes(row.decision)) {
        await client.query(`INSERT INTO reviewer_capabilities(reviewer_id,capability,granted_by)
          VALUES ($1,'hr_access',$2),($1,'hr_leave_apply',$2) ON CONFLICT (reviewer_id,capability) DO NOTHING`,[row.decision==='retain'?current.reviewer_id:row.reviewer_id,actor.id]);
      }
      if(row.decision==='retain') {
        await client.query("UPDATE hr_employees SET leave_policy_regime='government' WHERE id=$1",[row.employee_id]);
        await audit(client,actor,'hr.employee.government_enrolled',row.employee_id,{batch_id:batchId,reviewer_id:current.reviewer_id,reason:verifiedReason});
        continue;
      }
      if(row.decision==='link') {
        const {rows:[account]}=await client.query("SELECT id FROM reviewers WHERE id=$1 AND status='active' AND onboarding_state='ready' FOR UPDATE",[row.reviewer_id]);
        if(!account) throw conflict('The selected account changed. Prepare a new cohort.');
        await setEmployeeAccount(client,{employeeId:row.employee_id,reviewerId:account.id,actor,reason:row.decision_reason});
        await client.query("UPDATE hr_employees SET leave_policy_regime='government' WHERE id=$1",[row.employee_id]);linked++;
        continue;
      }
      const ready=await readiness(client,current,batch.login_mode);
      if(ready.decision!=='create') throw conflict('An account or identity changed after preview. Reconcile a new cohort.');
      const email=current.email?.trim().toLowerCase() || null, alias=batch.login_mode==='payroll'?payrollId(current):null;
      // A disabled sentinel cannot be used as a password. Hash work occurs only at activation.
      // Insert active only inside this transaction to use verified-link invariants; final state is disabled.
      const {rows:[account]}=await client.query(`INSERT INTO reviewers(email,display_name,role,account_type,password_hash,notify_on_submission,login_alias)
        VALUES ($1,$2,'user','employee',$3,FALSE,$4) RETURNING id`,[email,current.display_name,`!activation-required:${randomUUID()}`,alias]);
      await client.query(`INSERT INTO reviewer_capabilities(reviewer_id,capability,granted_by) VALUES ($1,'hr_access',$2),($1,'hr_leave_apply',$2)`,[account.id,actor.id]);
      await setEmployeeAccount(client,{employeeId:row.employee_id,reviewerId:account.id,actor,reason:verifiedReason});
      await client.query("UPDATE hr_employees SET leave_policy_regime='government' WHERE id=$1",[row.employee_id]);
      await client.query("UPDATE reviewers SET status='inactive',onboarding_state='pending',login_alias=$2 WHERE id=$1",[account.id,alias]);
      await client.query('UPDATE hr_onboarding_rows SET reviewer_id=$2 WHERE id=$1',[row.id,account.id]);created++;
    }
    const {rows:[after]}=await client.query("UPDATE hr_onboarding_batches SET status='applied',applied_at=NOW(),applied_by=$2,apply_reason=$3 WHERE id=$1 RETURNING *",[batchId,actor.id,verifiedReason]);
    await recordAudit({client,actor,action:'hr.onboarding.applied',entityType:'hr_onboarding_batch',entityId:batchId,after:{created,linked,reason:verifiedReason}});
    return {...after,created,linked};
  }).catch(err=>{if(err.code==='23505')throw conflict('An email, alias or employee link changed. Reconcile a new cohort.');throw err;});
}
export async function issueEmployeeLink(pool,{employeeId,purpose,handover,actor,reason}) {
  const verifiedReason=managementReason(reason);
  if(!['activation','recovery'].includes(purpose) || !['in_person','verified_email'].includes(handover)) throw new ServiceError(400,'Choose activation/recovery and a verified handover method.');
  const token=randomBytes(32).toString('hex');
  const result=await withTransaction(pool,async client=>{
    const {rows:[employee]}=await client.query('SELECT * FROM hr_employees WHERE id=$1 FOR UPDATE',[employeeId]);
    if(!employee || employee.status!=='active' || !employee.reviewer_id) throw conflict('An active, verified employee link is required.');
    const {rows:[account]}=await client.query('SELECT * FROM reviewers WHERE id=$1 FOR UPDATE',[employee.reviewer_id]);
    if(account.account_type!=='employee') throw new ServiceError(400,'Existing staff accounts use portal account recovery. This tool manages employee-only identities.');
    if(purpose==='recovery' && (account.status!=='active' || account.onboarding_state!=='ready')) throw conflict('Use activation for a disabled or pending employee account.');
    if(purpose==='activation' && account.onboarding_state==='ready' && account.status==='active') throw conflict('This account is already active. Use recovery.');
    if(handover==='verified_email' && !account.email) throw new ServiceError(400,'This account has no individual email. Use verified in-person handover.');
    const id=payrollId(await employeeSnapshot(client,employeeId));
    if(!id) throw conflict('Reconcile exactly one verified Payroll ID before issuing a link.');
    await client.query('UPDATE hr_account_tokens SET revoked_at=NOW() WHERE reviewer_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL',[account.id]);
    await client.query('DELETE FROM password_reset_tokens WHERE reviewer_id=$1',[account.id]);
    await client.query('DELETE FROM reviewer_sessions WHERE reviewer_id=$1',[account.id]);
    if(purpose==='activation') await client.query("UPDATE reviewers SET status='inactive',onboarding_state='pending' WHERE id=$1",[account.id]);
    const {rows:[issued]}=await client.query(`INSERT INTO hr_account_tokens(reviewer_id,employee_id,payroll_id,purpose,token_hash,expires_at,issued_by,handover,reason)
      VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '2 hours',$6,$7,$8) RETURNING id,expires_at`,[account.id,employeeId,id,purpose,hashToken(token),actor.id,handover,verifiedReason]);
    await audit(client,actor,'hr.employee.activation_link.issued',employeeId,{token_id:issued.id,purpose,handover,expires_at:issued.expires_at,reason:verifiedReason});
    return issued;
  });
  return {...result,activation_url:`${FRONTEND_BASE_URL.replace(/#.*$/,'').replace(/\/$/,'')}/#activate-leave=${token}`};
}
export async function activateEmployee(pool,{token,password,actor={}}) {
  if(!/^[a-f0-9]{64}$/.test(token || '')) throw invalidLink();
  if(typeof password!=='string' || password.length<PASSWORD_MIN_LENGTH || Buffer.byteLength(password,'utf8')>72) throw new ServiceError(400,`Choose a password of at least ${PASSWORD_MIN_LENGTH} characters and at most 72 UTF-8 bytes.`);
  const tokenHash=hashToken(token);
  // Reject garbage/expired links before expensive password hashing; recheck under locks afterwards.
  if(!(await pool.query('SELECT 1 FROM hr_account_tokens WHERE token_hash=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>NOW()',[tokenHash])).rowCount) throw invalidLink();
  const passwordHash=await bcrypt.hash(password,PASS_HASH_ROUNDS);
  return withTransaction(pool,async client=>{
    const {rows:[ref]}=await client.query('SELECT employee_id,reviewer_id FROM hr_account_tokens WHERE token_hash=$1',[tokenHash]);
    if(!ref) throw invalidLink();
    const {rows:[employee]}=await client.query('SELECT * FROM hr_employees WHERE id=$1 FOR UPDATE',[ref.employee_id]);
    const {rows:[account]}=await client.query('SELECT * FROM reviewers WHERE id=$1 FOR UPDATE',[ref.reviewer_id]);
    const {rows:[link]}=await client.query('SELECT * FROM hr_account_tokens WHERE token_hash=$1 FOR UPDATE',[tokenHash]);
    if(!link || link.consumed_at || link.revoked_at || new Date(link.expires_at)<=new Date() || employee?.status!=='active'
      || employee.reviewer_id!==account?.id || account.account_type!=='employee'
      || payrollId(await employeeSnapshot(client,employee.id))!==link.payroll_id
      || (link.purpose==='recovery' && (account.status!=='active' || account.onboarding_state!=='ready'))
      || (link.purpose==='activation' && account.onboarding_state!=='pending')) throw invalidLink();
    await client.query("UPDATE reviewers SET password_hash=$2,must_change_password=FALSE,status='active',onboarding_state='ready',updated_at=NOW() WHERE id=$1",[account.id,passwordHash]);
    await client.query('UPDATE hr_account_tokens SET consumed_at=NOW() WHERE id=$1',[link.id]);
    await client.query('UPDATE hr_account_tokens SET revoked_at=NOW() WHERE reviewer_id=$1 AND id<>$2 AND consumed_at IS NULL AND revoked_at IS NULL',[account.id,link.id]);
    await client.query('DELETE FROM password_reset_tokens WHERE reviewer_id=$1',[account.id]);
    await client.query('DELETE FROM reviewer_sessions WHERE reviewer_id=$1',[account.id]);
    await client.query('DELETE FROM login_attempts WHERE email=$1',[`account:${account.id}`]);
    await audit(client,{id:account.id,email:account.email,ip:actor.ip},'hr.employee.account.activated',employee.id,{purpose:link.purpose,token_id:link.id});
    return {message:'Your employee account is ready. Sign in with your verified email or assigned Payroll ID and new password.'};
  });
}
export async function offboardEmployee(pool,{employeeId,actor,reason,portalAdmin=false}) {
  const verifiedReason=managementReason(reason);
  return withTransaction(pool,async client=>{
    const {rows:[employee]}=await client.query('SELECT * FROM hr_employees WHERE id=$1 FOR UPDATE',[employeeId]);
    if(!employee) throw new ServiceError(404,'Employee not found.');
    if(employee.reviewer_id===actor.id) throw new ServiceError(400,'Another administrator must offboard your own identity.');
    if(employee.reviewer_id) {
      const {rows:[account]}=await client.query('SELECT * FROM reviewers WHERE id=$1 FOR UPDATE',[employee.reviewer_id]);
      if(account.account_type!=='employee' && !portalAdmin) throw new ServiceError(403,'Portal administration is also required to disable an existing staff account.');
      await client.query("UPDATE reviewers SET status='inactive',onboarding_state='offboarded',updated_at=NOW() WHERE id=$1",[account.id]);
      if(account.account_type==='employee') {
        await client.query("DELETE FROM reviewer_capabilities WHERE reviewer_id=$1 AND capability NOT IN ('hr_access','hr_leave_apply')",[account.id]);
        await client.query("UPDATE reviewers SET permissions=(SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(permissions) WHERE key IN ('hr_access','hr_leave_apply')) WHERE id=$1",[account.id]);
      }
      await client.query('DELETE FROM reviewer_sessions WHERE reviewer_id=$1',[account.id]);
      await client.query('DELETE FROM password_reset_tokens WHERE reviewer_id=$1',[account.id]);
      await client.query('UPDATE hr_account_tokens SET revoked_at=NOW() WHERE reviewer_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL',[account.id]);
      await client.query(`UPDATE hr_access_scopes SET revoked_at=NOW(),revoked_by=$2,revoke_reason=$3 WHERE reviewer_id=$1 AND revoked_at IS NULL`,[account.id,actor.id,verifiedReason]);
    }
    await client.query("UPDATE hr_employees SET status='inactive',updated_at=NOW() WHERE id=$1",[employeeId]);
    await audit(client,actor,'hr.employee.offboarded',employeeId,{reviewer_id:employee.reviewer_id,reason:verifiedReason});
    return {message:'Employee and linked account disabled. Sessions and unused links revoked; history retained.'};
  });
}

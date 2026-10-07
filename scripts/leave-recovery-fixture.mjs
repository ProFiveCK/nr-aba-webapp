// Runs only inside disposable recovery containers; never accepts a target URL.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {pool,initSchema} from '/app/src/db.js';
import {hashPassphrase,createSession,buildTokenPayload} from '/app/src/services/authService.js';
import {encryptSecret,decryptSecret} from '/app/src/services/encryption.js';
import * as ledger from '/app/src/services/governmentLeave.js';
import * as workflow from '/app/src/services/governmentLeaveWorkflow.js';
import * as jobs from '/app/src/services/governmentLeaveJobs.js';
import {DEFAULT_RULES,fingerprint,dayNumber,isoDay} from '/app/src/lib/governmentLeaveRules.js';
import {PDFDocument} from 'pdf-lib';
assert.equal(process.env.RECOVERY_REHEARSAL,'isolated-fixture');
assert.ok(process.env.DB_HOST.startsWith('ron-leave-recovery-'));
assert.equal(process.env.DB_NAME,'leave_production_review');
const privateData=JSON.parse(readFileSync('/rehearsal/runtime/private.json','utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');
const reason='Synthetic independently verified recovery rehearsal; no actual employee data.';
const user=row=>({...row,permissions:row.permissions});
const day=workflow.today(),year=Number(day.slice(0,4)),start=`${year}-01-01`,end=`${year}-12-31`,prior=`${year-1}-01-01`;
let metadata;
try {
 if(process.argv[2]==='seed') {
  await initSchema();
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM reviewers')).rows[0].n,0,'Fixture source must be empty.');
  async function account(label,permissions,role='user',type='staff') {
   return (await pool.query(`INSERT INTO reviewers(email,display_name,role,password_hash,permissions,account_type,onboarding_state,login_alias,must_change_password)
    VALUES($1,$2,$3,$4,$5,$6,'ready',$7,FALSE) RETURNING *`,[`${label}@recovery.invalid`,label,role,await hashPassphrase(privateData.password),permissions,type,type==='employee'?'RECOVERY-EMPLOYEE':null])).rows[0];
  }
  const hr=await account('recovery-admin',{hr_admin:true,hr_access:true,hr_staff_manage:true,hr_balance_manage:true,hr_report_read:true,hr_evidence_read:true},'admin');
  const certifier=await account('recovery-certifier',{hr_admin:true,hr_access:true});
  const owner=await account('recovery-employee',{hr_access:true,hr_leave_apply:true},'user','employee');
  const department=(await pool.query("INSERT INTO hr_departments(name) VALUES('Recovery demonstration department') RETURNING *")).rows[0];
  const division=(await pool.query("INSERT INTO hr_divisions(name,department_id) VALUES('Recovery demonstration division',$1) RETURNING *",[department.id])).rows[0];
  const employee=(await pool.query(`INSERT INTO hr_employees(display_name,reviewer_id,department_id,division_id,department_code,division_code,leave_policy_regime)
   VALUES('Recovery demonstration employee',$1,$2,$3,'Recovery demonstration department','Recovery demonstration division','government') RETURNING *`,[owner.id,department.id,division.id])).rows[0];
  await pool.query("INSERT INTO hr_employee_external_ids(employee_id,source,external_id,verified_by,reason) VALUES($1,'techone_payroll','RECOVERY-EMPLOYEE',$2,$3)",[employee.id,hr.id,reason]);
  const pattern=(await pool.query("INSERT INTO hr_work_patterns(name,working_weekdays,hours_per_day) VALUES('Recovery weekly pattern',ARRAY[1,2,3,4,5],7) RETURNING *")).rows[0];
  await pool.query("INSERT INTO hr_employee_service_periods(employee_id,start_date,employment_category,counts_for_service,work_pattern_id,reason) VALUES($1,$2,'permanent',TRUE,$3,$4)",[employee.id,prior,pattern.id,reason]);
  await ledger.addFoundationRecord(pool,{user:user(hr),actor:hr,kind:'pattern',data:{work_pattern_id:pattern.id,source_reference:'Synthetic signed standard work pattern',reason}});
  await ledger.addFoundationRecord(pool,{user:user(hr),actor:hr,employeeId:employee.id,kind:'basis',data:{effective_from:prior,continuity_start:prior,anniversary_method:'calendar',leap_day_method:'feb28',schedule_mode:'weekly',source_reference:'Synthetic signed continuous service',reason}});
  const policy=await ledger.createPolicy(pool,{user:user(hr),actor:hr,data:{label:'Recovery demonstration policy',effective_from:prior,effective_to:`${year+1}-12-31`,rules:DEFAULT_RULES,source_reference:'Synthetic signed corrected policy',reason}});
  await ledger.publishPolicy(pool,{user:user(hr),actor:hr,id:policy.id,reason});
  await ledger.createCalendar(pool,{user:user(hr),actor:hr,data:{label:'Recovery demonstration calendar',effective_from:start,effective_to:`${year+1}-12-31`,holidays:[],source_reference:'Synthetic verified calendar',reason}});
  const cutover=isoDay(Math.max(dayNumber(start),dayNumber(day)-13));
  for(const [code,amount] of [['recreation','20'],['special','3']]) {
   const opening=await ledger.prepareOpening(pool,{user:user(hr),actor:hr,employeeId:employee.id,data:{code,amount,policy_version_id:policy.id,period_start:start,period_end:end,as_of:cutover,source_reference:'Synthetic certified opening register',payroll_reference:'Synthetic Salary Unit reconciliation',reason}});
   await ledger.certifyOpening(pool,{user:user(certifier),actor:certifier,id:opening.id,reason});
  }
  const config=await workflow.prepareConfiguration(pool,{user:user(hr),actor:hr,employeeId:employee.id,data:{enabled_codes:['recreation','special'],medical_rule:'single_calendar_date_nonadjacent_scheduled_days',medical_history:[],source_reference:'Synthetic signed activation review',legacy_resolution_reference:'Synthetic no historical leave',reason}});
  await workflow.publishConfiguration(pool,{user:user(certifier),actor:certifier,id:config.id,reason});
  const plan=await jobs.prepareJobPlan(pool,{user:user(hr),actor:hr,employeeId:employee.id,data:{code:'recreation',first_post_end:day,payroll_anchor:day,temporary_start:'appointment',source_reference:'Synthetic signed payroll posting approval',reason}});
  await jobs.approveJobPlan(pool,{user:user(certifier),actor:certifier,id:plan.id,reason});
  const posted=await jobs.runEmployeeJobs(pool,{user:user(hr),actor:hr,employeeId:employee.id,asOf:day});assert.equal(posted.results[0].posts.length,1);
  const officers={};
  for(const level of workflow.routeLevels('special')) {
   const officer=level==='hr_verifier'?certifier:await account(`recovery-${level}`,{hr_access:true,hr_leave_approve:true});officers[level]=officer;
   const staff=(await pool.query('INSERT INTO hr_employees(display_name,reviewer_id,department_id,division_id) VALUES($1,$2,$3,$4) RETURNING *',[`Recovery ${level}`,officer.id,department.id,division.id])).rows[0];
   if(level==='hr_verifier')await workflow.assignConsentOffice(pool,{user:user(hr),actor:hr,data:{level,department_id:null,approver_employee_id:staff.id,effective_from:start,source_reference:'Synthetic signed HR office appointment',reason}});
   else await pool.query('INSERT INTO hr_approval_assignments(level,department_id,division_id,approver_employee_id,effective_from,reason) VALUES($1,$2,$3,$4,$5,$6)',[level,level==='chief_secretary'?null:department.id,level==='division'?division.id:null,staff.id,start,reason]);
  }
  const nextWorkday=number=>{while([0,6].includes(new Date(isoDay(number)+'T00:00:00Z').getUTCDay()))number++;return isoDay(number);};
  const pdf=await PDFDocument.create();pdf.addPage([400,200]).drawText('Synthetic recovery evidence');const evidence=Buffer.from(await pdf.save());
  const grantedDay=nextWorkday(Math.min(dayNumber(day)+1,dayNumber(end)-7)),heldDay=nextWorkday(dayNumber(grantedDay)+1);
  const submit=async(date,documents=[])=>workflow.submitRequest(pool,{user:user(owner),actor:owner,employeeId:employee.id,data:{request_id:randomUUID(),code:'special',start_date:date,end_date:date,reason,medical_mode:'not_applicable'},documents});
  const granted=await submit(grantedDay,[{file_name:'recovery-evidence.pdf',content_type:'application/pdf',byte_size:evidence.length,sha256:hash(evidence),file_data:evidence}]);
  for(const level of workflow.routeLevels('special')) {
   const request=await workflow.requestView(pool,user(officers[level]),granted.id),stage=request.stages[request.stage_index];
   await workflow.decideRequest(pool,{user:user(officers[level]),actor:officers[level],id:granted.id,data:{stage_id:stage.id,binding_id:stage.binding.id,event_key:randomUUID(),decision:'approved',note:reason,evidence_reviewed:true,justification_accepted:true,source_reference:'Synthetic signed evidence verification'}});
  }
  const held=await submit(heldDay);const grant=await workflow.getRequest(pool,granted.id);assert.equal(grant.status,'approved');assert.ok(grant.final_pdf.length>100);
  const doc=(await pool.query('SELECT id FROM hr_gov_request_documents WHERE request_id=$1',[granted.id])).rows[0];
  const participant=(await pool.query("INSERT INTO public_health_participants(full_name,bank_account_enc,created_by) VALUES('Recovery encrypted demonstration',$1,$2) RETURNING id",[encryptSecret(privateData.encryptedValue),hr.id])).rows[0];
  mkdirSync('/rehearsal/uploads/recovery',{recursive:true});writeFileSync('/rehearsal/uploads/recovery/evidence.pdf',evidence,{mode:0o600});
  const archive=Buffer.from('Synthetic recovery archive file\n');writeFileSync('/rehearsal/uploads/recovery/archive.aba',archive,{mode:0o600});
  await pool.query("INSERT INTO batch_archives(batch_id,root_batch_id,code,file_name,file_path,checksum,file_data,workflow_type,stage,submitted_by) VALUES($1,$1,'RECOVERY-ARCHIVE','recovery.aba','/app/uploads/recovery/archive.aba',$2,$3,'aba','approved',$4)",[randomUUID(),hash(archive),archive,hr.id]);
  const context=await ledger.loadContext(pool,employee.id);
  const session=await createSession(hr.id),existingToken=buildTokenPayload(hr,session.tokenId,session.expiresAt);
  metadata={format:'ron-leave-recovery-fixture-1',existingToken,day,employee_id:employee.id,admin_email:hr.email,granted_id:granted.id,held_id:held.id,document_id:doc.id,participant_id:participant.id,pdf_sha256:hash(grant.final_pdf),evidence_sha256:hash(evidence),archive_sha256:hash(archive),ledger_hash:fingerprint(context.entitlements),posts_count:Number((await pool.query('SELECT count(*)::int AS n FROM hr_gov_job_posts')).rows[0].n)};
  writeFileSync('/rehearsal/runtime/fixture.json',JSON.stringify(metadata,null,2),{mode:0o600});
 } else if(process.argv[2]==='verify') {
  metadata=JSON.parse(readFileSync('/rehearsal/runtime/fixture.json','utf8'));
  const row=(await pool.query('SELECT bank_account_enc FROM public_health_participants WHERE id=$1',[metadata.participant_id])).rows[0];
  assert.ok(row.bank_account_enc.startsWith('v1:'));assert.equal(decryptSecret(row.bank_account_enc),privateData.encryptedValue);
  process.env.DATA_ENC_KEY='0'.repeat(64);const wrongKey=await import('/app/src/services/encryption.js?recovery-wrong-key');assert.equal(wrongKey.decryptSecret(row.bank_account_enc),null);
  assert.equal(hash((await workflow.getRequest(pool,metadata.granted_id)).final_pdf),metadata.pdf_sha256);
  assert.equal(hash(readFileSync('/app/uploads/recovery/evidence.pdf')),metadata.evidence_sha256);assert.equal(hash(readFileSync('/app/uploads/recovery/archive.aba')),metadata.archive_sha256);
  const context=await ledger.loadContext(pool,metadata.employee_id);assert.equal(fingerprint(context.entitlements),metadata.ledger_hash);
  assert.equal(context.entitlements.find(e=>e.code==='special').held,'1.000000');assert.equal(context.entitlements.find(e=>e.code==='special').balance,'2.000000');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_gov_job_posts')).rows[0].n,metadata.posts_count);
  writeFileSync('/rehearsal/verification.json',JSON.stringify({encryption_key_decrypt_roundtrip:true,incorrect_encryption_key_rejected:true,pdf_hash_roundtrip:true,file_storage_hash_roundtrip:true,job_replay_idempotent:true,pending_hold_preserved:true,ledger_unchanged:true}),{mode:0o600});
 } else throw new Error('Choose seed or verify.');
} finally {await pool.end();}

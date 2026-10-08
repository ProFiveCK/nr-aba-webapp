import {withTransaction} from '../lib/transaction.js';
import {ServiceError} from '../lib/serviceError.js';
import {recordAudit} from './auditService.js';
import {central,lockEmployee} from './governmentLeave.js';
import {assertCentral} from './governmentLeaveWorkflow.js';
import {managementReason} from './employeeManagement.js';
const tables={configuration:'hr_gov_workflow_configs',job:'hr_gov_job_plans',opening:'hr_gov_openings',coverage:'hr_gov_assisted_coverage',benefit_reconciliation:'hr_gov_benefit_reconciliations'};
export async function initGovernmentLeaveDraftSchema(client){
 await client.query(`CREATE TABLE IF NOT EXISTS hr_gov_draft_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),kind TEXT NOT NULL CHECK(kind IN ('configuration','job','opening','coverage','benefit_reconciliation')),
 draft_id UUID NOT NULL,employee_id UUID NOT NULL REFERENCES hr_employees(id),revision INTEGER NOT NULL CHECK(revision>0),
 action TEXT NOT NULL CHECK(action IN ('discard','restore')),actor_id UUID NOT NULL REFERENCES reviewers(id),reason TEXT NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(kind,draft_id,revision));
 ALTER TABLE hr_gov_draft_events DROP CONSTRAINT IF EXISTS hr_gov_draft_events_kind_check;
 ALTER TABLE hr_gov_draft_events ADD CONSTRAINT hr_gov_draft_events_kind_check CHECK(kind IN ('configuration','job','opening','coverage','benefit_reconciliation'));
 CREATE TABLE IF NOT EXISTS hr_gov_draft_states(kind TEXT NOT NULL,draft_id UUID NOT NULL,revision INTEGER NOT NULL DEFAULT 0,discarded BOOLEAN NOT NULL DEFAULT FALSE,PRIMARY KEY(kind,draft_id));
 INSERT INTO hr_gov_draft_states(kind,draft_id,revision,discarded) SELECT DISTINCT ON(kind,draft_id) kind,draft_id,revision,action='discard' FROM hr_gov_draft_events ORDER BY kind,draft_id,revision DESC ON CONFLICT(kind,draft_id) DO UPDATE SET revision=EXCLUDED.revision,discarded=EXCLUDED.discarded WHERE hr_gov_draft_states.revision<EXCLUDED.revision;
 CREATE INDEX IF NOT EXISTS idx_hr_gov_draft_events ON hr_gov_draft_events(kind,draft_id,revision DESC);
 DROP TRIGGER IF EXISTS hr_gov_draft_events_immutable ON hr_gov_draft_events;
 CREATE TRIGGER hr_gov_draft_events_immutable BEFORE UPDATE OR DELETE ON hr_gov_draft_events FOR EACH ROW EXECUTE FUNCTION hr_gov_immutable();`);
}
export async function draftState(client,kind,id){
 const {rows:[event]}=await client.query('SELECT * FROM hr_gov_draft_events WHERE kind=$1 AND draft_id=$2 ORDER BY revision DESC LIMIT 1',[kind,id]);
 return {draft_revision:event?.revision||0,discarded:event?.action==='discard',draft_event:event||null};
}
export async function decorateDrafts(client,kind,rows){
 if(!rows.length)return rows;
 const {rows:events}=await client.query('SELECT DISTINCT ON(draft_id) * FROM hr_gov_draft_events WHERE kind=$1 AND draft_id=ANY($2::uuid[]) ORDER BY draft_id,revision DESC',[kind,rows.map(r=>r.id)]);
 const map=new Map(events.map(e=>[e.draft_id,e]));return rows.map(row=>{const e=map.get(row.id);return {...row,draft_revision:e?.revision||0,discarded:e?.action==='discard',draft_event:e||null};});
}
export async function assertDraftUsable(client,kind,id){
 // Lock a mutable gate even when the prepared record itself is immutable. An
 // overlapping repeatable-read approver must retry rather than miss a discard.
 await client.query('INSERT INTO hr_gov_draft_states(kind,draft_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[kind,id]);
 const {rows:[state]}=await client.query('SELECT * FROM hr_gov_draft_states WHERE kind=$1 AND draft_id=$2 FOR UPDATE',[kind,id]);
 if(state.discarded)throw new ServiceError(409,'This draft was discarded. Restore it or prepare a replacement before approval.');
}
export async function changeDraftState(pool,{user,actor,kind,id,data}){
 central(user);if(!tables[kind]||!['discard','restore'].includes(data.action)||!Number.isInteger(data.expected_revision)||data.expected_revision<0)throw new ServiceError(400,'Choose a draft lifecycle action and its current revision.');
 const reason=managementReason(data.reason);
 return withTransaction(pool,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`hr-gov-draft:${kind}:${id}`]);
  await assertCentral(client,user);const {rows:[ref]}=await client.query(`SELECT * FROM ${tables[kind]} WHERE id=$1`,[id]);if(!ref)throw new ServiceError(404,'Draft not found.');
  for(const employeeId of [...(ref.employee_ids||[ref.employee_id])].sort())await lockEmployee(client,employeeId);const {rows:[row]}=await client.query(`SELECT * FROM ${tables[kind]} WHERE id=$1 FOR UPDATE`,[id]);
  const approval=kind==='coverage'?'hr_gov_assisted_coverage_approvals':kind==='benefit_reconciliation'?'hr_gov_benefit_reconciliation_approvals':null;
  const protectedRecord=approval?(await client.query(`SELECT 1 FROM ${approval} WHERE ${kind==='coverage'?'coverage_id':'reconciliation_id'}=$1`,[id])).rowCount>0:row.status!==(kind==='opening'?'preview':'draft');
  if(protectedRecord)throw new ServiceError(409,'Published and certified records cannot be discarded or restored.');
  await client.query('INSERT INTO hr_gov_draft_states(kind,draft_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[kind,id]);
  await client.query('SELECT * FROM hr_gov_draft_states WHERE kind=$1 AND draft_id=$2 FOR UPDATE',[kind,id]);
  const state=await draftState(client,kind,id);if(state.draft_revision!==data.expected_revision)throw new ServiceError(409,'The draft changed. Reload before changing its lifecycle.');
  if(state.discarded===(data.action==='discard'))throw new ServiceError(409,'The draft already has this lifecycle state. Reload it.');
  const {rows:[event]}=await client.query('INSERT INTO hr_gov_draft_events(kind,draft_id,employee_id,revision,action,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[kind,id,row.employee_id||row.employee_ids[0],state.draft_revision+1,data.action,actor.id,reason]);
  await client.query('UPDATE hr_gov_draft_states SET revision=$3,discarded=$4 WHERE kind=$1 AND draft_id=$2',[kind,id,state.draft_revision+1,data.action==='discard']);
  await recordAudit({client,actor,action:`hr.gov.${kind}.draft.${data.action}`,entityType:tables[kind],entityId:id,after:event});return {...row,...await draftState(client,kind,id)};
 });
}

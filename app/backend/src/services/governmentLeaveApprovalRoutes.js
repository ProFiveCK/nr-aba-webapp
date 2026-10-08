import {ServiceError} from '../lib/serviceError.js';
import {withTransaction} from '../lib/transaction.js';
import {recordAudit} from './auditService.js';
import {assertCentral} from './governmentLeaveWorkflow.js';

export const APPROVAL_OFFICES=['division','department','hr_verifier','relevant_secretary','chief_secretary'];
export const OFFICE_LABELS={division:'Divisional approver',department:'Head of Department',hr_verifier:'HR verifier',relevant_secretary:'Relevant Secretary',chief_secretary:'Chief Secretary'};
const fail=(message,status=409)=>{throw new ServiceError(status,message);};
export function legacyRoute(code){return ['division','department','hr_verifier',...(['recreation','medical'].includes(code)?['relevant_secretary']:[]),'chief_secretary'].map(level=>({level,label:OFFICE_LABELS[level]}));}

// A published revision changes future common-leave applications only. Stages
// and the selected revision are retained on the application at submission.
export async function approvalRouteFor(client,departmentId,code){
 const {rows:[route]}=await client.query(`SELECT * FROM hr_gov_approval_routes WHERE department_id=$1 OR department_id IS NULL
   ORDER BY (department_id IS NOT NULL) DESC,recorded_at DESC,id DESC LIMIT 1`,[departmentId||null]);
 return route?{id:route.id,department_id:route.department_id,stages:route.stages,source_reference:route.source_reference,configured:true}:{id:null,department_id:null,stages:legacyRoute(code),configured:false};
}
export async function approvalRouteSettings(client,departmentId){
 const {rows:history}=await client.query(`SELECT r.*,a.display_name AS recorded_by_name FROM hr_gov_approval_routes r JOIN reviewers a ON a.id=r.recorded_by
   WHERE department_id IS NOT DISTINCT FROM $1::uuid ORDER BY recorded_at DESC,id DESC LIMIT 10`,[departmentId||null]);
 return {latest:history[0]||null,effective:await approvalRouteFor(client,departmentId,'recreation'),history};
}
export async function publishApprovalRoute(pool,{user,actor,data}){
 const stages=data.stages;
 if(!Array.isArray(stages)||!stages.length||stages.length>5||stages.some(s=>!s||!APPROVAL_OFFICES.includes(s.level)||typeof s.label!=='string'||s.label.trim().length<3||s.label.length>100)||new Set(stages.map(s=>s.level)).size!==stages.length)fail('Choose one to five distinct approval offices and name each level (3–100 characters).',400);
 for(const [field,min,max] of [['reason',10,1000],['source_reference',5,500]])if(typeof data[field]!=='string'||data[field].trim().length<min||data[field].length>max)fail(`Provide a valid ${field.replaceAll('_',' ')}.`,400);
 return withTransaction(pool,async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext('hr-approval-assignments'))");await assertCentral(client,user);
  if(data.department_id&&!(await client.query('SELECT 1 FROM hr_departments WHERE id=$1',[data.department_id])).rowCount)fail('Choose a managed department.',400);
  const current=await approvalRouteSettings(client,data.department_id);
  if((current.latest?.id||null)!==(data.expected_latest_id||null))fail('The approval route changed. Reload and review the latest revision.');
  const {rows:[route]}=await client.query('INSERT INTO hr_gov_approval_routes(department_id,stages,source_reference,recorded_by,reason,supersedes_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[data.department_id||null,JSON.stringify(stages.map(s=>({level:s.level,label:s.label.trim()}))),data.source_reference.trim(),user.id,data.reason.trim(),current.latest?.id||null]);
  await recordAudit({client,actor,action:'hr.gov.approval_route.published',entityType:'hr_gov_approval_routes',entityId:route.id,after:route});return route;
 });
}

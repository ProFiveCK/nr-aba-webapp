import {paternityBalance} from '../lib/governmentLeavePaternity.js';
import {ServiceError} from '../lib/serviceError.js';

export async function loadPaternityRequests(client,employeeId){
 const {rows}=await client.query(`SELECT r.id,r.status,to_char(r.start_date,'YYYY-MM-DD') AS start_date,to_char(r.end_date,'YYYY-MM-DD') AS end_date,r.application_snapshot,r.grant_snapshot,
   (SELECT effect FROM hr_gov_case_effects ce WHERE ce.original_request_id=r.id ORDER BY version DESC LIMIT 1) AS effect
   FROM hr_gov_requests r WHERE r.employee_id=$1 AND r.code='paternity' AND r.status IN ('pending','approved')
   UNION ALL SELECT legacy.id,legacy.status,to_char(legacy.start_date,'YYYY-MM-DD'),to_char(legacy.end_date,'YYYY-MM-DD'),NULL::jsonb,NULL::jsonb,NULL::jsonb
   FROM hr_leave_applications legacy JOIN hr_leave_types t ON t.id=legacy.leave_type_id
   WHERE legacy.employee_id=$1 AND legacy.status IN ('pending','approved') AND lower(t.name) IN ('paternity','paternity leave')
   AND NOT EXISTS(SELECT 1 FROM hr_gov_legacy_transfers transfer WHERE transfer.legacy_request_id=legacy.id AND transfer.approval_preserved)`,[employeeId]);
 return rows;
}

export async function paternityRequestBalance(client,context,request,{enforce=false,asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Pacific/Nauru'}).format(new Date())}={}){
 const evaluation=request.grant_snapshot?.evaluation||request.application_snapshot.evaluation;
 const requests=await loadPaternityRequests(client,request.employee_id);
 const result=paternityBalance(context,{requests,evaluation,requestId:request.id,status:request.status,asOf,effect:requests.find(r=>r.id===request.id)?.effect});
 if(enforce&&(!result.periods.length||result.periods.some(p=>p.requested_days<=0||p.available_after_approval<0)))throw new ServiceError(409,'Paternity leave is limited to 10 working days per employee service year, including other approved and pending applications. Review the dates and available balance.');
 return result;
}

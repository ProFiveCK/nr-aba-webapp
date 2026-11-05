import {ServiceError} from '../lib/serviceError.js';
const fail=(message,status=409)=>{throw new ServiceError(status,message);};
// Earlier approved reconciliations still adjust an employee's benefit baseline.
export async function benefitBasisFor(client,employeeId){
 const original=(await client.query('SELECT * FROM hr_gov_benefit_bases WHERE employee_id=$1 ORDER BY id',[employeeId])).rows;
 if(original.length>1)fail('Reconcile multiple historic benefit bases before new commitments.');if(!original.length)return null;
 const revision=(await client.query('SELECT r.* FROM hr_gov_benefit_reconciliations r JOIN hr_gov_benefit_reconciliation_approvals a ON a.reconciliation_id=r.id WHERE r.employee_id=$1 ORDER BY r.recorded_at DESC,r.id DESC LIMIT 1',[employeeId])).rows[0];
 return revision?{...original[0],service_basis_id:revision.service_basis_id,source_reference:revision.history_reference,prior_units:revision.prior_units,transition_reference:revision.transition_reference,reconciliation_id:revision.id}:original[0];
}

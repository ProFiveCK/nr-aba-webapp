import {ServiceError} from '../lib/serviceError.js';
import {units,decimal} from '../lib/governmentLeaveRules.js';

const fail=message=>{throw new ServiceError(409,message);};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A certified transfer preserves remaining credit once. It does not change
// the policy's future annual grants, Medical occasions or Recreation accrual cap.
export function creditLimit(account,standard,medicalHistory=0n) {
  const normal=units(standard),retained=units(account?.retained_credit||'0');
  const protectedTotal=retained>0n?retained+medicalHistory:0n;
  return protectedTotal>normal?protectedTotal:normal;
}

export function retainedTarget(state,target,cutover,account) {
  const ids=target.retained_balance_ids??[];
  if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||!uuid.test(id))||new Set(ids).size!==ids.length)fail('Select distinct existing balance rows for the one-time transfer.');
  if(!ids.length)return null;
  if(state.initial_setup?.status!=='adopted')fail('Adopt the reviewed leave-type mappings before transferring existing credit.');
  if((state.credit_transfers||[]).some(t=>t.code===target.code))fail('Existing credit for this leave type has already been transferred. Use an audited reconciliation instead.');
  if(state.configs.some(c=>c.status==='published'&&c.enabled_codes.includes(target.code))||account&&state.movements.some(m=>m.entitlement_id===account.id&&!['opening','correction'].includes(m.kind)))fail('Transfer existing credit before this Government leave type starts operating.');
  if(account&&units(account.held)>0n)fail('Resolve Government holds before the initial credit transfer.');
  const rows=ids.map(id=>{
    const row=state.historical_balances.find(b=>b.id===id);
    if(!row||row.employee_id!==state.context.employee.id)fail('Every selected balance must belong to this employee.');
    if(state.initial_setup.mappings.find(m=>m.leave_type_id===row.leave_type_id)?.code!==target.code)fail('Selected balances must match the adopted Government leave-type mapping.');
    if(row.leave_type_active===false)fail('An inactive historical type is not a current credit source. Reconcile its transition explicitly.');
    const latestYear=Math.max(...state.historical_balances.filter(b=>b.leave_type_id===row.leave_type_id&&b.year<=Number(cutover.slice(0,4))).map(b=>b.year));
    if(row.year!==latestYear)fail('Select the latest retained balance for each type; do not add old annual snapshots.');
    if(row.year>Number(cutover.slice(0,4))||units(row.balance)<0n)fail('Reconcile future or negative source balances before cutover.');
    if((state.credit_transfers||[]).some(t=>t.source_balance_ids.includes(id)))fail('A source balance has already been transferred.');
    return row;
  });
  // Pending amounts are reservations within the balance, never extra credit.
  const amount=rows.reduce((sum,row)=>sum+units(row.balance),0n);
  if(amount<=0n||amount!==units(target.amount))fail('The protected target must equal the full credited balance of the selected rows, without adding pending days.');
  return {amount:decimal(amount),source_balance_ids:[...ids].sort()};
}

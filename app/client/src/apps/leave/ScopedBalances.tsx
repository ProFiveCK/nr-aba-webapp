import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { csvCell } from '../../lib/csv';
import { Button, LoadingState } from '../../components/Ui';
import { ActionDialog, Field, inputClass } from './ManagementFields';
import { value } from './managementForm';
import type { StaffBalanceRow, StaffBalancesResponse } from './staffTypes';

export function ScopedBalances() {
    const [report,setReport] = useState<StaffBalancesResponse | null>(null), [types,setTypes] = useState<{id:string;name:string}[]>([]);
    const [busy,setBusy] = useState(true), [error,setError] = useState(''), [employee,setEmployee] = useState<StaffBalanceRow | null>(null);
    const load = useCallback(async () => { setBusy(true); setError(''); try { const [balances,leaveTypes] = await Promise.all([apiClient.get<StaffBalancesResponse>('/hr/employees/balances'),apiClient.get<{id:string;name:string}[]>('/hr/leave-types')]); setReport(balances); setTypes(leaveTypes); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }, []);
    useEffect(() => { void load(); }, [load]);
    function exportBalances() {
        if (!report) return;
        const rows = [['Employee','Department','Division',...report.leave_types],...report.employees.map(row=>[row.display_name,row.department_code||'',row.division_code||'',...report.leave_types.map(name=>String((row.balances[name]?.balance || 0)-(row.balances[name]?.pending || 0)))])];
        const url=URL.createObjectURL(new Blob([rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`scoped-leave-balances-${report.year}.csv`;link.click();URL.revokeObjectURL(url);
    }
    return <section className="app-panel space-y-4 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-lg font-semibold">Balances within your assigned scope</h3><p className="text-sm text-gray-600">{report?.year} · {report?.employees.length || 0} active employees. Available days exclude pending holds.</p></div><div className="flex gap-2"><Button variant="secondary" disabled={busy} onClick={() => void load()}>Refresh balances</Button><Button variant="secondary" disabled={!report || busy} onClick={exportBalances}>Export balances CSV</Button></div></div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{busy ? <LoadingState label="Loading assigned balances…" /> : <>
            {!report?.employees.length && <p className="text-sm text-gray-500">No active employees are visible under your balance assignments.</p>}
            {report?.employees.map(row=><article key={row.id} className="space-y-2 rounded-lg border border-gray-200 p-3"><div className="flex flex-wrap justify-between gap-2"><div><h4 className="font-semibold">{row.display_name}</h4><p className="text-sm text-gray-600">{row.department_code} / {row.division_code || 'No division'}</p></div><Button variant="secondary" onClick={()=>setEmployee(row)}>Correct balance for {row.display_name}</Button></div><p className="text-xs text-gray-600">{report.leave_types.map(name=>`${name}: ${Number(((row.balances[name]?.balance || 0)-(row.balances[name]?.pending || 0)).toFixed(2))}`).join(' · ')}</p></article>)}
        </>}
        {employee && <ActionDialog title="Record balance correction" description={employee.display_name} onClose={()=>setEmployee(null)} onSave={async form=>{
            await apiClient.post('/hr/adjustments',{employee_id:employee.id,leave_type_id:value(form,'leave_type_id'),amount:Number(value(form,'amount')),year:report?.year,reason:value(form,'reason')});setEmployee(null);await load();
        }}><p className="text-sm text-gray-600">Record a signed change to the historical balance with verified evidence. This does not certify government opening balances or enable the new policy engine.</p><Field label="Leave type"><select className={inputClass} name="leave_type_id" required><option value="">Choose leave type</option>{types.map(type=><option key={type.id} value={type.id}>{type.name}</option>)}</select></Field><Field label="Days to add or subtract"><input type="number" className={inputClass} name="amount" step="0.01" required /></Field></ActionDialog>}
    </section>;
}

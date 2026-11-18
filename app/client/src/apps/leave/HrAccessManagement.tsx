import { formatDate } from '../../lib/date';
import { AustralianDateInput } from '../../components/AustralianDateInput';
import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { todayIsoDate } from '../../lib/date';
import { Button, Pager } from '../../components/Ui';
import { ActionDialog, DirectoryPicker, Field, PlacementFields, inputClass } from './ManagementFields';
import { value } from './managementForm';
import type { OrgDepartment } from './types';

type Assignment = { id: string; account_name: string; account_email: string; account_status: string; department_name: string; division_name: string | null; capabilities: string[]; effective_from: string; effective_to: string | null; revoked_at: string | null; reason: string; revoke_reason: string | null };
export function HrAccessManagement({ departments }: { departments: OrgDepartment[] }) {
    const [data, setData] = useState<{ assignments: Assignment[]; total: number; page_size: number }>({ assignments: [], total: 0, page_size: 50 });
    const [page, setPage] = useState(0), [version, setVersion] = useState(0), [search, setSearch] = useState(''), [query, setQuery] = useState(''), [error, setError] = useState('');
    const [adding, setAdding] = useState(false), [revoking, setRevoking] = useState<Assignment | null>(null);
    useEffect(() => { let live = true; void apiClient.get<typeof data>(`/hr/access-scopes?page=${page + 1}&search=${encodeURIComponent(search)}`).then(response => { if (live) { setData(response); setError(''); } }).catch((err: Error) => { if (live) setError(err.message); }); return () => { live = false; }; }, [page, version, search]);
    return <section className="app-panel space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">HR officers</h3><p className="mt-1 text-sm text-gray-600">An HR officer manages staff records, leave balances and reports for one department or division. Approvers are nominated separately, under Organisation &amp; approvers.</p></div><Button onClick={() => setAdding(true)}>Add HR officer</Button></div>
        <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">This is the only place departmental HR access is given; there is nothing to tick on the account page. Central HR accounts already cover every department. Changes end the affected account's sessions.</p>
        <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); setSearch(query.trim()); setPage(0); }}><Field label="Search HR officers"><input className={inputClass} maxLength={100} value={query} onChange={e => setQuery(e.target.value)} placeholder="Individual name or email" /></Field><Button type="submit" variant="secondary">Search HR officers</Button></form>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {!data.assignments.length && <p className="text-sm text-gray-500">No HR officers match.</p>}
        {data.assignments.map(item => <article key={item.id} className="space-y-2 rounded-lg border border-gray-200 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h4 className="break-words font-semibold">{item.account_name}</h4><p className="break-words text-sm text-gray-600">{item.account_email} · {item.account_status}</p><p className="text-sm">{item.department_name} / {item.division_name || 'All divisions'}</p></div>{!item.revoked_at && <Button variant="secondary" onClick={() => setRevoking(item)}>Remove</Button>}</div>
            <p className="text-xs text-gray-500">{formatDate(item.effective_from)} → {item.effective_to ? formatDate(item.effective_to) : 'Open'} · {item.revoked_at ? 'Revoked' : item.effective_from > todayIsoDate() ? 'Upcoming' : item.effective_to && item.effective_to < todayIsoDate() ? 'Expired' : 'Effective now'}</p><p className="break-words text-xs text-gray-500">Authority recorded: {item.reason}{item.revoke_reason ? ` · Revocation: ${item.revoke_reason}` : ''}</p>
        </article>)}
        <Pager page={page} pageCount={Math.ceil(data.total / 50)} total={data.total} pageSize={50} setPage={setPage} />
        {adding && <ActionDialog title="Add HR officer" onClose={() => setAdding(false)} onSave={async form => {
            const account = value(form, 'reviewer_id');
            if (!account) throw new Error('Choose an individual account.');
            await apiClient.post('/hr/access-scopes', { reviewer_id: account, department_id: value(form,'department_id'), division_id: value(form,'division_id') || null, effective_from: value(form,'effective_from'), effective_to: value(form,'effective_to') || null, reason: value(form,'reason') }); setAdding(false); setPage(0); setVersion(current => current + 1);
        }}><DirectoryPicker kind="accounts" name="reviewer_id" label="Individual account" allowLinkedAccounts /><PlacementFields departments={departments} /><p className="text-xs text-gray-500">No division selection means all divisions in the selected department. This does not grant central HR or finance access.</p><p className="text-sm text-gray-700">They will manage staff records, leave balances and reports for this unit.</p><div className="grid gap-3 sm:grid-cols-2"><Field label="Access begins"><AustralianDateInput  name="effective_from" className={inputClass} defaultValue={todayIsoDate()} required /></Field><Field label="Access ends (optional)"><AustralianDateInput  name="effective_to" className={inputClass} /></Field></div><p className="text-xs text-gray-500">Dates are inclusive. Leave decisions and their supporting evidence go to the nominated approvers, not HR officers.</p></ActionDialog>}
        {revoking && <ActionDialog title="Remove HR officer" description={`${revoking.account_name} · ${revoking.department_name}`} onClose={() => setRevoking(null)} onSave={async form => { await apiClient.post(`/hr/access-scopes/${revoking.id}/revoke`, { reason: value(form,'reason') }); setRevoking(null); setVersion(current => current + 1); }}><p className="text-sm text-gray-600">This removes this assignment immediately and ends the account's sessions. Other active assignments remain in force; the history is retained.</p></ActionDialog>}
    </section>;
}

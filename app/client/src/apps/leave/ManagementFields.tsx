import { cloneElement, useCallback, useEffect, useId, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Button, Modal, Pager } from '../../components/Ui';
import { apiClient } from '../../lib/api';
import type { OrgDepartment } from './types';
import { ReviewRecordName } from './ReviewRecordName';
import { divisionPath, orderedDivisions } from './organisationBrowse';
import { reviewRecordLabel } from './reviewRecordNames';

export const inputClass = 'w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand/30';
export function Field({ label, children }: { label: string; children: ReactElement<{ id?: string }> }) {
    const id = useId();
    return <div className="min-w-0 space-y-1 text-sm font-medium text-gray-700"><label className="block" htmlFor={id}>{label}</label>{cloneElement(children, { id })}</div>;
}
export function ReasonField({defaultValue}:{defaultValue?:string}={}) { return <Field label="Verification reason"><textarea name="reason" defaultValue={defaultValue} required minLength={10} maxLength={1000} rows={3} className={inputClass} placeholder="Record the evidence or authority checked (at least 10 characters)." /></Field>; }
export function ActionDialog({ title, description, onClose, onSave, children, defaultReason, automaticReason, saveLabel = 'Save verified change' }: { title: string; description?: string; onClose: () => void; onSave: (data: FormData) => Promise<void>; children: ReactNode; defaultReason?:string; automaticReason?:string; saveLabel?: string }) {
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    return <Modal title={title} description={description} onClose={onClose} closeDisabled={busy} size="xl">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (busy) return; const data = new FormData(e.currentTarget); if (automaticReason) { const note = String(data.get('setup_note') || '').trim(); data.set('reason', automaticReason + (note ? ` · ${note}` : '')); } setBusy(true); setError(''); void onSave(data).catch((err: Error) => setError(err.message || 'Unable to save the change.')).finally(() => setBusy(false)); }}>
            <fieldset disabled={busy} className="min-w-0 space-y-4">{children}<>{automaticReason ? <details><summary className="cursor-pointer text-sm text-gray-600">Add a note (optional)</summary><div className="mt-3"><Field label="Note (optional)"><textarea name="setup_note" maxLength={800} rows={3} className={inputClass} /></Field></div></details> : <ReasonField defaultValue={defaultReason} />}</></fieldset>
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{saveLabel}</Button></div>
        </form>
    </Modal>;
}
export function PlacementFields({ departments, initialDepartment = '', initialDivision = '' }: { departments: OrgDepartment[]; initialDepartment?: string; initialDivision?: string }) {
    const [department, setDepartment] = useState(initialDepartment), [division, setDivision] = useState(initialDivision);
    return <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Field label="Department"><select name="department_id" className={inputClass} required value={department} onChange={(e) => { setDepartment(e.target.value); setDivision(''); }}><option value="">Choose department</option>{departments.map((item) => <option key={item.id} value={item.id}>{reviewRecordLabel(item.name)}</option>)}</select></Field>
        <Field label="Division"><select name="division_id" className={inputClass} value={division} onChange={(e) => setDivision(e.target.value)}><option value="">No division assigned</option>{orderedDivisions(departments.find((item) => item.id === department)?.divisions||[]).map((item) => <option key={item.id} value={item.id}>{reviewRecordLabel(divisionPath(item))}</option>)}</select></Field>
    </div>;
}

type Choice = { id: string; display_name: string; status: string; account_type?: string; reviewer_id?: string | null; department_code?: string | null; external_ids?: { external_id: string }[]; email?: string | null; login_alias?: string | null; employee_id?: string | null; employee_name?: string | null };
/** Explicit selection from bounded server pages, never matching by a name automatically. */
export function DirectoryPicker({ kind = 'employees', name, label, initialId = '', initialLabel = '', employeeId, requireLinked = false, allowClear = false, allowLinkedAccounts = false, allowInactive = false }: {
    kind?: 'employees' | 'accounts'; name: string; label: string; initialId?: string; initialLabel?: string; employeeId?: string; requireLinked?: boolean; allowClear?: boolean; allowLinkedAccounts?: boolean; allowInactive?: boolean;
}) {
    const [selected, setSelected] = useState(initialId), [selectedLabel, setSelectedLabel] = useState(initialLabel);
    const [search, setSearch] = useState(''), [appliedSearch, setAppliedSearch] = useState('');
    const [data, setData] = useState<{ rows: Choice[]; total: number; page: number }>({ rows: [], total: 0, page: 1 });
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const load = useCallback(async (page: number, query: string) => {
        setBusy(true); setError('');
        try {
            const response = await apiClient.get<{ employees?: Choice[]; accounts?: Choice[]; total: number; page: number }>(`/hr/directory${kind === 'accounts' ? '/accounts' : ''}?page=${page}&search=${encodeURIComponent(query)}&page_size=50`);
            setData({ rows: response.employees || response.accounts || [], total: response.total, page: response.page }); setAppliedSearch(query);
        } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
    }, [kind]);
    useEffect(() => { void load(1, ''); }, [load]);
    return <div className="min-w-0 space-y-2">
        <p className="text-sm font-medium text-gray-700">{label}</p><input type="hidden" name={name} value={selected} />
        <p className="break-words text-sm text-gray-600">Selected: {selected ? <ReviewRecordName name={selectedLabel || 'Current verified record'}/> : 'None'}</p>
        <div className="flex min-w-0 flex-wrap gap-2"><input aria-label={`Search ${label.toLowerCase()}`} className={`${inputClass} flex-1 basis-48`} maxLength={100} placeholder={kind === 'accounts' ? 'Account name, email or exact Payroll alias' : 'Name or exact Payroll ID'} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!busy) void load(1, search.trim()); } }} /><Button variant="secondary" disabled={busy} onClick={() => void load(1, search.trim())}>Search</Button>
            {allowClear && <Button variant="secondary" disabled={busy} onClick={() => { setSelected(''); setSelectedLabel(''); }}>Clear selection</Button>}
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div aria-busy={busy} className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
            {busy ? <p className="p-2 text-sm text-gray-500">Loading choices…</p> : !data.rows.length ? <p className="p-2 text-sm text-gray-500">No matching records.</p> : data.rows.map((row) => {
                const blocked = (row.status !== 'active' && !allowInactive) || (kind === 'accounts' && !allowLinkedAccounts && !!row.employee_id && row.employee_id !== employeeId) || (kind === 'employees' && (row.id === employeeId || (requireLinked && !row.reviewer_id)));
                return <label key={row.id} className={`flex items-start gap-2 rounded-lg p-2 text-sm ${blocked ? 'bg-gray-50 text-gray-500' : 'cursor-pointer text-gray-800 hover:bg-blue-50'}`}>
                    <input className="mt-1" type="radio" name={`${name}_choice`} checked={selected === row.id} disabled={busy || blocked} onChange={() => { setSelected(row.id); setSelectedLabel(row.display_name); }} />
                    <span className="min-w-0 break-words"><ReviewRecordName name={row.display_name}/> · {row.email || row.login_alias || row.department_code || (kind==='accounts' ? 'No individual email' : 'Department unverified')}{row.external_ids?.length ? ` · ${row.external_ids.map((entry) => entry.external_id).join(', ')}` : ''}
                        {kind === 'accounts' ? row.account_type === 'employee' ? ' · Employee-only login' : ' · Existing staff login' : ''}
                        {row.status !== 'active' ? ' · Inactive' : !allowLinkedAccounts && row.employee_id && row.employee_id !== employeeId ? ` · Linked to ${row.employee_name}` : requireLinked && !row.reviewer_id ? ' · Needs verified login' : ''}</span>
                </label>;
            })}
        </div>
        <Pager page={data.page - 1} pageCount={Math.ceil(data.total / 50)} total={data.total} pageSize={50} setPage={(page) => { if (!busy) void load(page + 1, appliedSearch); }} />
    </div>;
}

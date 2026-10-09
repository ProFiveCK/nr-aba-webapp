import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { useConfirm } from '../../contexts/useConfirm';
import { Button, LoadingState, Modal, Pager } from '../../components/Ui';
import { Field, inputClass } from './ManagementFields';
import { filterDepartments, organisationPage, orderedDivisions } from './organisationBrowse';
import type { OrgDepartment } from './types';

/** Browse the existing organisation reference data; only one department is expanded at a time. */
export function OrgUnits({ onChanged, onManageOffices }: { onChanged?: () => void; onManageOffices?: (departmentId: string) => void } = {}) {
    const { addToast } = useToast();
    const { confirm } = useConfirm();
    const [departments, setDepartments] = useState<OrgDepartment[]>([]);
    const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState('');
    const [search, setSearch] = useState(''), [page, setPage] = useState(0), [selectedId, setSelectedId] = useState('');
    const [dialog, setDialog] = useState<{ kind: 'department' | 'division'; department?: OrgDepartment; parentDivisionId?: string } | null>(null);
    const [name, setName] = useState(''), [dialogError, setDialogError] = useState('');
    const load = useCallback(async () => {
        try { setDepartments((await apiClient.get<OrgDepartment[]>('/hr/org-units')) || []); setError(''); }
        catch (err) { setError((err as Error).message || 'Unable to load departments.'); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { void load(); }, [load]);
    const matches = filterDepartments(departments, search);
    const result = organisationPage(matches, page);
    const selected = departments.find((department) => department.id === selectedId);
    async function run(action: () => Promise<unknown>, success: string) {
        setSaving(true);
        try { await action(); await load(); onChanged?.(); addToast(success, 'success'); }
        finally { setSaving(false); }
    }
    function show(kind: 'department' | 'division', department?: OrgDepartment, parentDivisionId?: string) { setName(''); setDialogError(''); setDialog({ kind, department, parentDivisionId }); }
    async function save() {
        if (!dialog || !name.trim()) return;
        setDialogError('');
        try {
            await run(() => dialog.kind === 'department'
                ? apiClient.post('/hr/departments', { name: name.trim() })
                : apiClient.post(`/hr/departments/${dialog.department!.id}/divisions`, { name: name.trim(), parent_division_id: dialog.parentDivisionId || null }),
            dialog.kind === 'department' ? 'Department added.' : 'Division added.');
            setDialog(null);
        } catch (err) { setDialogError((err as Error).message || 'Unable to save this name.'); }
    }
    async function remove(kind: 'department' | 'division', id: string, label: string) {
        if (!(await confirm(`Remove ${kind} "${label}"? Anything still assigned to staff cannot be removed.`))) return;
        try {
            await run(() => apiClient.delete(`/hr/${kind === 'department' ? 'departments' : 'divisions'}/${id}`), `${kind === 'department' ? 'Department' : 'Division'} removed.`);
            if (kind === 'department') setSelectedId('');
        } catch (err) { addToast((err as Error).message || 'Unable to remove this record.', 'error'); }
    }
    return <section className="app-panel space-y-4 p-4 sm:p-5" aria-label="Departments and divisions">
        <div className="flex flex-wrap items-end justify-between gap-3">
            <Field label="Find a department or division"><input className={inputClass} type="search" maxLength={100} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search existing names" /></Field>
            <Button onClick={() => show('department')} disabled={saving}>Add department</Button>
        </div>
        <p className="text-sm text-gray-500">{departments.length} departments · Select one to manage its divisions. Add a division under its parent unit, such as Finance → Treasury → Financial Systems. Staff placement is selected separately.</p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {loading ? <LoadingState label="Loading departments…" /> : <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(16rem,1fr)_minmax(0,1.5fr)]">
            <div className="min-w-0">
                <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200" aria-label="Department list">
                    {result.rows.map((department) => <li key={department.id}><button type="button" aria-pressed={selectedId === department.id} onClick={() => setSelectedId(department.id)} className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-brand ${selectedId === department.id ? 'bg-blue-50 text-brand' : 'hover:bg-gray-50'}`}><span className="min-w-0 break-words font-medium">{department.name}</span><span className="shrink-0 text-xs text-gray-500">{department.divisions.length} divisions</span></button></li>)}
                </ul>
                {!result.total && <p className="py-6 text-sm text-gray-500">{departments.length ? 'No matching departments or divisions.' : 'No departments recorded yet.'}</p>}
                <Pager {...result} setPage={setPage} />
            </div>
            <div className="min-w-0 rounded-lg border border-gray-200 p-4">
                {selected ? <>
                    <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="min-w-0 break-words text-base font-semibold">{selected.name}</h3><Button variant="secondary" disabled={saving} onClick={() => show('division', selected)}>Add division</Button></div>
                    <p className="mt-2 text-sm text-gray-500">{selected.divisions.length} divisions</p>
                    <ul className="mt-3 max-h-80 divide-y divide-gray-100 overflow-y-auto">{orderedDivisions(selected.divisions).map((division) => <li key={division.id} className="flex items-center justify-between gap-3 py-3 text-sm"><div className="min-w-0"><span className={`block break-words ${division.parent_division_id?'pl-5':'font-medium'}`}>{division.parent_division_id?'↳ ':''}{division.name}</span>{!division.parent_division_id&&<Button variant="secondary" disabled={saving} onClick={()=>show('division',selected,division.id)}>Add division under {division.name}</Button>}</div><button type="button" disabled={saving} onClick={() => void remove('division', division.id, division.name)} aria-label={`Remove ${division.name}`} className="shrink-0 rounded px-2 py-1 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">Remove</button></li>)}</ul>
                    {!selected.divisions.length && <p className="py-6 text-sm text-gray-500">No divisions recorded.</p>}
                    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">{onManageOffices && <Button variant="secondary" onClick={() => onManageOffices(selected.id)}>Manage leave approvers</Button>}<button type="button" disabled={saving || selected.divisions.length > 0} onClick={() => void remove('department', selected.id, selected.name)} className="rounded px-2 py-1 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">Remove department</button></div>
                    <p className="mt-2 text-xs text-gray-500">Remove divisions first. Records still assigned to staff cannot be removed.</p>
                </> : <p className="py-12 text-center text-sm text-gray-500">Select a department to view and manage its divisions.</p>}
            </div>
        </div>}
        {dialog && <Modal title={dialog.kind === 'department' ? 'Add department' : dialog.parentDivisionId?`Add division under ${dialog.department?.divisions.find(d=>d.id===dialog.parentDivisionId)?.name}`:`Add division to ${dialog.department?.name}`} onClose={() => setDialog(null)} closeDisabled={saving} size="md"><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (!saving) void save(); }}>{dialog.kind==='division'&&<Field label="Parent unit"><select className={inputClass} disabled={saving} value={dialog.parentDivisionId||''} onChange={e=>setDialog({...dialog,parentDivisionId:e.target.value||undefined})}><option value="">Directly under {dialog.department?.name}</option>{dialog.department?.divisions.filter(d=>!d.parent_division_id).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>}<Field label={dialog.kind === 'department' ? 'Department name' : 'Division name'}><input className={inputClass} value={name} maxLength={60} required autoFocus disabled={saving} onChange={(event) => setName(event.target.value)} /></Field>{dialogError && <p role="alert" className="text-sm text-red-700">{dialogError}</p>}<div className="flex justify-end gap-2"><Button variant="secondary" disabled={saving} onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" loading={saving} disabled={!name.trim()}>Save</Button></div></form></Modal>}
    </section>;
}

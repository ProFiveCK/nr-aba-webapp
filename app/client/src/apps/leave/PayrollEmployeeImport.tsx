import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../../lib/api';
import { todayIsoDate } from '../../lib/date';
import { useConfirm } from '../../contexts/useConfirm';
import { Modal, Pager } from '../../components/Ui';
import type { PayrollImportBatch, PayrollImportCandidate, PayrollImportDecision, PayrollImportResult, PayrollImportRow, PayrollImportView } from './payrollImportTypes';

const ROOT = '/hr/directory/imports';
const button = 'rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed';
const control = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm';
const names: Record<string, string> = { display_name: 'Name', status: 'Status', department_code: 'Department', division_code: 'Division', email: 'Contact email', position_title: 'Position', manager_id: 'Manager' };
const decisionLabel = { create: 'Create employee', update: 'Update employee', review: 'Identity review', skip: 'Skip row' };

export function PayrollEmployeeImport({ onApplied }: { onApplied: () => void }) {
    const { confirm } = useConfirm();
    const [file, setFile] = useState<File | null>(null);
    const [exportDate, setExportDate] = useState(todayIsoDate);
    const [view, setView] = useState<PayrollImportView | null>(null);
    const [history, setHistory] = useState<{ batches: PayrollImportBatch[]; total: number; page: number; page_size: number } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [reviewed, setReviewed] = useState(false);
    const [note, setNote] = useState('');
    const [editing, setEditing] = useState<PayrollImportRow | null>(null);
    const requestNumber = useRef(0);
    const resetReview = () => { setReviewed(false); setNote(''); };
    async function loadHistory(page = 1) { setHistory(await apiClient.get(`${ROOT}?page=${page}`)); }
    useEffect(() => { void loadHistory().catch((err: Error) => setError(err.message)); }, []);

    async function run(action: () => Promise<void>) {
        if (busy) return;
        setBusy(true); setError('');
        try { await action(); } catch (err) { setError((err as Error).message || 'Unable to complete the import action.'); }
        finally { setBusy(false); }
    }
    async function loadBatch(id: string, page = 1, filter = 'all') {
        const request = ++requestNumber.current;
        const next = await apiClient.get<PayrollImportView>(`${ROOT}/${id}?page=${page}&filter=${filter}`);
        if (request === requestNumber.current) { setView(next); resetReview(); }
    }
    async function downloadTemplate() {
        const blob = await apiClient.getBlob(`${ROOT}/template`);
        const url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = 'payroll-employee-import-v1.csv'; link.click(); URL.revokeObjectURL(url);
    }
    const applied = view?.batch.status === 'applied';
    return <section className="app-panel space-y-4 p-4 sm:p-5" aria-label="Payroll employee import" aria-busy={busy}>
        <div>
            <h3 className="text-lg font-semibold text-gray-900">Import Payroll employees</h3>
            <p className="mt-1 text-sm text-gray-600">Upload the employee export, review proposed changes and resolve identity conflicts. Preview saves a review batch; employees change only when you apply it.</p>
            <p className="mt-1 text-xs text-gray-500">Up to 3,000 employees · UTF-8 CSV, maximum 2 MiB · Login provisioning and opening balances are separate HR steps.</p>
        </div>
        <fieldset disabled={busy} className="flex min-w-0 flex-wrap items-end gap-3">
            <button type="button" className={button} onClick={() => void run(downloadTemplate)}>Download Payroll template</button>
            <label className="min-w-0 w-full text-sm font-medium text-gray-700 sm:min-w-60 sm:flex-1">Employee CSV
                <input className={`${control} mt-1`} type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            <label className="text-sm font-medium text-gray-700">Payroll export date
                <input className={`${control} mt-1`} type="date" value={exportDate} onChange={(e) => setExportDate(e.target.value)} />
            </label>
            <button type="button" className={`${button} bg-brand text-white hover:bg-brand-dark`} disabled={!file || !exportDate} onClick={() => void run(async () => {
                if (!file) return;
                if (file.size > 2 * 1024 * 1024) throw new Error('Choose a CSV file of 2 MiB or less.');
                const csv = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
                setView(await apiClient.post<PayrollImportView>(`${ROOT}/preview`, { csv, file_name: file.name, export_date: exportDate }));
                resetReview(); await loadHistory();
            })}>Preview export</button>
        </fieldset>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {view && <div className="space-y-3 border-t border-gray-200 pt-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><h4 className="break-all font-semibold text-gray-900">{view.batch.file_name}</h4>
                    <p className="text-sm text-gray-600">Exported {view.batch.export_date.slice(0, 10)} · {view.batch.row_count} employees · {applied ? 'Applied' : 'Awaiting review'}</p>
                </div>
                {!applied && <button type="button" className={button} disabled={busy} onClick={() => void run(async () => {
                    const next = await apiClient.post<PayrollImportView>(`${ROOT}/${view.batch.id}/refresh`, { revision: view.batch.revision });
                    setView(next); resetReview();
                })}>Refresh current data</button>}
            </div>
            {applied && view.batch.result ? <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
                Import complete: {view.batch.result.created} created, {view.batch.result.updated} updated, {view.batch.result.unchanged} unchanged, {view.batch.result.skipped} skipped. {view.batch.result.service_periods_added} appointment records added.
            </p> : <div className="flex flex-wrap gap-2 text-sm">
                <span className="rounded-lg bg-green-50 px-3 py-2 text-green-800">{view.summary.ready} ready ({view.summary.create} new, {view.summary.update} existing)</span>
                <span className="rounded-lg bg-red-50 px-3 py-2 text-red-800">{view.summary.blocked} blocked</span>
                <span className="rounded-lg bg-gray-100 px-3 py-2 text-gray-700">{view.summary.skipped} skipped</span>
            </div>}
            <label className="flex items-center gap-2 text-sm text-gray-700">Show rows
                <select className="rounded-lg border border-gray-300 px-3 py-2" disabled={busy} value={view.filter} onChange={(e) => void run(() => loadBatch(view.batch.id, 1, e.target.value))}>
                    {(applied ? ['all', 'applied', 'skipped'] : ['all', 'blocked', 'ready', 'skipped']).map((filter) => <option key={filter} value={filter}>{filter[0].toUpperCase() + filter.slice(1)}</option>)}
                </select>
            </label>
            <div className="max-h-[36rem] space-y-2 overflow-y-auto">
                {!view.rows.length && <p className="p-3 text-sm text-gray-500">No rows match this filter.</p>}
                {view.rows.map((row) => <article key={row.row_number} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0"><p className="break-words font-semibold text-gray-900">{row.data.display_name || 'Unnamed employee'} <span className="text-xs font-normal text-gray-500">· Row {row.row_number}</span></p>
                            <p className="break-words text-sm text-gray-600">Payroll ID {row.data.payroll_employee_id || 'Missing'} · {row.data.department_name}{row.data.division_name ? ` / ${row.data.division_name}` : ''} · {row.data.status}</p>
                            <p className="text-xs text-gray-500">{applied ? row.applied_outcome : decisionLabel[row.decision]} · {row.state}</p>
                        </div>
                        {!applied && <button type="button" className={button} disabled={busy} onClick={() => setEditing(row)}>Review row {row.row_number}</button>}
                    </div>
                    {row.changes.length > 0 && <ul className="mt-2 text-sm text-gray-700">{row.changes.filter((change) => names[change.field]).map((change) => <li key={change.field}>{names[change.field]}: {change.field === 'manager_id' ? `change to Payroll ID ${row.data.manager_payroll_id}` : `${change.before || '—'} → ${change.after || '—'}`}</li>)}</ul>}
                    {!applied && <p className="mt-1 text-xs text-gray-500">Appointment: {row.service_action === 'add' ? `${row.data.employment_category}, from ${row.data.appointment_start}${row.data.appointment_end ? ` to ${row.data.appointment_end}` : ''}${row.data.is_intern === 'true' ? ', intern' : ''}${row.data.is_teacher === 'true' ? ', teacher' : ''}; service credit ${row.data.counts_for_service === 'true' ? 'included' : row.data.counts_for_service === 'false' ? 'excluded' : 'needs HR determination'}` : row.service_action === 'retained' ? 'Existing matching record retained' : 'Not supplied'}</p>}
                    {row.errors.length > 0 && <ul className="mt-2 space-y-1 text-sm text-red-700">{row.errors.map((message, i) => <li key={i}>{message}</li>)}</ul>}
                    {row.warnings.length > 0 && <ul className="mt-2 space-y-1 text-xs text-amber-800">{row.warnings.map((message, i) => <li key={i}>{message}</li>)}</ul>}
                    {row.review_reason && <p className="mt-2 break-words text-xs text-gray-600">HR decision: {row.review_reason}</p>}
                </article>)}
            </div>
            <Pager page={view.page - 1} pageCount={Math.ceil(view.total / view.page_size)} total={view.total} pageSize={view.page_size} setPage={(page) => { if (!busy) void run(() => loadBatch(view.batch.id, page + 1, view.filter)); }} />
            {!applied && <fieldset disabled={busy} className="space-y-3 rounded-lg bg-gray-50 p-3">
                <p className="text-sm text-gray-600">Resolve every blocked row or record a reason to skip it. Changes apply together and are audited. Employees absent from this export stay unchanged.</p>
                <label className="block text-sm font-medium text-gray-700">Batch review note
                    <textarea className={`${control} mt-1`} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Record how this export and its identity decisions were verified (at least 10 characters)." />
                </label>
                <label className="flex items-start gap-2 text-sm text-gray-700"><input className="mt-1" type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />I have reviewed the proposed employee changes and appointment warnings.</label>
                <button type="button" className={`${button} bg-brand text-white hover:bg-brand-dark`} disabled={view.summary.blocked > 0 || view.summary.ready === 0 || !reviewed || note.trim().length < 10} onClick={() => void run(async () => {
                    if (!(await confirm(`Apply ${view.summary.ready} employee rows and skip ${view.summary.skipped}? This updates the employee master and records an audit trail.`))) return;
                    await apiClient.post<PayrollImportResult>(`${ROOT}/${view.batch.id}/apply`, { revision: view.batch.revision, review_note: note });
                    await loadBatch(view.batch.id); await loadHistory(); onApplied();
                })}>Apply reviewed batch</button>
            </fieldset>}
        </div>}
        {history && history.batches.length > 0 && <details className="border-t border-gray-200 pt-3"><summary className="cursor-pointer text-sm font-semibold text-gray-700">Saved import batches ({history.total})</summary>
            <div className="mt-2 space-y-2">{history.batches.map((batch) => <button type="button" key={batch.id} disabled={busy} className={`${button} block w-full break-all text-left`} onClick={() => void run(() => loadBatch(batch.id))}>{batch.file_name} · {batch.export_date.slice(0, 10)} · {batch.row_count} rows · {batch.status === 'applied' ? 'Applied' : 'Awaiting review'}</button>)}</div>
            <Pager page={history.page - 1} pageCount={Math.ceil(history.total / history.page_size)} total={history.total} pageSize={history.page_size} setPage={(page) => { if (!busy) void run(() => loadHistory(page + 1)); }} />
        </details>}
        {editing && view && <RowReview row={editing} busy={busy} saveError={error} onClose={() => setEditing(null)} onSave={(decision, employeeId, reason) => void run(async () => {
            await apiClient.put(`${ROOT}/${view.batch.id}/rows/${editing.row_number}`, { revision: view.batch.revision, decision, employee_id: employeeId || null, reason });
            await loadBatch(view.batch.id, view.page, view.filter); setEditing(null);
        })} />}
    </section>;
}

function RowReview({ row, busy, saveError, onClose, onSave }: { row: PayrollImportRow; busy: boolean; saveError: string; onClose: () => void; onSave: (decision: PayrollImportDecision, employeeId: string, reason: string) => void }) {
    const [decision, setDecision] = useState<PayrollImportDecision>(row.decision === 'review' ? 'update' : row.decision);
    const [selected, setSelected] = useState(row.decision === 'update' ? row.target_employee_id || '' : '');
    const [reason, setReason] = useState(row.review_reason || '');
    const [search, setSearch] = useState('');
    const [matches, setMatches] = useState<PayrollImportCandidate[]>(row.potential_matches);
    const [searching, setSearching] = useState(false);
    const [error, setError] = useState('');
    const [total, setTotal] = useState(row.potential_matches.length);
    return <Modal title={`Review row ${row.row_number}`} description={`${row.data.display_name} · Payroll ID ${row.data.payroll_employee_id}`} onClose={onClose} closeDisabled={busy} size="xl">
        <fieldset disabled={busy} className="space-y-4">
            {saveError && <p role="alert" className="text-sm text-red-700">{saveError}</p>}
            <label className="block text-sm font-medium text-gray-700">HR identity decision
                <select className={`${control} mt-1`} value={decision} onChange={(e) => { setDecision(e.target.value as PayrollImportDecision); setSelected(''); }}>
                    <option value="update">Match a verified existing employee</option><option value="create">Confirm a distinct new employee</option><option value="skip">Skip this row</option>
                </select>
            </label>
            {decision === 'update' && <div className="space-y-2">
                <p className="text-xs text-gray-600">Names and email suggest possible matches. Verify the Payroll or personnel record before choosing a person.</p>
                <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!search.trim() || searching) return; setSearching(true); setError(''); void apiClient.get<{ employees: PayrollImportCandidate[]; total: number }>(`/hr/directory?search=${encodeURIComponent(search.trim())}&page_size=50`).then((result) => { setMatches(result.employees); setTotal(result.total); }).catch((err: Error) => setError(err.message)).finally(() => setSearching(false)); }}>
                    <input aria-label="Search existing employees" className={`${control} min-w-0 flex-1`} maxLength={100} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Exact Payroll ID or employee name" />
                    <button className={button} disabled={searching || !search.trim()} type="submit">{searching ? 'Searching…' : 'Search directory'}</button>
                </form>
                {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
                {row.decision === 'update' && row.target_employee_id && <label className="flex items-center gap-2 rounded-lg border p-2 text-sm"><input type="radio" name="employee-target" value={row.target_employee_id} checked={selected === row.target_employee_id} onChange={() => setSelected(row.target_employee_id || '')} />{row.target_employee_name || 'Current employee'} · Verified owner of Payroll ID {row.data.payroll_employee_id}</label>}
                <div className="max-h-48 space-y-2 overflow-y-auto">{matches.filter((match) => match.id !== row.target_employee_id).map((match) => <label key={match.id} className="flex items-start gap-2 rounded-lg border p-2 text-sm"><input type="radio" name="employee-target" checked={selected === match.id} onChange={() => setSelected(match.id)} /><span>{match.display_name} · {match.department_code || 'No department'} · {match.status}{match.external_ids?.length ? ` · Payroll ID ${match.external_ids.map((entry) => entry.external_id).join(', ')}` : ' · No verified Payroll ID'}</span></label>)}</div>
                {total > 50 && <p className="text-xs text-gray-500">Showing the first 50 of {total} matches. Narrow your search.</p>}
            </div>}
            {decision === 'create' && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Confirm that this person is distinct from any existing employee. A new record will receive this Payroll ID; no login is created.</p>}
            <label className="block text-sm font-medium text-gray-700">Verification or skip reason
                <textarea className={`${control} mt-1`} rows={3} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} placeholder="At least 10 characters" />
            </label>
            <div className="flex justify-end gap-2"><button type="button" className={button} onClick={onClose}>Cancel</button><button type="button" className={`${button} bg-brand text-white hover:bg-brand-dark`} disabled={reason.trim().length < 10 || (decision === 'update' && !selected)} onClick={() => onSave(decision, selected, reason)}>Save row decision</button></div>
        </fieldset>
    </Modal>;
}

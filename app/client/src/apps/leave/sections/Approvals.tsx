import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../../lib/api';
import { useToast } from '../../../contexts/useToast';
import { Button, LoadingState, Modal } from '../../../components/Ui';
import { formatDate } from '../types';
import { printApprovedLeaveForm } from '../payrollForm';
import { LeaveAttachmentLinks } from '../LeaveAttachmentLinks';
import { GovernmentRequestList } from '../GovernmentRequests';
import type { LeaveApplication } from '../types';
import { Field, inputClass } from '../ManagementFields';

export function Approvals() {
    const { addToast } = useToast();
    const [items, setItems] = useState<LeaveApplication[]>([]);
    const [recent, setRecent] = useState<LeaveApplication[]>([]);
    const [selected, setSelected] = useState<LeaveApplication | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState('');
    const [error, setError] = useState('');
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [pending, approved] = await Promise.all([
                apiClient.get<LeaveApplication[]>('/hr/approvals'),
                apiClient.get<LeaveApplication[]>('/hr/approvals?status=approved'),
            ]);
            setItems(pending || []);
            setRecent((approved || []).filter(application => application.status === 'approved'));
        } catch (err) {
            addToast((err as Error).message || 'Unable to load approvals.', 'error');
        } finally { setLoading(false); }
    }, [addToast]);
    useEffect(() => { void load(); }, [load]);
    async function decide(decision: 'approved' | 'rejected') {
        if (!selected || busy) return;
        if (decision === 'rejected' && !note.trim()) { setError('Enter a reason for rejecting this application.'); return; }
        setBusy(true); setError('');
        try {
            await apiClient.post(`/hr/leaves/${selected.id}/decision`, { decision, reviewer_note: note.trim() || null });
            setSelected(null); addToast(`Leave ${decision}.`, 'success'); await load();
        } catch (err) { setError((err as Error).message || 'Unable to record the decision.'); }
        finally { setBusy(false); }
    }
    async function printForm(application: LeaveApplication) {
        try { await printApprovedLeaveForm(application.id); }
        catch (err) { addToast((err as Error).message || 'Unable to prepare the leave PDF.', 'error'); }
    }
    return <div className="space-y-5">
        <GovernmentRequestList mode="queue" />
        {loading && <LoadingState label="Loading leave records…" />}
        {items.length > 0 && <section className="app-panel space-y-3 p-4 sm:p-6">
            <h3 className="text-lg font-semibold">Pending applications</h3>
            {items.map(application => <article key={application.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-3">
                <div className="min-w-0"><p className="font-semibold">{application.employee_name}</p><p className="text-sm text-gray-600">{application.leave_type_name} · {formatDate(application.start_date)} to {formatDate(application.end_date)} · {application.days} days</p></div>
                <Button variant="secondary" onClick={() => { setSelected(application); setNote(''); setError(''); }}>Review application</Button>
            </article>)}
        </section>}
        {recent.length > 0 && <details className="app-panel p-4 sm:p-6"><summary className="cursor-pointer text-sm font-semibold">Approved leave records</summary><div className="mt-3 divide-y divide-gray-100">
            {recent.map(application => <article key={application.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div className="min-w-0"><p className="font-semibold">{application.employee_name}</p><p className="text-gray-600">{application.leave_type_name} · {formatDate(application.start_date)} to {formatDate(application.end_date)} · {application.days} days</p></div>
                <Button variant="secondary" onClick={() => void printForm(application)}>Open approved PDF</Button>
            </article>)}
        </div></details>}
        {selected && <Modal title="Review leave application" size="2xl" closeDisabled={busy} onClose={() => setSelected(null)}>
            <div className="space-y-4"><div><h3 className="font-semibold">{selected.employee_name} · {selected.leave_type_name}</h3><p className="text-sm text-gray-600">{formatDate(selected.start_date)} to {formatDate(selected.end_date)} · {selected.days} working days</p></div>
                <p className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-sm">{selected.reason || 'No explanation recorded. Ask HR to review this application before approving.'}</p>
                <LeaveAttachmentLinks application={selected} onError={setError} />
                <Field label="Review comment (required for rejection)"><textarea className={inputClass} maxLength={2000} rows={3} value={note} onChange={event => setNote(event.target.value)} disabled={busy} /></Field>
                {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
                <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4"><Button variant="secondary" disabled={busy} onClick={() => setSelected(null)}>Close</Button><Button variant="danger" loading={busy} onClick={() => void decide('rejected')}>Reject application</Button><Button loading={busy} disabled={!selected.reason?.trim()} onClick={() => void decide('approved')}>Approve leave</Button></div>
            </div>
        </Modal>}
    </div>;
}

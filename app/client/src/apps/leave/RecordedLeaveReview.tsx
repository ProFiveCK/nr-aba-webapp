import { useState } from 'react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { Button, Modal } from '../../components/Ui';
import { formatDate } from './types';
import { printApprovedLeaveForm } from './payrollForm';
import { LeaveAttachmentLinks } from './LeaveAttachmentLinks';
import { Field, inputClass } from './ManagementFields';
import type { LeaveApplication } from './types';

export function RecordedLeaveReview({selected,onClose,onChanged}:{selected:LeaveApplication&{can_decide?:boolean};onClose:()=>void;onChanged:()=>void}) {
    const { addToast } = useToast();
    const [busy,setBusy] = useState(false), [note,setNote] = useState(''), [error,setError] = useState('');
    async function decide(decision: 'approved' | 'rejected') {
        if (!selected || busy) return;
        if (decision === 'rejected' && !note.trim()) { setError('Enter a reason for rejecting this application.'); return; }
        setBusy(true); setError('');
        try {
            await apiClient.post(`/hr/leaves/${selected.id}/decision`, { decision, reviewer_note: note.trim() || null });
            onClose(); addToast(`Leave ${decision}.`, 'success'); onChanged();
        } catch (err) { setError((err as Error).message || 'Unable to record the decision.'); }
        finally { setBusy(false); }
    }
    return <Modal title={selected.status==='pending'?'Review leave application':'Leave application'} size="2xl" closeDisabled={busy} onClose={() => onClose()}>
            <div className="space-y-4"><div><h3 className="font-semibold">{selected.employee_name} · {selected.leave_type_name}</h3><p className="text-sm text-gray-600">{formatDate(selected.start_date)} to {formatDate(selected.end_date)} · {selected.days} working days</p></div>
                <p className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-sm">{selected.reason || 'No explanation recorded. Ask HR to review this application before approving.'}</p>
                <LeaveAttachmentLinks application={selected} onError={setError} />
                {selected.status==='pending'&&selected.can_decide!==false&&<Field label="Review comment (required for rejection)"><textarea className={inputClass} maxLength={2000} rows={3} value={note} onChange={event => setNote(event.target.value)} disabled={busy} /></Field>}
                {selected.status==='pending'&&selected.can_decide===false&&<p className="text-sm text-gray-600">HR must review this application’s setup before a decision can be recorded.</p>}
                {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
                <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4"><Button variant="secondary" disabled={busy} onClick={() => onClose()}>Close</Button>{selected.status==='pending'&&selected.can_decide!==false&&<><Button variant="danger" loading={busy} onClick={() => void decide('rejected')}>Reject application</Button><Button loading={busy} disabled={!selected.reason?.trim()} onClick={() => void decide('approved')}>Approve leave</Button></>}{selected.status==='approved'&&<Button onClick={()=>void printApprovedLeaveForm(selected.id).catch((err:Error)=>setError(err.message))}>Open approved PDF</Button>}</div>
            </div>
        </Modal>;
}

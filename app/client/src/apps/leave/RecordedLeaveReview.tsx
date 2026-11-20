import { AsyncButton, Button, Modal } from '../../components/Ui';
import { printApprovedLeaveForm } from './payrollForm';
import { formatDate } from './types';
import { LeaveAttachmentLinks } from './LeaveAttachmentLinks';
import type { LeaveApplication } from './types';

/**
 * A recorded application is frozen history from the legacy balance era: it is
 * displayed exactly as it was recorded and decided, and any decision recorded
 * on it is preserved in the approval progress. Only the staged government
 * workflow grants leave now.
 */
export function RecordedLeaveReview({selected,onClose}:{selected:LeaveApplication&{can_decide?:boolean};onClose:()=>void}) {
    return <Modal title={selected.status==='pending'?'Recorded leave application':'Leave application'} size="2xl" onClose={() => onClose()}>

            <div className="space-y-4"><div><h3 className="font-semibold">{selected.employee_name} · {selected.leave_type_name}</h3><p className="text-sm text-gray-600">{formatDate(selected.start_date)} to {formatDate(selected.end_date)} · {selected.days} working days</p></div>
                {selected.status==='pending'&&<p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This original request was never resolved on the legacy balance system. Central HR reconciles retained leave at the cutover review before anything is charged.</p>}
                <p className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-sm">{selected.reason || 'No explanation recorded.'}</p>
                <LeaveAttachmentLinks application={selected} onError={()=>{}} />
                {selected.reviewer_note && <p className="rounded-lg bg-white p-3 text-sm text-gray-700">Decision note: {selected.reviewer_note}</p>}
                <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4"><Button variant="secondary" onClick={() => onClose()}>Close</Button>{selected.status==='approved'&&<AsyncButton loadingLabel="Preparing PDF…" onError={()=>{}} onClick={()=>printApprovedLeaveForm(selected.id,'recorded')}>Open approved PDF</AsyncButton>}</div>
            </div>
        </Modal>;
}

import {SimpleLeaveDetails} from './SimpleLeaveDetails';
import { useRef, useState } from 'react';
import { Button } from '../../components/Ui';
import { formatDate } from '../../lib/date';
import { Field, inputClass } from './ManagementFields';
import { governmentLabel as label } from './governmentWorkflowTypes';
import type { GovernmentRequest, GovernmentStage } from './governmentWorkflowTypes';

export const approvalCertification = 'I certify that I have verified the application details and supporting information.';
function approvalAction(request: GovernmentRequest, stage: GovernmentStage) {
    if(request.simple_approval)return stage.ordinal===request.stages.length-1?'Approve leave':'Approve and continue';
    return stage.ordinal === request.stages.length - 1 ? 'Approve leave' : stage.level === 'hr_verifier' ? 'Verify evidence' : stage.level === 'relevant_secretary' ? 'Record consent' : stage.level === 'minister' ? 'Record Minister grant' : 'Recommend leave';
}

/** Review, certification and the decision stay inside the application modal. */
export function GovernmentApprovalForm({ request, stage, evidenceOnly = false, disabled = false, onSave, onBusyChange }: {
    request: GovernmentRequest; stage?: GovernmentStage; evidenceOnly?: boolean; disabled?: boolean;
    onSave: (data: FormData, eventKey: string) => Promise<void>; onBusyChange: (busy: boolean) => void;
}) {
    const [certified, setCertified] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [eventKey] = useState(() => crypto.randomUUID());
    const saving = useRef(false), feedback = useRef<HTMLParagraphElement>(null);
    const verifiesEvidence = !request.simple_approval && (evidenceOnly || stage?.level === 'hr_verifier' || request.can_verify_evidence === true);
    const action = evidenceOnly ? 'Verify supporting evidence' : stage ? approvalAction(request, stage) : 'Approve leave';
    const final = !evidenceOnly && stage?.ordinal === request.stages.length - 1;
    return <form className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4" onSubmit={event => {
        event.preventDefault();
        if (!certified || disabled || saving.current) return;
        const data = new FormData(event.currentTarget);
        saving.current = true; setBusy(true); onBusyChange(true); setError('');
        void onSave(data, eventKey).catch((err: Error) => {
            setError(err.message || 'Unable to record the decision.');
            requestAnimationFrame(() => feedback.current?.focus());
        }).finally(() => { saving.current = false; setBusy(false); onBusyChange(false); });
    }}>
        <h4 className="font-semibold">{evidenceOnly ? 'Verify supporting evidence' : 'Certify and record your decision'}</h4>
        <p className="text-sm text-gray-700">{evidenceOnly ? 'Record the HR evidence review so the assigned approver can proceed.' : final ? `Approve this leave as ${stage?.label || label(stage?.level || 'assigned approver')}. ${request.code==='lwop'?"This is unpaid leave; paid leave balances stay unchanged.":"Approval records the leave and any balance changes."}` : 'Your decision will move this application to the next approval stage.'}</p>
        {verifiesEvidence && <p className="text-sm text-gray-700">{!evidenceOnly && stage?.level !== 'hr_verifier' ? 'Supporting evidence will be verified together with your decision. ' : ''}Confirm that the supporting information covers this application{request.code === 'medical' && request.medical_mode === 'certificate' ? `, including the registered-practitioner medical certificate for ${formatDate(request.start_date)} to ${formatDate(request.end_date)}` : request.code === 'special' ? ', including sufficient-cause justification for Special leave' : ''}.</p>}
        {!request.simple_approval && stage?.level === 'minister' && <p className="text-sm">Record the statutory Minister grant for the further medical period and explicit salary segments. Chief Secretary final processing follows this retained Minister decision.</p>}
        {!request.simple_approval && stage?.level === 'hr_verifier' && request.case && !request.standard_lwop && <p className="text-sm">Verify the sourced case facts, dated salary segments, evidence and financial history independently. The preparer cannot verify their own determination.</p>}
        <fieldset disabled={busy || disabled} className="min-w-0 space-y-3">
            {request.simple_approval && request.case && final && <SimpleLeaveDetails code={request.code} initial={request.case_details} request={request}/>}
            {request.simple_approval && !!request.approval_checks?.length && <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">{request.approval_checks.map(check=><li key={check}>{check}</li>)}</ul>}
            {request.simple_approval && ['maternity','paternity'].includes(request.code) && <p className="text-sm text-gray-700">Approval also accepts any short notice. Pay is calculated automatically from verified service and parental details.</p>}
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-blue-200 bg-white p-3 text-sm"><input className="mt-0.5 h-5 w-5 shrink-0" name="certification_confirmed" type="checkbox" required checked={certified} onChange={event => setCertified(event.target.checked)} /><span>{approvalCertification}</span></label>
            {!request.simple_approval && stage?.level === 'chief_secretary' && !!request.determination?.discretion.length && <label className="flex items-start gap-3 text-sm"><input name="discretion_confirmed" type="checkbox" required className="mt-1" /> I confirm the recorded late-notice or extended-LWOP discretionary authority for this grant.</label>}
            {request.case && !request.standard_lwop && !request.simple_approval ? <Field label="Decision reason"><textarea name="note" required minLength={10} maxLength={2000} rows={3} className={inputClass} /></Field> : <details><summary className="cursor-pointer text-sm text-gray-700">Add a comment (optional)</summary><div className="mt-3"><Field label="Review comment (optional)"><textarea name="note" maxLength={evidenceOnly ? 1000-approvalCertification.length-1 : 2000} rows={3} className={inputClass} /></Field></div></details>}
        </fieldset>
        {error && <p ref={feedback} tabIndex={-1} role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <Button type="submit" loading={busy} disabled={disabled || !certified}>{action}</Button>
    </form>;
}

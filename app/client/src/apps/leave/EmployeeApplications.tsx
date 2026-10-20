import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import { Button } from '../../components/Ui';
import { GovernmentCaseApplication } from './GovernmentCases';
import { GovernmentRequestList } from './GovernmentRequests';

export function EmployeeApplications({ employeeId, canApply, canReview = true }: { employeeId: string; canApply: boolean; canReview?: boolean }) {
    const { user } = useAuth();
    const central = user?.permissions?.hr_admin === true;
    const [applying, setApplying] = useState(false);
    const [notice, setNotice] = useState('');
    const [version, setVersion] = useState(0);
    return <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">Employee leave</h3><p className="mt-1 text-sm text-gray-600">Open an application to review it, request cancellation or record an early return.</p></div>{canApply && <Button variant={applying ? 'secondary' : 'primary'} aria-expanded={applying} onClick={() => { setNotice(''); setApplying(!applying); }}>{applying ? 'Close application form' : 'Apply on behalf'}</Button>}</div>
        {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
        {applying && canApply && <GovernmentCaseApplication employeeId={employeeId} assisted onChanged={() => { setApplying(false); setNotice('Application submitted for approval. Open it below to track its progress.'); setVersion(v => v + 1); }} />}
        {canReview ? <GovernmentRequestList key={employeeId} employeeId={employeeId} mode={central ? 'all' : 'queue'} includeRecorded initialStatus="all" refreshVersion={version} /> : <p className="text-sm text-gray-600">Application records require leave reporting or approval access. Ask a leave administrator to review this employee’s leave.</p>}
        {central && <Link className="text-sm font-semibold text-brand underline" to={`/leave/work-queue?view=followups&employee=${encodeURIComponent(employeeId)}`}>View outstanding follow-ups</Link>}
    </div>;
}

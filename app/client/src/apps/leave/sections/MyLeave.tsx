import { useEffect, useState } from 'react';
import { apiClient } from '../../../lib/api';
import { LoadingState } from '../../../components/Ui';
import { GovernmentMyLeave } from '../GovernmentRequests';
import { formatDate } from '../types';
import type { MyLeaveResponse, LeaveApplication } from '../types';
import { printApprovedLeaveForm } from '../payrollForm';

export function MyLeave() {
    const [summary, setSummary] = useState<MyLeaveResponse | null>(null);
    const [history, setHistory] = useState<LeaveApplication[] | null>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let live = true;
        void apiClient.get<MyLeaveResponse>('/hr/me').then(data => { if (live) setSummary(data); })
            .catch((err: Error) => { if (live) setError(err.message); });
        return () => { live = false; };
    }, []);
    async function loadHistory() {
        try { setHistory(await apiClient.get<LeaveApplication[]>('/hr/leaves')); }
        catch (err) { setError((err as Error).message); }
    }
    return <div className="space-y-5">
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {!summary && !error && <LoadingState label="Loading your leave…" />}
        {summary && <>
            {summary.employee.leave_policy_regime === 'government' ? <GovernmentMyLeave employeeId={summary.employee.id} /> : <div className="app-panel space-y-2 p-5"><h2 className="text-xl font-semibold">My leave</h2><p role="status" className="text-sm text-gray-700">Your leave setup needs review. Ask HR to complete your transfer and activation so you can apply under the current policy.</p></div>}
            <details className="app-panel p-4" onToggle={event => { if (event.currentTarget.open && history === null) void loadHistory(); }}>
                <summary className="cursor-pointer text-sm font-semibold">Historical applications</summary>
                <div className="mt-3 space-y-3"><p className="text-sm text-gray-600">Original records and decisions are retained for reference.</p>
                    {history === null ? <LoadingState label="Loading historical applications…" /> : !history.length ? <p className="text-sm text-gray-500">No historical applications.</p> : history.map(application => <article key={application.id} className="rounded-lg border border-gray-200 p-3 text-sm"><p>{application.leave_type_name} · {formatDate(application.start_date)} to {formatDate(application.end_date)} · {application.status}</p>{application.status === 'pending' && <p className="mt-1 text-gray-600">Ask HR to review this outstanding application during staff transfer.</p>}{application.status === 'approved' && <button type="button" className="mt-2 font-semibold text-brand underline" onClick={() => void printApprovedLeaveForm(application.id).catch((err: Error) => setError(err.message))}>Open approved PDF</button>}</article>)}
                </div>
            </details>
        </>}
    </div>;
}

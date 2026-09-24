import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { useConfirm } from '../../contexts/useConfirm';
import { EmptyState, LoadingState } from '../../components/Ui';
import { formatDate } from '../../features/hr/types';
import type { LeaveApplication } from '../../features/hr/types';

export function Approvals() {
    const { addToast } = useToast();
    const { prompt } = useConfirm();
    const [items, setItems] = useState<LeaveApplication[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setItems((await apiClient.get<LeaveApplication[]>('/hr/approvals')) || []);
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to load approvals.', 'error');
        } finally {
            setLoading(false);
        }
    }, [addToast]);

    useEffect(() => {
        load();
    }, [load]);

    const decide = async (application: LeaveApplication, decision: 'approved' | 'rejected') => {
        let note = '';
        if (decision === 'rejected') {
            // The server also enforces this; asking here avoids a wasted round trip.
            const response = await prompt({
                title: 'Reject leave request',
                message: `Why are you rejecting ${application.employee_name}'s ${application.leave_type_name} leave?`,
            });
            if (response === null) return;
            note = response.trim();
            if (!note) {
                addToast('A reason is required when rejecting leave.', 'error');
                return;
            }
        }

        setBusyId(application.id);
        try {
            await apiClient.post(`/hr/leaves/${application.id}/decision`, {
                decision,
                reviewer_note: note || null,
            });
            addToast(`Leave ${decision}.`, 'success');
            await load();
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to record the decision.', 'error');
        } finally {
            setBusyId(null);
        }
    };

    if (loading) return <LoadingState label="Loading approvals…" />;

    if (!items.length) {
        return (
            <div className="app-panel p-6">
                <EmptyState title="Nothing awaiting approval" detail="Leave from the people who report to you will appear here." />
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2a5ba5]">Manager queue</p>
                <h2 className="mt-1 text-xl font-bold text-slate-950">Leave approvals</h2>
                <p className="mt-1 text-sm text-slate-500">{items.length} request{items.length === 1 ? '' : 's'} awaiting your decision.</p>
            </div>
            {items.map((application) => (
                <div key={application.id} className="app-panel p-5 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <p className="text-lg font-semibold text-slate-950">{application.employee_name}</p>
                            <p className="text-sm text-zinc-600">
                                {application.leave_type_name} · {formatDate(application.start_date)} – {formatDate(application.end_date)} ·{' '}
                                <span className="font-medium">{application.days} working days</span>
                            </p>
                            {application.reason && (
                                <p className="mt-2 rounded-md bg-zinc-50 p-2 text-sm text-zinc-700">{application.reason}</p>
                            )}
                            <p className="mt-2 text-xs text-zinc-400">Applied {formatDate(application.applied_at)}</p>
                        </div>
                        <div className="flex w-full gap-2 sm:w-auto">
                            <button
                                type="button"
                                disabled={busyId === application.id}
                                onClick={() => decide(application, 'approved')}
                                className="flex-1 rounded-lg bg-[#002B7F] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#174495] disabled:opacity-50 sm:flex-none"
                            >
                                Approve
                            </button>
                            <button
                                type="button"
                                disabled={busyId === application.id}
                                onClick={() => decide(application, 'rejected')}
                                className="flex-1 rounded-lg border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 sm:flex-none"
                            >
                                Reject
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

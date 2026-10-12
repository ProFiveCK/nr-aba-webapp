import { useState } from 'react';
import { AustralianDateInput } from '../../../components/AustralianDateInput';
import { toIsoDate } from '../../../lib/date';
import { GovernmentActivity } from '../GovernmentActivity';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../contexts/useAuth';

export function Report() {
    const { user } = useAuth();
    const now = new Date();
    const [from, setFrom] = useState(() => toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
    const [to, setTo] = useState(() => toIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
    return <div className="space-y-4">
        <div><h2 className="text-xl font-semibold">Leave reports</h2><p className="mt-1 text-sm text-gray-600">Approved leave for the selected period, with a CSV download.</p></div>
        <div className="app-panel flex flex-wrap items-end gap-3 p-4">
            <label className="text-sm font-medium text-gray-700">From<AustralianDateInput aria-label="Period from" required value={from} onChange={event => setFrom(event.target.value)} className="mt-1 block rounded-lg border border-gray-300 px-3 py-2" /></label>
            <label className="text-sm font-medium text-gray-700">To<AustralianDateInput aria-label="Period through" required value={to} min={from} onChange={event => setTo(event.target.value)} className="mt-1 block rounded-lg border border-gray-300 px-3 py-2" /></label>
        </div>
        {(!from || !to || from > to) ? <p role="alert" className="text-sm text-amber-800">Choose a valid date range to view the report.</p> : <GovernmentActivity from={from} to={to} details />}
        {(user?.permissions?.hr_admin || user?.permissions?.hr_balance_manage) && <Link className="text-sm font-semibold text-brand underline" to="/leave/balances">View current staff balances & movements</Link>}
    </div>;
}

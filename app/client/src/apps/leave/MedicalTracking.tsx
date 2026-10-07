import { formatDate } from '../../lib/date';

type Usage = { approved_days:string|null; pending_days:string|null; baseline_days:string|null };
export type MedicalTrackingSummary = {
    configured:boolean; period_start:string|null; period_end:string|null; annual_days:string|null;
    shared:null|{balance:string;held:string;available:string}; certified:Usage;
    uncertified:Usage & {approved_occasions:number|null;pending_occasions:number|null;baseline_occasions:number|null;limit:number|null;committed_occasions:number|null;remaining_occasions:number|null};
    baseline_reviewed:boolean; issues:string[];
    history:{id:string;status:'approved'|'pending'|'baseline';start_date:string;end_date:string;mode:'certificate'|'exemption';days:string;source:'government'|'baseline'}[];
    history_total:number; history_truncated:boolean;
};
const days=(value:string|null)=>value===null?'Not determined':new Intl.NumberFormat('en-AU',{maximumFractionDigits:6}).format(Number(value));
export function MedicalTracking({tracking,legacy}:{tracking:MedicalTrackingSummary;legacy:boolean}) {
    const rows:[string,Usage][]=[['With medical certificate',tracking.certified],['Without medical certificate',tracking.uncertified]];
    return <section className="app-panel space-y-3 p-4" aria-label="Medical leave tracking">
        <h3 className="font-semibold">Medical leave · certificate and uncertified usage</h3>
        {legacy&&<p className="text-sm text-gray-600">The existing Sick Leave balances above still govern this employee. The Government figures below apply after their Government Leave activation.</p>}
        {tracking.shared?<><p className="text-sm text-gray-600">Service year {formatDate(tracking.period_start)} to {formatDate(tracking.period_end)} · shared annual entitlement {days(tracking.annual_days)} policy days.</p>
            <p className="text-sm">Balance <strong>{days(tracking.shared.balance)}</strong> · held {days(tracking.shared.held)} · available <strong>{days(tracking.shared.available)}</strong></p>
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2 pr-4">Evidence route</th><th className="pr-4">Approved since opening</th><th className="pr-4">Pending</th><th>Before opening</th></tr></thead><tbody>{rows.map(([name,usage])=><tr key={name} className="border-b border-gray-100"><th className="py-3 pr-4 font-medium">{name}</th><td className="pr-4">{days(usage.approved_days)}</td><td className="pr-4">{days(usage.pending_days)}</td><td>{days(usage.baseline_days)}</td></tr>)}</tbody></table></div>
            <p className="text-sm">Uncertified occasions: <strong>{tracking.uncertified.remaining_occasions??'Not determined'} remaining</strong>{tracking.uncertified.limit!==null&&` of ${tracking.uncertified.limit}`}. Committed: {tracking.uncertified.committed_occasions??'Not determined'} (approved {tracking.uncertified.approved_occasions??'unknown'}, pending {tracking.uncertified.pending_occasions??'unknown'}, reviewed before opening {tracking.uncertified.baseline_occasions??'unknown'}).</p>
            <p className="text-xs text-gray-500">Both routes draw from the same Medical balance. The uncertified limit counts occasions, not days. Pending applications reserve both days and occasions.</p></>:<p className="text-sm text-gray-600">Government Medical tracking awaits a certified opening and reviewed Medical history. No unused uncertified allowance has been assumed.</p>}
        {!!tracking.issues.length&&<div className="space-y-1 text-sm text-amber-800">{tracking.issues.map(issue=><p key={issue}>{issue}</p>)}</div>}
        {!!tracking.history.length&&<details className="text-sm"><summary className="cursor-pointer text-gray-600">Medical usage history ({tracking.history_total})</summary><div className="mt-3 space-y-2">{tracking.history.map(row=><p key={row.id}>{formatDate(row.start_date)}{row.end_date!==row.start_date&&` to ${formatDate(row.end_date)}`} · {row.mode==='certificate'?'With M/C':'Without M/C'} · {days(row.days)} policy days · {row.status==='baseline'?'Reviewed before opening':row.status}</p>)}{tracking.history_truncated&&<p className="text-xs text-gray-500">Showing the latest 100 entries. Earlier applications remain in the retained register.</p>}</div></details>}
    </section>;
}

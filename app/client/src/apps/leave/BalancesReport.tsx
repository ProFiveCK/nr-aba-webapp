import { RefreshCw } from 'lucide-react';
import { EmptyState, LoadingState } from '../../components/Ui';
import { compareCells, useTableSort } from '../../lib/tableSort';
import { SortHeader } from '../../components/SortHeader';
import type { StaffBalanceRow, StaffBalancesResponse } from './staffTypes';

// Fixed columns are keyed by name; a leave type column is keyed by the type's
// own name, which cannot collide with these because a type called "name"
// would still arrive as "Name" and the keys below are lower case.
const NAME = 'name';
const DEPT = 'dept';
const DIVISION = 'division';

const TH_FIXED = 'sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500';
const TH_TYPE = 'sticky top-0 z-10 whitespace-nowrap border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500';

/** Days in hand for one leave type: what is on the books less what is held. */
function availableFor(employee: StaffBalanceRow, leaveType: string): number {
    const entry = employee.balances[leaveType];
    return entry ? entry.balance - entry.pending : 0;
}

// Every staff member against every active leave type, visible without
// clicking into each person individually. Sticky header and name column so
// a long roster stays orientable while scrolling either direction.
export function BalancesReport({
    report, loading, onOpenEmployee, onExport, onRefresh,
}: {
    report: StaffBalancesResponse | null;
    loading: boolean;
    onOpenEmployee: (id: string) => void;
    /** Receives the rows in the order shown, so the file matches the screen. */
    onExport: (employees: StaffBalanceRow[]) => void;
    onRefresh: () => void;
}) {
    // Declared before the early returns below: a hook cannot be called
    // conditionally, and both of those paths return without a table.
    const { sort, toggle } = useTableSort<string>({ key: NAME, direction: 'asc' });

    if (loading && !report) return <LoadingState label="Loading balances…" />;
    if (!report || !report.employees.length) {
        return (
            <div className="app-panel p-4">
                <EmptyState title="No active staff yet" detail="Balances appear here once staff records exist." />
            </div>
        );
    }
    const cellFor = (employee: StaffBalanceRow, key: string): string | number | null => {
        if (key === NAME) return employee.display_name;
        if (key === DEPT) return employee.department_code;
        if (key === DIVISION) return employee.division_code;
        return availableFor(employee, key);
    };
    const employees = report.employees.slice().sort((a, b) => (
        compareCells(cellFor(a, sort.key), cellFor(b, sort.key), sort.direction)
        || a.display_name.localeCompare(b.display_name)
    ));

    return (
        <div className="app-panel">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
                <div>
                    <h2 className="text-sm font-semibold text-zinc-900">
                        Leave balances — {report.year} ({report.employees.length} active staff)
                    </h2>
                    <p className="text-xs text-zinc-500">Available days (balance minus pending), every staff member at once.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onRefresh}
                        className="rounded-full border border-zinc-300 p-1.5 text-zinc-500 hover:bg-zinc-50"
                        aria-label="Refresh"
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={() => onExport(employees)}
                        className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                    >
                        Export CSV
                    </button>
                </div>
            </div>
            <div className="max-h-[70vh] overflow-auto">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                    <thead>
                        <tr>
                            <SortHeader
                                label="Name" sortKey={NAME} sort={sort} onSort={toggle} defaultDirection="asc"
                                className="sticky left-0 top-0 z-20 border-b border-r border-zinc-200 bg-zinc-50 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500"
                            />
                            <SortHeader label="Dept" sortKey={DEPT} sort={sort} onSort={toggle} defaultDirection="asc" className={TH_FIXED} />
                            <SortHeader label="Division" sortKey={DIVISION} sort={sort} onSort={toggle} defaultDirection="asc" className={TH_FIXED} />
                            {report.leave_types.map((t) => (
                                // Days descending on first click: the question
                                // asked of a balance column is who has the most.
                                <SortHeader key={t} label={t} sortKey={t} sort={sort} onSort={toggle} align="right" className={TH_TYPE} />
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {employees.map((e) => (
                            <tr key={e.id} className="cursor-pointer hover:bg-zinc-50" onClick={() => onOpenEmployee(e.id)}>
                                <td className="sticky left-0 z-10 whitespace-nowrap border-b border-r border-zinc-100 bg-white px-4 py-2 font-medium text-zinc-900">
                                    {e.display_name}
                                    {!e.reviewer_id && (
                                        <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                                            no login
                                        </span>
                                    )}
                                </td>
                                <td className="border-b border-zinc-100 px-3 py-2 text-zinc-600">{e.department_code || '—'}</td>
                                <td className="border-b border-zinc-100 px-3 py-2 text-zinc-600">{e.division_code || '—'}</td>
                                {report.leave_types.map((t) => {
                                    const entry = e.balances[t];
                                    const available = entry ? entry.balance - entry.pending : 0;
                                    return (
                                        <td
                                            key={t}
                                            className={`border-b border-zinc-100 px-3 py-2 text-right tabular-nums ${
                                                available < 0 ? 'font-semibold text-red-600' : available === 0 ? 'text-zinc-400' : 'text-zinc-800'
                                            }`}
                                        >
                                            {available}
                                            {entry && entry.pending > 0 && (
                                                <span className="ml-1 text-[10px] font-normal text-amber-600">({entry.pending}p)</span>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

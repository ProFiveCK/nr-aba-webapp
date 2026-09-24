import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { EmptyState, LoadingState, StatTile } from '../../components/Ui';
import { formatDate } from '../../features/hr/types';
import { toIsoDate } from '../../lib/date';

// A single, muted-blue hue throughout: every chart here compares one measure
// (days taken) by magnitude, not several series by identity, so a categorical
// palette would be the wrong tool - see the dataviz skill's choosing-a-form.
const SERIES_COLOR = '#2a78d6';

interface OverviewResponse {
    from: string;
    to: string;
    headcount: { active_employees: number; on_leave_today: number };
    applications: {
        total: number;
        pending: number;
        approved: number;
        rejected: number;
        cancelled: number;
        avg_turnaround_hours: number | null;
    };
    days_taken: number;
    by_type: { leave_type: string; days: number; count: number }[];
    by_department: { department_code: string; days: number; count: number }[];
    monthly_trend: { month: string; days: number; count: number }[];
    upcoming: { employee_name: string; leave_type_name: string; start_date: string; end_date: string; days: number }[];
    balance_by_type: { leave_type: string; available_days: number }[];
    // Optional so the page survives a backend that predates them — during any
    // deploy the two are briefly out of step, and a dashboard that white-screens
    // on a missing field is worse than one that shows a little less.
    liability?: {
        value: number;
        days: number;
        staff_without_rate: number;
        staff_total: number;
    };
    exceptions?: {
        pending_over_five_days: number;
        oldest_pending_days: number;
        negative_balances: number;
        excess_balances: number;
        coverage_risks: {
            department_code: string;
            day: string;
            people_out: number;
            headcount: number;
            percent_out: number;
        }[];
    };
}

const NO_LIABILITY = { value: 0, days: 0, staff_without_rate: 0, staff_total: 0 };
const NO_EXCEPTIONS = {
    pending_over_five_days: 0,
    oldest_pending_days: 0,
    negative_balances: 0,
    excess_balances: 0,
    coverage_risks: [],
};

interface BreakdownRow {
    employee_name: string;
    department_code: string;
    leave_type_name: string;
    days: number;
    applications: number;
}

type Dimension = 'department' | 'leave_type';

const AUD = new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD', maximumFractionDigits: 0,
});

/**
 * An exception worth acting on, or a reassuring zero.
 *
 * Deliberately not styled as an alert when the count is zero: a wall of red
 * that is usually wrong teaches people to ignore it.
 */
function ExceptionTile({
    label, count, detail, tone = 'warn', onClick,
}: {
    label: string;
    count: number;
    detail: string;
    tone?: 'warn' | 'danger';
    onClick?: () => void;
}) {
    const raised = count > 0;
    const palette = !raised
        ? 'border-zinc-200 text-zinc-500'
        : tone === 'danger'
            ? 'border-red-300 bg-red-50 text-red-800'
            : 'border-amber-300 bg-amber-50 text-amber-900';
    const Tag = onClick ? 'button' : 'div';
    return (
        <Tag
            {...(onClick ? { type: 'button' as const, onClick } : {})}
            className={`app-panel w-full p-4 text-left ${palette} ${onClick && raised ? 'hover:brightness-95' : ''}`}
        >
            <p className="text-xs font-medium">{label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${raised ? '' : 'text-zinc-400'}`}>{count}</p>
            <p className="mt-1 text-xs opacity-80">{raised ? detail : 'Nothing to action'}</p>
        </Tag>
    );
}

type Preset = '30d' | '6m' | '12m' | 'ytd' | 'custom';

function rangeForPreset(preset: Preset): { from: string; to: string } {
    const today = new Date();
    const to = toIsoDate(today);
    switch (preset) {
        case '30d': {
            const from = new Date(today);
            from.setDate(from.getDate() - 30);
            return { from: toIsoDate(from), to };
        }
        case '6m': {
            const from = new Date(today);
            from.setMonth(from.getMonth() - 6);
            return { from: toIsoDate(from), to };
        }
        case 'ytd':
            return { from: toIsoDate(new Date(today.getFullYear(), 0, 1)), to };
        case '12m':
        default: {
            const from = new Date(today);
            from.setFullYear(from.getFullYear() - 1);
            from.setDate(from.getDate() + 1);
            return { from: toIsoDate(from), to };
        }
    }
}

function monthLabel(month: string): string {
    const [year, m] = month.split('-').map(Number);
    return new Date(year, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' });
}

// Every chart's accessible twin: a plain table showing the same numbers, so
// nothing here is only reachable by reading bar lengths.
function ChartCard({
    title, subtitle, tableHeaders, tableRows, children,
}: {
    title: string;
    subtitle?: string;
    tableHeaders: string[];
    tableRows: (string | number)[][];
    children: ReactNode;
}) {
    const [showTable, setShowTable] = useState(false);
    return (
        <div className="app-panel p-5">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
                    {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
                </div>
                <button
                    type="button"
                    onClick={() => setShowTable((s) => !s)}
                    className="shrink-0 rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
                >
                    {showTable ? 'View chart' : 'View as table'}
                </button>
            </div>
            <div className="mt-4">
                {showTable ? (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-zinc-200 text-sm">
                            <thead className="text-left text-xs font-semibold uppercase text-zinc-500">
                                <tr>
                                    {tableHeaders.map((h) => (
                                        <th key={h} className="px-2 py-1.5">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {tableRows.length === 0 ? (
                                    <tr>
                                        <td colSpan={tableHeaders.length} className="px-2 py-4 text-center text-zinc-400">
                                            No data for this period.
                                        </td>
                                    </tr>
                                ) : (
                                    tableRows.map((row, i) => (
                                        <tr key={i}>
                                            {row.map((cell, j) => (
                                                <td key={j} className="px-2 py-1.5 text-zinc-700">{cell}</td>
                                            ))}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    children
                )}
            </div>
        </div>
    );
}

// Magnitude comparison across named categories: thin bars, one hue, value at
// the tip, sorted by the backend so the largest reads first.
function HorizontalBars({
    data, onSelect, selected,
}: {
    data: { label: string; value: number }[];
    onSelect?: (label: string) => void;
    selected?: string | null;
}) {
    if (!data.length) return <EmptyState title="No data for this period" />;
    const max = Math.max(...data.map((d) => d.value), 1);
    return (
        <div className="space-y-3">
            {data.map((d) => (
                <div
                    key={d.label}
                    role={onSelect ? 'button' : undefined}
                    tabIndex={onSelect ? 0 : undefined}
                    onClick={onSelect ? () => onSelect(d.label) : undefined}
                    onKeyDown={onSelect ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(d.label); } } : undefined}
                    className={`flex items-center gap-3 rounded ${onSelect ? 'cursor-pointer px-1 py-0.5 hover:bg-zinc-50' : ''} ${
                        selected === d.label ? 'bg-zinc-100' : ''
                    }`}
                >
                    <div className="w-32 shrink-0 truncate text-xs text-zinc-600" title={d.label}>
                        {d.label}
                    </div>
                    <div className="h-3 flex-1 min-w-0">
                        <div
                            className="h-3 rounded-r"
                            style={{ width: `${Math.max((d.value / max) * 100, 2)}%`, backgroundColor: SERIES_COLOR }}
                        />
                    </div>
                    <div className="w-16 shrink-0 text-right text-xs font-medium text-zinc-700">
                        {d.value.toFixed(1)}d
                    </div>
                </div>
            ))}
        </div>
    );
}

// Single-series trend: 2px line, ~10% area wash, 8px end-markers with a
// surface ring, hairline gridlines. A native <title> gives each point a
// tooltip; the table-view toggle on the card is the full accessible twin.
function TrendLine({ data }: { data: { month: string; days: number }[] }) {
    if (!data.length) return <EmptyState title="No data for this period" />;
    const width = 640;
    const height = 160;
    const padTop = 12;
    const padBottom = 24;
    const padX = 8;
    const plotHeight = height - padTop - padBottom;
    const max = Math.max(...data.map((d) => d.days), 1);
    const niceMax = Math.max(Math.ceil(max / 5) * 5, 5);
    const step = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;

    const points = data.map((d, i) => ({
        x: padX + step * i,
        y: padTop + plotHeight - (d.days / niceMax) * plotHeight,
        ...d,
    }));
    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const areaPath = `${linePath} L ${points[points.length - 1].x} ${padTop + plotHeight} L ${points[0].x} ${padTop + plotHeight} Z`;

    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Approved leave days per month">
            {[0, 0.5, 1].map((frac) => (
                <line
                    key={frac}
                    x1={padX} x2={width - padX}
                    y1={padTop + plotHeight * frac} y2={padTop + plotHeight * frac}
                    stroke="#e1e0d9" strokeWidth={1}
                />
            ))}
            <path d={areaPath} fill={SERIES_COLOR} fillOpacity={0.1} stroke="none" />
            <path d={linePath} fill="none" stroke={SERIES_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {points.map((p) => (
                <g key={p.month}>
                    <circle cx={p.x} cy={p.y} r={4} fill={SERIES_COLOR} stroke="#fcfcfb" strokeWidth={2}>
                        <title>{`${monthLabel(p.month)}: ${p.days.toFixed(1)} days`}</title>
                    </circle>
                    <text x={p.x} y={height - 6} textAnchor="middle" fontSize={10} fill="#898781">
                        {monthLabel(p.month)}
                    </text>
                </g>
            ))}
            <text x={padX} y={padTop} fontSize={10} fill="#898781">{niceMax}d</text>
            <text x={padX} y={padTop + plotHeight} fontSize={10} fill="#898781">0d</text>
        </svg>
    );
}

const PRESETS: { id: Preset; label: string }[] = [
    { id: '30d', label: 'Last 30 days' },
    { id: '6m', label: 'Last 6 months' },
    { id: '12m', label: 'Last 12 months' },
    { id: 'ytd', label: 'This year' },
];

export type HrTab = 'overview' | 'my-leave' | 'approvals' | 'calendar' | 'staff' | 'report' | 'policies';

export function Overview({ onNavigate }: { onNavigate?: (tab: HrTab) => void }) {
    const { addToast } = useToast();
    const [preset, setPreset] = useState<Preset>('12m');
    const [customFrom, setCustomFrom] = useState(() => rangeForPreset('12m').from);
    const [customTo, setCustomTo] = useState(() => rangeForPreset('12m').to);
    const [data, setData] = useState<OverviewResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [drill, setDrill] = useState<{ dimension: Dimension; value: string; rows: BreakdownRow[] } | null>(null);
    const [drilling, setDrilling] = useState(false);

    const activeRange = preset === 'custom' ? { from: customFrom, to: customTo } : rangeForPreset(preset);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        apiClient
            .get<OverviewResponse>(`/hr/overview?from=${activeRange.from}&to=${activeRange.to}`)
            .then((res) => { if (!cancelled) setData(res); })
            .catch((err) => {
                if (!cancelled) addToast((err as Error)?.message || 'Unable to load the overview.', 'error');
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        setDrill(null);
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeRange.from, activeRange.to]);

    // Who is behind a bar. Uses the same windowed measure as the chart, so the
    // rows add up to the bar that was clicked.
    const openBreakdown = async (dimension: Dimension, value: string) => {
        if (drill?.dimension === dimension && drill.value === value) {
            setDrill(null);
            return;
        }
        setDrilling(true);
        try {
            const params = new URLSearchParams({
                dimension, value, from: activeRange.from, to: activeRange.to,
            });
            const result = await apiClient.get<{ rows: BreakdownRow[] }>(`/hr/overview/breakdown?${params}`);
            setDrill({ dimension, value, rows: result?.rows || [] });
        } catch (err) {
            addToast((err as Error)?.message || 'Unable to load the breakdown.', 'error');
        } finally {
            setDrilling(false);
        }
    };

    const liability = data?.liability ?? NO_LIABILITY;
    const exceptions = data?.exceptions ?? NO_EXCEPTIONS;
    // An older backend has no liability figure to show; hide the panel rather
    // than assert a confident zero.
    const hasLiability = Boolean(data?.liability);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 app-panel p-3">
                {PRESETS.map((p) => (
                    <button
                        key={p.id}
                        type="button"
                        onClick={() => setPreset(p.id)}
                        className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                            preset === p.id ? 'bg-[#002B7F] text-white' : 'text-zinc-600 hover:bg-zinc-50'
                        }`}
                    >
                        {p.label}
                    </button>
                ))}
                <button
                    type="button"
                    onClick={() => setPreset('custom')}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                        preset === 'custom' ? 'bg-[#002B7F] text-white' : 'text-zinc-600 hover:bg-zinc-50'
                    }`}
                >
                    Custom
                </button>
                {preset === 'custom' && (
                    <div className="flex items-center gap-2 border-l border-zinc-200 pl-3">
                        <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                            className="rounded-md border border-zinc-300 px-2 py-1 text-sm" />
                        <span className="text-sm text-zinc-500">to</span>
                        <input type="date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)}
                            className="rounded-md border border-zinc-300 px-2 py-1 text-sm" />
                    </div>
                )}
            </div>

            {loading && !data ? (
                <LoadingState label="Loading overview…" />
            ) : !data ? (
                <EmptyState title="Unable to load the overview" />
            ) : (
                <>
                    {/* The one number the Treasury actually carries: earned
                        leave not yet taken is a provision on the books. */}
                    <div className="grid gap-4 lg:grid-cols-3">
                        {hasLiability && (
                        <div className="lg:col-span-1">
                            <StatTile
                                label="Leave liability"
                                value={AUD.format(liability.value)}
                                hint={
                                    liability.staff_without_rate > 0
                                        ? `${liability.days.toFixed(1)} earned days · no rate for ${liability.staff_without_rate} of ${liability.staff_total} staff`
                                        : `${liability.days.toFixed(1)} earned days across ${liability.staff_total} staff`
                                }
                                emphasis
                            />
                        </div>
                        )}
                        <div className={`grid gap-4 sm:grid-cols-2 ${hasLiability ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
                            <StatTile label="Active staff" value={String(data.headcount.active_employees)} />
                            <StatTile label="On leave today" value={String(data.headcount.on_leave_today)} />
                            <StatTile
                                label="Days taken"
                                value={data.days_taken.toFixed(1)}
                                hint="Working days falling in this period"
                            />
                            <StatTile
                                label="Avg. approval turnaround"
                                value={data.applications.avg_turnaround_hours === null
                                    ? '—'
                                    : data.applications.avg_turnaround_hours < 24
                                        ? `${data.applications.avg_turnaround_hours.toFixed(1)}h`
                                        : `${(data.applications.avg_turnaround_hours / 24).toFixed(1)}d`}
                                hint="From applied to decided"
                            />
                        </div>
                    </div>

                    {hasLiability && liability.staff_without_rate > 0 && (
                        <p className="px-1 text-xs text-zinc-500">
                            Liability counts earned (accruable) leave only — an upfront allowance such as sick
                            leave is not owed on separation. Staff with no daily rate recorded are left out of
                            the total rather than counted as nil, so this figure is a floor.
                        </p>
                    )}

                    {/* Exceptions: the things somebody has to do something about. */}
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <ExceptionTile
                            label="Approvals waiting over 5 days"
                            count={exceptions.pending_over_five_days}
                            detail={`Oldest has waited ${exceptions.oldest_pending_days.toFixed(0)} days`}
                            onClick={onNavigate ? () => onNavigate('approvals') : undefined}
                        />
                        <ExceptionTile
                            label="Negative balances"
                            count={exceptions.negative_balances}
                            detail="More leave taken than earned"
                            tone="danger"
                            onClick={onNavigate ? () => onNavigate('report') : undefined}
                        />
                        <ExceptionTile
                            label="Excess balances"
                            count={exceptions.excess_balances}
                            detail="Holding over twice their entitlement"
                            onClick={onNavigate ? () => onNavigate('staff') : undefined}
                        />
                        <ExceptionTile
                            label="Coverage risks"
                            count={exceptions.coverage_risks.length}
                            detail="A third of a team away on one day"
                            onClick={onNavigate ? () => onNavigate('calendar') : undefined}
                        />
                    </div>

                    {exceptions.coverage_risks.length > 0 && (
                        <div className="app-panel p-5">
                            <h3 className="text-sm font-semibold text-zinc-900">Coverage risk — next 30 days</h3>
                            <p className="mt-0.5 text-xs text-zinc-500">
                                Working days where more than a third of a department is on approved leave.
                            </p>
                            <div className="mt-3 divide-y divide-zinc-100">
                                {exceptions.coverage_risks.map((risk) => (
                                    <div key={`${risk.department_code}-${risk.day}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                                        <span className="font-medium text-zinc-900">{risk.department_code}</span>
                                        <span className="text-zinc-600">{formatDate(risk.day)}</span>
                                        <span className="tabular-nums text-amber-800">
                                            {risk.people_out} of {risk.headcount} away ({risk.percent_out}%)
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <p className="px-1 text-xs text-zinc-500">
                        Days taken counts working days that fall inside the selected period, so the three
                        panels below add up to {data.days_taken.toFixed(1)} days. Applications submitted
                        ({data.applications.total} this period) counts by the date applied, which is a
                        different measure and will not match.
                    </p>

                    <ChartCard
                        title="Approved leave days per month"
                        subtitle="Working days falling in each month, so a leave spanning two months is split between them"
                        tableHeaders={['Month', 'Days', 'Applications']}
                        tableRows={data.monthly_trend.map((m) => [monthLabel(m.month), m.days.toFixed(1), m.count])}
                    >
                        <TrendLine data={data.monthly_trend} />
                    </ChartCard>

                    <div className="grid gap-4 lg:grid-cols-2">
                        <ChartCard
                            title="Days taken by leave type"
                            subtitle="Working days falling in this period"
                            tableHeaders={['Leave type', 'Days', 'Applications']}
                            tableRows={data.by_type.map((t) => [t.leave_type, t.days.toFixed(1), t.count])}
                        >
                            <HorizontalBars
                                data={data.by_type.map((t) => ({ label: t.leave_type, value: t.days }))}
                                onSelect={(label) => openBreakdown('leave_type', label)}
                                selected={drill?.dimension === 'leave_type' ? drill.value : null}
                            />
                        </ChartCard>

                        <ChartCard
                            title="Days taken by department"
                            subtitle="Working days falling in this period"
                            tableHeaders={['Department', 'Days', 'Applications']}
                            tableRows={data.by_department.map((d) => [d.department_code, d.days.toFixed(1), d.count])}
                        >
                            <HorizontalBars
                                data={data.by_department.map((d) => ({ label: d.department_code, value: d.days }))}
                                onSelect={(label) => openBreakdown('department', label)}
                                selected={drill?.dimension === 'department' ? drill.value : null}
                            />
                        </ChartCard>
                    </div>

                    {(drilling || drill) && (
                        <div className="app-panel p-5">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-sm font-semibold text-zinc-900">
                                        {drill ? `Who is behind “${drill.value}”` : 'Loading…'}
                                    </h3>
                                    <p className="mt-0.5 text-xs text-zinc-500">
                                        Same measure as the chart, so these rows add up to the bar.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setDrill(null)}
                                    className="shrink-0 rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
                                >
                                    Close
                                </button>
                            </div>
                            {drilling ? (
                                <LoadingState label="Loading breakdown…" />
                            ) : !drill?.rows.length ? (
                                <EmptyState title="Nothing in this period" />
                            ) : (
                                <div className="mt-3 overflow-x-auto">
                                    <table className="min-w-full divide-y divide-zinc-200 text-sm">
                                        <thead className="text-left text-xs font-semibold uppercase text-zinc-500">
                                            <tr>
                                                <th className="px-2 py-1.5">Staff member</th>
                                                <th className="px-2 py-1.5">
                                                    {drill.dimension === 'department' ? 'Leave type' : 'Department'}
                                                </th>
                                                <th className="px-2 py-1.5 text-right">Days</th>
                                                <th className="px-2 py-1.5 text-right">Applications</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100">
                                            {drill.rows.map((row, i) => (
                                                <tr key={`${row.employee_name}-${row.leave_type_name}-${i}`}>
                                                    <td className="px-2 py-1.5 font-medium text-zinc-900">{row.employee_name}</td>
                                                    <td className="px-2 py-1.5 text-zinc-600">
                                                        {drill.dimension === 'department' ? row.leave_type_name : row.department_code}
                                                    </td>
                                                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-700">{row.days.toFixed(1)}</td>
                                                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-700">{row.applications}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    <ChartCard
                        title="Unused leave balance by type"
                        subtitle={`Stock: available days sitting on the books across active staff, ${new Date().getFullYear()}`}
                        tableHeaders={['Leave type', 'Available days']}
                        tableRows={data.balance_by_type.map((b) => [b.leave_type, b.available_days.toFixed(1)])}
                    >
                        <HorizontalBars data={data.balance_by_type.map((b) => ({ label: b.leave_type, value: b.available_days }))} />
                    </ChartCard>

                    <div className="app-panel p-5">
                        <h3 className="text-sm font-semibold text-zinc-900">Upcoming leave — next 30 days</h3>
                        {data.upcoming.length === 0 ? (
                            <p className="mt-3 text-sm text-zinc-500">Nobody has approved leave starting in the next 30 days.</p>
                        ) : (
                            <div className="mt-3 divide-y divide-zinc-100">
                                {data.upcoming.map((u, i) => (
                                    <div key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                                        <span className="font-medium text-zinc-900">{u.employee_name}</span>
                                        <span className="text-zinc-500">{u.leave_type_name}</span>
                                        <span className="text-zinc-600">
                                            {formatDate(u.start_date)} – {formatDate(u.end_date)} ({u.days.toFixed(1)}d)
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { EmptyState, LoadingState } from '../../components/Ui';
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
    by_type: { leave_type: string; days: number; count: number }[];
    by_department: { department_code: string; days: number; count: number }[];
    monthly_trend: { month: string; days: number; count: number }[];
    upcoming: { employee_name: string; leave_type_name: string; start_date: string; end_date: string; days: number }[];
    balance_by_type: { leave_type: string; available_days: number }[];
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

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium text-zinc-500">{label}</p>
            <p className="mt-1 text-3xl font-semibold text-zinc-900">{value}</p>
            {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
        </div>
    );
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
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
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
function HorizontalBars({ data }: { data: { label: string; value: number }[] }) {
    if (!data.length) return <EmptyState title="No data for this period" />;
    const max = Math.max(...data.map((d) => d.value), 1);
    return (
        <div className="space-y-3">
            {data.map((d) => (
                <div key={d.label} className="flex items-center gap-3">
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

export function Overview() {
    const { addToast } = useToast();
    const [preset, setPreset] = useState<Preset>('12m');
    const [customFrom, setCustomFrom] = useState(() => rangeForPreset('12m').from);
    const [customTo, setCustomTo] = useState(() => rangeForPreset('12m').to);
    const [data, setData] = useState<OverviewResponse | null>(null);
    const [loading, setLoading] = useState(true);

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
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeRange.from, activeRange.to]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
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
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                        <StatTile label="Active staff" value={String(data.headcount.active_employees)} />
                        <StatTile label="On leave today" value={String(data.headcount.on_leave_today)} />
                        <StatTile label="Pending approvals" value={String(data.applications.pending)} />
                        <StatTile
                            label="Applications (period)"
                            value={String(data.applications.total)}
                            hint={`${data.applications.approved} approved · ${data.applications.rejected} rejected · ${data.applications.cancelled} cancelled`}
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

                    <ChartCard
                        title="Approved leave days per month"
                        subtitle="Working days taken, by the month leave started"
                        tableHeaders={['Month', 'Days', 'Applications']}
                        tableRows={data.monthly_trend.map((m) => [monthLabel(m.month), m.days.toFixed(1), m.count])}
                    >
                        <TrendLine data={data.monthly_trend} />
                    </ChartCard>

                    <div className="grid gap-4 lg:grid-cols-2">
                        <ChartCard
                            title="Days taken by leave type"
                            subtitle="Flow: approved leave started in this period"
                            tableHeaders={['Leave type', 'Days', 'Applications']}
                            tableRows={data.by_type.map((t) => [t.leave_type, t.days.toFixed(1), t.count])}
                        >
                            <HorizontalBars data={data.by_type.map((t) => ({ label: t.leave_type, value: t.days }))} />
                        </ChartCard>

                        <ChartCard
                            title="Days taken by department"
                            subtitle="Flow: approved leave started in this period"
                            tableHeaders={['Department', 'Days', 'Applications']}
                            tableRows={data.by_department.map((d) => [d.department_code, d.days.toFixed(1), d.count])}
                        >
                            <HorizontalBars data={data.by_department.map((d) => ({ label: d.department_code, value: d.days }))} />
                        </ChartCard>
                    </div>

                    <ChartCard
                        title="Unused leave balance by type"
                        subtitle={`Stock: available days sitting on the books across active staff, ${new Date().getFullYear()}`}
                        tableHeaders={['Leave type', 'Available days']}
                        tableRows={data.balance_by_type.map((b) => [b.leave_type, b.available_days.toFixed(1)])}
                    >
                        <HorizontalBars data={data.balance_by_type.map((b) => ({ label: b.leave_type, value: b.available_days }))} />
                    </ChartCard>

                    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
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

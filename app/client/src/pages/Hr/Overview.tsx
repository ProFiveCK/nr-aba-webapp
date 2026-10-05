import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowUpRight, Download, TriangleAlert } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useToast } from '../../contexts/useToast';
import { EmptyState, LoadingState } from '../../components/Ui';
import { formatDate } from '../../features/hr/types';
import { csvCell } from '../../features/hr/csv';
import { summarizeLeavePlanning } from '../../features/hr/leavePlanning';
import type { StaffBalancesResponse } from '../../features/hr/staffTypes';
import { toIsoDate } from '../../lib/date';

// A single, muted-blue hue throughout: every chart here compares one measure
// (days taken) by magnitude, not several series by identity, so a categorical
// palette would be the wrong tool - see the dataviz skill's choosing-a-form.
const SERIES_COLOR = '#2a78d6';

interface OverviewResponse {
    from: string;
    to: string;
    headcount: { active_employees: number; on_leave_today: number; on_study_leave?: number };
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
        pending_approvals?: number;
        pending_over_five_days: number;
        oldest_pending_days: number;
        negative_balances: number;
        excess_balances: number;
        excess_employee_names?: string[];
        coverage_risks: {
            department_code: string;
            day: string;
            people_out: number;
            headcount: number;
            percent_out: number;
        }[];
    };
}

const NO_EXCEPTIONS = {
    pending_approvals: undefined,
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

// One cell of the "right now" strip. These figures ignore the period filter,
// which is why they sit apart from the activity card that owns it.
function StatCell({ label, value, detail, attention = false }: {
    label: string;
    value: string;
    detail: string;
    attention?: boolean;
}) {
    return (
        <div className="min-w-0 p-3.5 sm:p-4">
            <p className="text-xs font-medium text-slate-600 sm:text-sm">{label}</p>
            <p className={`mt-2 text-2xl font-semibold leading-none tabular-nums tracking-tight ${
                attention ? 'text-amber-800' : 'text-[#002B7F]'
            }`}>{value}</p>
            <p className="mt-2 text-xs leading-4 text-slate-500">{detail}</p>
        </div>
    );
}

function PlanningMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
    return (
        <div className="min-w-0 p-3.5 sm:p-4">
            <dt className="text-xs font-medium text-slate-600">{label}</dt>
            <dd className="mt-2 text-xl font-semibold leading-none tabular-nums text-[#002B7F]">{value}</dd>
            <p className="mt-2 text-xs leading-4 text-slate-500">{detail}</p>
        </div>
    );
}

/** An actionable exception, attached under the strip only when its count is above zero. */
function IssueRow({
    label, count, detail, tone = 'warn', onClick,
}: {
    label: string;
    count: number;
    detail: string;
    tone?: 'warn' | 'danger';
    onClick?: () => void;
}) {
    const palette = tone === 'danger' ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-900';
    const Tag = onClick ? 'button' : 'div';
    return (
        <Tag
            {...(onClick ? { type: 'button' as const, onClick } : {})}
            className={`flex w-full items-center justify-between gap-3 border-t border-slate-200 px-4 py-2.5 text-left text-sm transition-colors ${palette} ${onClick ? 'hover:brightness-95' : ''}`}
        >
            <span className="flex min-w-0 items-center gap-2">
                <TriangleAlert size={16} className="shrink-0" aria-hidden="true" />
                <span>
                    <span className="font-semibold">{label}</span>
                    <span className="ml-2 text-xs opacity-75">{detail}</span>
                </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 font-semibold tabular-nums">
                {count}{onClick && <ArrowUpRight size={14} aria-hidden="true" />}
            </span>
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
function DataTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
    return (
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
                <thead className="text-left text-xs font-semibold uppercase text-zinc-500">
                    <tr>
                        {headers.map((h) => (
                            <th key={h} className="px-2 py-1.5">{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                    {rows.length === 0 ? (
                        <tr>
                            <td colSpan={headers.length} className="px-2 py-4 text-center text-zinc-400">
                                No data for this period.
                            </td>
                        </tr>
                    ) : (
                        rows.map((row, i) => (
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
    );
}

function TableToggle({ showTable, onToggle }: { showTable: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            className="shrink-0 rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
        >
            {showTable ? 'View charts' : 'View as table'}
        </button>
    );
}

// A titled chart inside a larger card; the card owns the table toggle.
function ChartSection({
    title, subtitle, showTable, tableHeaders, tableRows, children,
}: {
    title: string;
    subtitle?: string;
    showTable: boolean;
    tableHeaders: string[];
    tableRows: (string | number)[][];
    children: ReactNode;
}) {
    return (
        <div className="min-w-0">
            <h4 className="text-sm font-semibold text-zinc-900">{title}</h4>
            {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
            <div className="mt-3">
                {showTable ? <DataTable headers={tableHeaders} rows={tableRows} /> : children}
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
    if (data.every((item) => item.days === 0)) {
        return <EmptyState title="No approved leave days in this period" detail="The monthly trend will appear when approved leave falls within these dates." />;
    }
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
    const [balanceReport, setBalanceReport] = useState<StaffBalancesResponse | null>(null);
    const [balanceReportLoading, setBalanceReportLoading] = useState(true);
    const [furloughReviewLine, setFurloughReviewLine] = useState(0);
    const [planningType, setPlanningType] = useState<'any' | 'Annual' | 'Furlough'>('any');
    const [planningDepartment, setPlanningDepartment] = useState('all');
    const [drill, setDrill] = useState<{ dimension: Dimension; value: string; rows: BreakdownRow[] } | null>(null);
    const [drilling, setDrilling] = useState(false);
    const [showTable, setShowTable] = useState(false);
    const [showBalanceTable, setShowBalanceTable] = useState(false);

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

    useEffect(() => {
        let cancelled = false;
        apiClient.get<StaffBalancesResponse>('/hr/employees/balances')
            .then(async (result) => {
                const settings = await apiClient.get<{ furlough_review_days: number }>('/hr/planning/settings');
                let rules = result.leave_type_rules;
                if (!rules?.length) {
                    const leaveTypes = await apiClient.get<Array<{
                        name: string;
                        default_days: number | string;
                        is_accruable: boolean;
                    }>>('/hr/leave-types');
                    rules = leaveTypes.map((type) => ({
                        name: type.name,
                        default_days: Number(type.default_days),
                        is_accruable: type.is_accruable,
                    }));
                }
                if (!cancelled) {
                    setFurloughReviewLine(Number(settings?.furlough_review_days) || 0);
                    setBalanceReport({ ...result, leave_type_rules: rules });
                }
            })
            .catch((err) => {
                if (!cancelled) addToast((err as Error)?.message || 'Unable to load leave balance planning.', 'error');
            })
            .finally(() => { if (!cancelled) setBalanceReportLoading(false); });
        return () => { cancelled = true; };
    }, [addToast]);

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

    const exceptions: NonNullable<OverviewResponse['exceptions']> = data?.exceptions ?? NO_EXCEPTIONS;
    const checksAvailable = Boolean(data?.exceptions);
    const excessNames = exceptions.excess_employee_names ?? [];
    const excessDetail = excessNames.length
        ? `${excessNames.join(', ')}${exceptions.excess_balances > excessNames.length ? ` +${exceptions.excess_balances - excessNames.length} more` : ''}`
        : 'Holding over twice their entitlement';
    const annualRule = balanceReport?.leave_type_rules?.find((rule) => rule.name.toLowerCase() === 'annual');
    const annualAllocation = annualRule && Number.isFinite(Number(annualRule.default_days))
        ? Number(annualRule.default_days)
        : null;
    const planningSummary = balanceReport && annualAllocation !== null
        ? summarizeLeavePlanning(balanceReport.employees, annualAllocation, furloughReviewLine)
        : null;
    const departmentOptions = balanceReport
        ? Array.from(new Set(balanceReport.employees.map((employee) => employee.department_code || 'Unassigned'))).sort()
        : [];
    const planningRows = planningSummary?.rows.filter((row) => {
        const department = row.department_code || 'Unassigned';
        if (planningDepartment !== 'all' && department !== planningDepartment) return false;
        if (planningType === 'Annual') return row.annual.aboveLine > 0;
        if (planningType === 'Furlough') return row.furlough.aboveLine > 0;
        return true;
    }) ?? [];
    const exportPlanningRows = () => {
        const header = [
            'Name', 'Department', 'Division',
            'Annual available days', 'Annual pending days', 'Annual days above allocation',
            'Furlough available days', 'Furlough pending days', 'Furlough days above threshold',
        ];
        const rows = planningRows.map((row) => [
            row.display_name,
            row.department_code || '',
            row.division_code || '',
            row.annual.available,
            row.annual.pending,
            row.annual.aboveLine,
            row.furlough.available,
            row.furlough.pending,
            row.furlough.aboveLine,
        ]);
        const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
        const blob = new Blob([String.fromCharCode(0xfeff) + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `leave-planning-${balanceReport?.year ?? new Date().getFullYear()}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };
    const turnaround = data?.applications.avg_turnaround_hours === null || data?.applications.avg_turnaround_hours === undefined
        ? null
        : data.applications.avg_turnaround_hours < 24
            ? `${data.applications.avg_turnaround_hours.toFixed(1)} hours`
            : `${(data.applications.avg_turnaround_hours / 24).toFixed(1)} days`;

    const issues: { key: string; label: string; count: number; detail: string; tone?: 'danger'; tab: HrTab }[] = [
        {
            key: 'stale', label: 'Approvals waiting over 5 days', count: exceptions.pending_over_five_days,
            detail: `Oldest has waited ${exceptions.oldest_pending_days.toFixed(0)} days`, tab: 'approvals',
        },
        { key: 'negative', label: 'Negative balances', count: exceptions.negative_balances, detail: 'More leave taken than earned', tone: 'danger', tab: 'report' },
        { key: 'excess', label: 'Excess balances', count: exceptions.excess_balances, detail: excessDetail, tab: 'staff' },
        { key: 'coverage', label: 'Coverage risks', count: exceptions.coverage_risks.length, detail: 'A third of a team away on one day', tab: 'calendar' },
    ];

    return (
        <div className="space-y-4">
            {loading && !data ? (
                <LoadingState label="Loading overview…" />
            ) : !data ? (
                <EmptyState title="Unable to load the overview" />
            ) : (
                <>
                    <section aria-label="Right now" className="app-panel overflow-hidden">
                        <div className="grid grid-cols-3 divide-x divide-slate-200">
                            <StatCell
                                label="Pending approvals"
                                value={exceptions.pending_approvals === undefined ? '—' : String(exceptions.pending_approvals)}
                                detail={exceptions.pending_approvals === undefined
                                    ? 'Queue count unavailable'
                                    : exceptions.pending_approvals === 0
                                        ? 'Queue is clear'
                                        : `${exceptions.pending_over_five_days} waiting over 5 days`}
                                attention={Boolean(exceptions.pending_approvals)}
                            />
                            <StatCell
                                label="On leave today"
                                value={String(data.headcount.on_leave_today)}
                                detail={data.headcount.on_study_leave ? `Includes ${data.headcount.on_study_leave} on study leave` : 'Approved absences'}
                            />
                            <StatCell label="Active staff" value={String(data.headcount.active_employees)} detail="Current workforce" />
                        </div>
                        {!checksAvailable ? (
                            <p className="border-t border-slate-200 px-4 py-2.5 text-sm text-slate-600">Leave checks unavailable</p>
                        ) : (
                            issues.filter((issue) => issue.count > 0).map((issue) => (
                                <IssueRow
                                    key={issue.key}
                                    label={issue.label}
                                    count={issue.count}
                                    detail={issue.detail}
                                    tone={issue.tone}
                                    onClick={onNavigate ? () => onNavigate(issue.tab) : undefined}
                                />
                            ))
                        )}
                    </section>

                    <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
                        <section className="app-panel p-5 lg:col-span-2">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-base font-semibold text-slate-950">Leave activity</h3>
                                    <p className="mt-0.5 text-xs text-slate-500">{formatDate(data.from)} – {formatDate(data.to)}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <TableToggle showTable={showTable} onToggle={() => setShowTable((v) => !v)} />
                                    <select
                                        value={preset}
                                        onChange={(event) => setPreset(event.target.value as Preset)}
                                        aria-label="Period"
                                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"
                                    >
                                        {PRESETS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                                        <option value="custom">Custom</option>
                                    </select>
                                </div>
                            </div>
                            {preset === 'custom' && (
                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                    <label className="text-xs font-medium text-slate-600">From
                                        <input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)}
                                            className="mt-1 block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm" />
                                    </label>
                                    <label className="text-xs font-medium text-slate-600">To
                                        <input type="date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)}
                                            className="mt-1 block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm" />
                                    </label>
                                </div>
                            )}

                            <dl className="mt-4 grid grid-cols-3 gap-3 border-y border-slate-100 py-3">
                                <div>
                                    <dt className="text-xs text-slate-500">Approved days</dt>
                                    <dd className="mt-1 text-lg font-semibold tabular-nums text-[#002B7F]">{data.days_taken.toFixed(1)}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-slate-500">Applications</dt>
                                    <dd className="mt-1 text-lg font-semibold tabular-nums text-[#002B7F]">{data.applications.total}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-slate-500">Avg. approval time</dt>
                                    <dd className={`mt-1 tabular-nums ${turnaround ? 'text-lg font-semibold text-[#002B7F]' : 'pt-1 text-sm text-slate-500'}`}>
                                        {turnaround ?? 'No decisions yet'}
                                    </dd>
                                </div>
                            </dl>

                            <div className="mt-5 space-y-6">
                                <ChartSection
                                    title="Approved leave days per month"
                                    subtitle="A leave spanning two months is split between them"
                                    showTable={showTable}
                                    tableHeaders={['Month', 'Days', 'Applications']}
                                    tableRows={data.monthly_trend.map((m) => [monthLabel(m.month), m.days.toFixed(1), m.count])}
                                >
                                    <TrendLine data={data.monthly_trend} />
                                </ChartSection>

                                <div className="grid gap-6 md:grid-cols-2">
                                    <ChartSection
                                        title="By leave type"
                                        showTable={showTable}
                                        tableHeaders={['Leave type', 'Days', 'Applications']}
                                        tableRows={data.by_type.map((t) => [t.leave_type, t.days.toFixed(1), t.count])}
                                    >
                                        <HorizontalBars
                                            data={data.by_type.map((t) => ({ label: t.leave_type, value: t.days }))}
                                            onSelect={(label) => openBreakdown('leave_type', label)}
                                            selected={drill?.dimension === 'leave_type' ? drill.value : null}
                                        />
                                    </ChartSection>
                                    <ChartSection
                                        title="By department"
                                        showTable={showTable}
                                        tableHeaders={['Department', 'Days', 'Applications']}
                                        tableRows={data.by_department.map((d) => [d.department_code, d.days.toFixed(1), d.count])}
                                    >
                                        <HorizontalBars
                                            data={data.by_department.map((d) => ({ label: d.department_code, value: d.days }))}
                                            onSelect={(label) => openBreakdown('department', label)}
                                            selected={drill?.dimension === 'department' ? drill.value : null}
                                        />
                                    </ChartSection>
                                </div>
                            </div>

                            {(drilling || drill) && (
                                <div className="mt-6 border-t border-slate-100 pt-4">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <h4 className="text-sm font-semibold text-zinc-900">
                                                {drill ? `Who is behind “${drill.value}”` : 'Loading…'}
                                            </h4>
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

                            <p className="mt-5 text-xs leading-5 text-zinc-500">
                                Days are working days within the selected dates. Applications are counted by application date.
                            </p>
                        </section>

                        <div className="space-y-4">
                            <section className="app-panel p-5">
                                <h3 className="text-base font-semibold text-slate-950">Next 30 days</h3>
                                {exceptions.coverage_risks.length > 0 && (
                                    <div className="mt-3 space-y-1.5">
                                        <p className="text-xs font-medium text-amber-800">Coverage risk: over a third of a department away</p>
                                        {exceptions.coverage_risks.map((risk) => (
                                            <div key={`${risk.department_code}-${risk.day}`} className="flex justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                                <span><span className="font-semibold">{risk.department_code}</span> · {formatDate(risk.day)}</span>
                                                <span className="tabular-nums">{risk.people_out} of {risk.headcount} ({risk.percent_out}%)</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {data.upcoming.length === 0 ? (
                                    <p className="mt-3 text-sm text-zinc-500">Nobody has approved leave starting in the next 30 days.</p>
                                ) : (
                                    <div className="mt-3 divide-y divide-zinc-100">
                                        {data.upcoming.map((u, i) => (
                                            <div key={i} className="py-2 text-sm">
                                                <div className="flex justify-between gap-3">
                                                    <span className="font-medium text-zinc-900">{u.employee_name}</span>
                                                    <span className="shrink-0 tabular-nums text-zinc-600">{u.days.toFixed(1)}d</span>
                                                </div>
                                                <p className="text-xs text-zinc-500">
                                                    {u.leave_type_name} · {formatDate(u.start_date)} – {formatDate(u.end_date)}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>

                            <section className="app-panel p-5">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <h3 className="text-base font-semibold text-slate-950">Unused balance</h3>
                                        <p className="mt-0.5 text-xs text-zinc-500">Available days across active staff, {new Date().getFullYear()}</p>
                                    </div>
                                    <TableToggle showTable={showBalanceTable} onToggle={() => setShowBalanceTable((v) => !v)} />
                                </div>
                                <div className="mt-4">
                                    {showBalanceTable ? (
                                        <DataTable
                                            headers={['Leave type', 'Available days']}
                                            rows={data.balance_by_type.map((b) => [b.leave_type, b.available_days.toFixed(1)])}
                                        />
                                    ) : (
                                        <HorizontalBars data={data.balance_by_type.map((b) => ({ label: b.leave_type, value: b.available_days }))} />
                                    )}
                                </div>
                            </section>
                        </div>
                    </div>

                    <section aria-labelledby="leave-planning-title" className="app-panel overflow-hidden">
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-4">
                            <div>
                                <h3 id="leave-planning-title" className="text-base font-semibold text-slate-950">Leave planning</h3>
                                <p className="mt-1 text-sm text-slate-600">Staff with Annual or Furlough days to plan</p>
                            </div>
                            <button type="button" onClick={exportPlanningRows} disabled={!planningRows.length}
                                className="inline-flex min-h-9 items-center justify-center gap-2 rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                                <Download size={15} aria-hidden="true" /> Export list
                            </button>
                        </div>

                        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="max-w-4xl text-sm leading-5 text-slate-700">
                                Available days = balance minus pending leave. Staff are listed when they hold more than the amounts below. A Leave Admin sets these in HR Policies.
                            </p>
                            {annualAllocation !== null && (
                                <p className="mt-2 text-sm font-medium text-slate-800">
                                    Annual: above {annualAllocation} days (yearly allocation) · Furlough: above {furloughReviewLine} days
                                </p>
                            )}
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                <label className="text-xs font-medium text-slate-600">Show
                                    <select value={planningType} onChange={(event) => setPlanningType(event.target.value as typeof planningType)}
                                        className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900">
                                        <option value="any">Both leave types</option>
                                        <option value="Annual">Annual only</option>
                                        <option value="Furlough">Furlough only</option>
                                    </select>
                                </label>
                                <label className="text-xs font-medium text-slate-600">Department
                                    <select value={planningDepartment} onChange={(event) => setPlanningDepartment(event.target.value)}
                                        className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900">
                                        <option value="all">All departments</option>
                                        {departmentOptions.map((department) => <option key={department} value={department}>{department}</option>)}
                                    </select>
                                </label>
                            </div>
                        </div>

                        {balanceReportLoading ? (
                            <div className="p-4"><LoadingState label="Loading leave balances…" /></div>
                        ) : !balanceReport || annualAllocation === null || !planningSummary ? (
                            <p className="px-4 py-4 text-sm text-amber-900">Annual allocation could not be loaded. Check the Annual leave type in HR Policies → Leave types, then refresh.</p>
                        ) : (
                            <>
                                <dl className="grid grid-cols-1 divide-y divide-slate-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                                    <PlanningMetric label="People to plan with" value={String(planningSummary.staffToReview)} detail="Above at least one comparison amount" />
                                    <PlanningMetric label="Annual days above allocation" value={`${planningSummary.annualDaysAbove.toFixed(1)}d`} detail={`${planningSummary.annualStaffAbove} people · ${planningSummary.annualAvailable.toFixed(1)}d available in total`} />
                                    <PlanningMetric label="Furlough days above threshold" value={`${planningSummary.furloughDaysAbove.toFixed(1)}d`} detail={`${planningSummary.furloughStaffAbove} people · ${planningSummary.furloughAvailable.toFixed(1)}d available in total`} />
                                </dl>

                                <div className="max-h-[28rem] overflow-auto">
                                    <table className="min-w-full border-separate border-spacing-0 text-sm">
                                        <thead>
                                            <tr>
                                                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">Staff member</th>
                                                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">Department / division</th>
                                                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs font-semibold uppercase text-slate-500">Annual above allocation</th>
                                                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs font-semibold uppercase text-slate-500">Furlough above threshold</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {planningRows.map((row) => (
                                                <tr key={row.id} className="hover:bg-slate-50">
                                                    <td className="px-4 py-2 font-medium text-slate-900">{row.display_name}</td>
                                                    <td className="px-3 py-2 text-slate-600">{row.department_code || '—'} / {row.division_code || '—'}</td>
                                                    <td className="px-3 py-2 text-right tabular-nums">
                                                        <span className="font-semibold text-amber-800">{row.annual.aboveLine.toFixed(1)}d above</span>
                                                        <span className="block text-xs text-slate-500">{row.annual.available.toFixed(1)}d available{row.annual.pending > 0 ? ` · ${row.annual.pending}d pending` : ''}</span>
                                                    </td>
                                                    <td className="px-3 py-2 text-right tabular-nums">
                                                        <span className="font-semibold text-amber-800">{row.furlough.aboveLine.toFixed(1)}d above</span>
                                                        <span className="block text-xs text-slate-500">{row.furlough.available.toFixed(1)}d available{row.furlough.pending > 0 ? ` · ${row.furlough.pending}d pending` : ''}</span>
                                                    </td>
                                                </tr>
                                            ))}
                                            {planningRows.length === 0 && (
                                                <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">No staff exceed the selected amounts.</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}

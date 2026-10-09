import { AustralianDateInput } from '../../../components/AustralianDateInput';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ArrowUpRight, CalendarDays, ClipboardCheck, Download, TriangleAlert, Users } from 'lucide-react';
import { apiClient } from '../../../lib/api';
import { useToast } from '../../../contexts/useToast';
import { EmptyState, LoadingState } from '../../../components/Ui';
import { formatDate } from '../types';
import { csvCell } from '../../../lib/csv';
import { summarizeLeavePlanning } from '../leavePlanning';
import type { LeavePlanningRow, PlanningReport } from '../leavePlanning';
import { compareCells, useTableSort } from '../../../lib/tableSort';
import { SortHeader } from '../../../components/SortHeader';
import { toIsoDate } from '../../../lib/date';

// A single, muted-blue hue throughout: every chart here compares one measure
// (days taken) by magnitude, not several series by identity, so a categorical
// palette would be the wrong tool - see the dataviz skill's choosing-a-form.
const SERIES_COLOR = '#2a78d6';

type PlanningSortKey = 'name' | 'department' | 'staffCount' | 'recreation' | 'medical' | 'special' | 'pending';

const PLANNING_TH = 'sticky top-0 z-10 border-b border-gray-200 bg-gray-50 px-4 py-2 text-left text-xs font-semibold uppercase text-gray-500';
const PLANNING_TH_RIGHT = 'sticky top-0 z-10 border-b border-gray-200 bg-gray-50 px-3 py-2 text-right text-xs font-semibold uppercase text-gray-500';

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
    exceptions?: {
        pending_approvals?: number;
        pending_over_five_days: number;
        oldest_pending_days: number;
        negative_balances: number;
        study_leave_return_due?: number;
        study_leave_return_names?: string[];
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
    study_leave_return_due: 0,
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
        <div className="min-w-0 p-4 sm:p-6">
            <p className="min-h-8 text-xs font-medium text-gray-600 sm:min-h-0 sm:text-sm">{label}</p>
            <p className={`mt-3 text-3xl font-semibold leading-none tabular-nums tracking-tight ${
                attention ? 'text-amber-800' : 'text-brand'
            }`}>{value}</p>
            <p className="mt-2 hidden text-xs leading-5 text-gray-500 sm:block">{detail}</p>
        </div>
    );
}

function PlanningMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
    return (
        <div className="min-w-0 p-3.5 sm:p-4">
            <dt className="min-h-12 text-xs font-medium text-gray-600 sm:min-h-0">{label}</dt>
            <dd className="mt-2 text-xl font-semibold leading-none tabular-nums text-brand">{value}</dd>
            <p className="mt-2 hidden text-xs leading-5 text-gray-500 sm:block">{detail}</p>
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
            className={`flex w-full items-center justify-between gap-3 border-t border-gray-200 px-4 py-2.5 text-left text-sm transition-colors ${palette} ${onClick ? 'hover:brightness-95' : ''}`}
        >
            <span className="flex min-w-0 items-center gap-2">
                <TriangleAlert size={16} className="shrink-0" aria-hidden="true" />
                <span>
                    <span className="font-semibold">{label}</span>
                    <span className="mt-1 block text-xs opacity-80 sm:ml-2 sm:mt-0 sm:inline">{detail}</span>
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
            <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="text-left text-xs font-semibold uppercase text-gray-500">
                    <tr>
                        {headers.map((h) => (
                            <th key={h} className="px-2 py-1.5">{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {rows.length === 0 ? (
                        <tr>
                            <td colSpan={headers.length} className="px-2 py-4 text-center text-gray-400">
                                No data for this period.
                            </td>
                        </tr>
                    ) : (
                        rows.map((row, i) => (
                            <tr key={i}>
                                {row.map((cell, j) => (
                                    <td key={j} className="px-2 py-1.5 text-gray-700">{cell}</td>
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
            aria-pressed={showTable}
            className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
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
            <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
            {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
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
                    className={`flex items-center gap-3 rounded ${onSelect ? 'cursor-pointer px-1 py-0.5 hover:bg-gray-50' : ''} ${
                        selected === d.label ? 'bg-gray-100' : ''
                    }`}
                >
                    <div className="w-32 shrink-0 truncate text-xs text-gray-600" title={d.label}>
                        {d.label}
                    </div>
                    <div className="h-3 flex-1 min-w-0">
                        <div
                            className="h-3 rounded-r"
                            style={{ width: `${Math.max((d.value / max) * 100, 2)}%`, backgroundColor: SERIES_COLOR }}
                        />
                    </div>
                    <div className="w-16 shrink-0 text-right text-xs font-medium text-gray-700">
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
    const [balanceReport, setBalanceReport] = useState<PlanningReport | null>(null);
    const [balanceReportLoading, setBalanceReportLoading] = useState(true);
    const planningSort = useTableSort<PlanningSortKey>({ key: 'recreation', direction: 'desc' });
    const [planningDepartment, setPlanningDepartment] = useState('all');
    const [planningView, setPlanningView] = useState<'departments' | 'staff'>('departments');
    const [planningSearch, setPlanningSearch] = useState('');
    const [planningPage, setPlanningPage] = useState(1);
    const [drill, setDrill] = useState<{ dimension: Dimension; value: string; rows: BreakdownRow[] } | null>(null);
    const [drilling, setDrilling] = useState(false);
    const [showTable, setShowTable] = useState(false);

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
        apiClient.get<PlanningReport>('/hr/overview/planning')
            .then((result) => { if (!cancelled) setBalanceReport(result); })
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

    const exceptions: NonNullable<OverviewResponse['exceptions']> = { ...NO_EXCEPTIONS, ...data?.exceptions };
    const checksAvailable = Boolean(data?.exceptions);
    // Nothing restores eligibility when a study-leave return date passes, so
    // until someone does the person accrues nothing and cannot apply for leave.
    const studyReturnNames = exceptions.study_leave_return_names ?? [];
    const studyReturnCount = exceptions.study_leave_return_due ?? 0;
    const studyReturnDetail = studyReturnNames.length
        ? `${studyReturnNames.join(', ')}${studyReturnCount > studyReturnNames.length ? ` +${studyReturnCount - studyReturnNames.length} more` : ''} — restore their leave eligibility`
        : 'Still marked as away; restore their leave eligibility';
    const planningSummary = balanceReport ? summarizeLeavePlanning(balanceReport.employees) : null;
    const departmentOptions = balanceReport
        ? Array.from(new Set(balanceReport.employees.map((employee) => employee.department_code || 'Unassigned'))).sort()
        : [];
    const planningCell = (row: LeavePlanningRow, key: PlanningSortKey) => key === 'name'
        ? row.display_name : key === 'department' ? row.department_code : row[key];
    const departmentRows = (planningSummary?.rows ?? []).filter(row => planningDepartment === 'all'
        || (row.department_code || 'Unassigned') === planningDepartment);
    const recreationStaff = departmentRows.filter(row => row.recreation !== null);
    const recreationDays = recreationStaff.reduce((n, row) => n + (row.recreation ?? 0), 0);
    const planningRows = (planningView === 'departments' ? planningSummary?.departments ?? [] : departmentRows)
        .filter(row => planningDepartment === 'all' || (row.department_code || 'Unassigned') === planningDepartment)
        .filter(row => `${row.display_name} ${row.department_code ?? ''} ${row.division_code ?? ''}`.toLowerCase().includes(planningSearch.trim().toLowerCase()))
        .slice().sort((a, b) => compareCells(planningCell(a, planningSort.sort.key), planningCell(b, planningSort.sort.key), planningSort.sort.direction)
            || a.display_name.localeCompare(b.display_name));
    const pageCount = Math.max(1, Math.ceil(planningRows.length / 25));
    const currentPage = Math.min(planningPage, pageCount);
    const visiblePlanningRows = planningRows.slice((currentPage - 1) * 25, currentPage * 25);
    const planningDays = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}d`;
    const exportPlanningRows = () => {
        const header = [planningView === 'departments' ? 'Department' : 'Name', 'Department', 'Division', 'Staff', 'Recreation available days', 'Medical available days', 'Special available days', 'Pending days'];
        const rows = planningRows.map(row => [row.display_name, row.department_code || '', row.division_code || '', row.staffCount, row.recreation ?? '', row.medical ?? '', row.special ?? '', row.pending]);
        const csv = [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
        const blob = new Blob([String.fromCharCode(0xfeff) + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `leave-planning-${planningView}-${balanceReport?.year ?? new Date().getFullYear()}.csv`;
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
        {
            key: 'study-return', label: 'Study leave return date passed',
            count: exceptions.study_leave_return_due ?? 0, detail: studyReturnDetail, tab: 'staff',
        },
        { key: 'coverage', label: 'Coverage risks', count: exceptions.coverage_risks.length, detail: 'A third of a team away on one day', tab: 'calendar' },
    ];

    return (
        <div className="space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-gray-950">Leave overview</h2>
                    <p className="mt-2 text-sm text-gray-600">Today’s priorities, team availability and leave balances.</p>
                </div>
                <nav aria-label="Leave shortcuts" className="flex flex-wrap gap-2">
                    <Link to="/leave/approvals" className="toolbar-button toolbar-button-primary min-h-11"><ClipboardCheck size={17} aria-hidden="true" />Review applications</Link>
                    <Link to="/leave/employees" className="toolbar-button min-h-11"><Users size={17} aria-hidden="true" />Employees</Link>
                    <Link to="/leave/calendar" className="toolbar-button min-h-11"><CalendarDays size={17} aria-hidden="true" />Calendar</Link>
                </nav>
            </header>
            {loading && !data ? (
                <LoadingState label="Loading overview…" />
            ) : !data ? (
                <EmptyState title="Unable to load the overview" />
            ) : (
                <>
                    <section aria-label="Right now" className="app-panel overflow-hidden">
                        <div className="grid grid-cols-3 divide-x divide-gray-200">
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
                            <p className="border-t border-gray-200 px-4 py-2.5 text-sm text-gray-600">Leave checks unavailable</p>
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

                    <section aria-labelledby="leave-planning-title" className="app-panel overflow-hidden">
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-4 py-4">
                            <div>
                                <h3 id="leave-planning-title" className="text-base font-semibold text-gray-950">Leave planning</h3>
                                <p className="mt-1 text-sm text-gray-600">Available leave across departments and staff</p>
                            </div>
                            <button type="button" onClick={exportPlanningRows} disabled={!planningRows.length}
                                className="inline-flex min-h-9 items-center justify-center gap-2 rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                                <Download size={15} aria-hidden="true" /> Export list
                            </button>
                        </div>
                        <div className="flex flex-wrap items-end gap-3 border-b border-gray-200 px-4 py-3">
                            <div className="inline-flex rounded-lg border border-gray-300 p-1" aria-label="Planning view">
                                {(['departments', 'staff'] as const).map(view => <button key={view} type="button" aria-pressed={planningView === view}
                                    onClick={() => { setPlanningView(view); setPlanningPage(1); setPlanningSearch(''); }}
                                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${planningView === view ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                                    {view === 'departments' ? 'Departments' : 'Staff'}
                                </button>)}
                            </div>
                            <label className="min-w-0 w-full text-sm font-medium text-gray-600 sm:w-auto sm:max-w-xs">Department
                                <select value={planningDepartment} onChange={event => { setPlanningDepartment(event.target.value); setPlanningPage(1); }}
                                    className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900">
                                    <option value="all">All departments</option>
                                    {departmentOptions.map(department => <option key={department} value={department}>{department}</option>)}
                                </select>
                            </label>
                            <label className="min-w-0 flex-1 basis-48 text-sm font-medium text-gray-600">Search
                                <input value={planningSearch} onChange={event => { setPlanningSearch(event.target.value); setPlanningPage(1); }}
                                    placeholder={planningView === 'staff' ? 'Name, department or division' : 'Department'}
                                    className="mt-2 block w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900" />
                            </label>
                        </div>
                        {balanceReportLoading ? (
                            <div className="p-4"><LoadingState label="Loading leave balances…" /></div>
                        ) : !planningSummary ? (
                            <p className="px-4 py-4 text-sm text-amber-900">Leave balances could not be loaded. Try refreshing.</p>
                        ) : (
                            <>
                                <dl className="grid grid-cols-3 divide-x divide-gray-200">
                                    <PlanningMetric label="Recreation days available" value={`${recreationDays.toFixed(1)}d`} detail="After pending leave" />
                                    <PlanningMetric label="Average recreation balance" value={recreationStaff.length ? `${(recreationDays / recreationStaff.length).toFixed(1)}d` : '—'} detail={`Across ${recreationStaff.length} staff with a recreation balance`} />
                                    <PlanningMetric label="Staff with pending leave" value={String(departmentRows.filter(row => row.pending > 0).length)} detail={`Across ${departmentRows.length} leave-entitled staff`} />
                                </dl>
                                <div className="overflow-auto">
                                    <table className="min-w-full border-separate border-spacing-0 text-sm">
                                        <thead><tr>
                                            <SortHeader label={planningView === 'staff' ? 'Staff member' : 'Department'} sortKey="name" sort={planningSort.sort} onSort={planningSort.toggle} defaultDirection="asc" className={PLANNING_TH} />
                                            <SortHeader label={planningView === 'staff' ? 'Department / division' : 'Staff'} sortKey={planningView === 'staff' ? 'department' : 'staffCount'} sort={planningSort.sort} onSort={planningSort.toggle} className={PLANNING_TH} />
                                            {(['recreation', 'medical', 'special', 'pending'] as const).map(key => <SortHeader key={key} label={key.charAt(0).toUpperCase() + key.slice(1)} sortKey={key} sort={planningSort.sort}
                                                onSort={planningSort.toggle} align="right" className={PLANNING_TH_RIGHT} />)}
                                        </tr></thead>
                                        <tbody>
                                            {visiblePlanningRows.map(row => <tr key={row.id} className="hover:bg-gray-50">
                                                <td className="border-b border-gray-100 px-4 py-3 font-medium text-gray-900">
                                                    {planningView === 'departments' ? <button type="button" className="text-brand hover:underline" onClick={() => { setPlanningDepartment(row.department_code || 'Unassigned'); setPlanningView('staff'); setPlanningSearch(''); setPlanningPage(1); }}>{row.display_name}</button> : row.display_name}
                                                </td>
                                                <td className="border-b border-gray-100 px-3 py-3 text-gray-600">{planningView === 'staff' ? `${row.department_code || '—'} / ${row.division_code || '—'}` : row.staffCount}</td>
                                                {(['recreation', 'medical', 'special', 'pending'] as const).map(key => <td key={key} className={`border-b border-gray-100 px-3 py-3 text-right tabular-nums ${key === 'recreation' ? 'font-semibold text-brand' : 'text-gray-700'}`}>{planningDays(row[key])}</td>)}
                                            </tr>)}
                                            {!planningRows.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">No matching staff or departments.</td></tr>}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-gray-600">
                                    <p>{planningRows.length ? `${(currentPage - 1) * 25 + 1}–${Math.min(currentPage * 25, planningRows.length)}` : '0'} of {planningRows.length} {planningView === 'staff' ? 'staff' : 'departments'}</p>
                                    <div className="flex items-center gap-3">
                                        <button type="button" disabled={currentPage === 1} onClick={() => setPlanningPage(currentPage - 1)} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">Previous</button>
                                        <span>Page {currentPage} of {pageCount}</span>
                                        <button type="button" disabled={currentPage === pageCount} onClick={() => setPlanningPage(currentPage + 1)} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">Next</button>
                                    </div>
                                </div>
                                <p className="border-t border-gray-100 px-4 py-3 text-xs text-gray-500">Available days exclude pending leave. A dash means no current balance is recorded. Annual leave is shown as Recreation; sick leave is shown as Medical.</p>
                            </>
                        )}
                    </section>

                    <div className="grid gap-6 xl:grid-cols-3 xl:items-start">
                        <section className="app-panel p-5 sm:p-6 xl:col-span-2">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-base font-semibold text-gray-950">Leave activity</h3>
                                    <p className="mt-0.5 text-xs text-gray-500">{formatDate(data.from)} – {formatDate(data.to)}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <TableToggle showTable={showTable} onToggle={() => setShowTable((v) => !v)} />
                                    <select
                                        value={preset}
                                        onChange={(event) => setPreset(event.target.value as Preset)}
                                        aria-label="Period"
                                        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900"
                                    >
                                        {PRESETS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                                        <option value="custom">Custom</option>
                                    </select>
                                </div>
                            </div>
                            {preset === 'custom' && (
                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                    <label className="text-xs font-medium text-gray-600">From
                                        <AustralianDateInput value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)}
                                            className="mt-1 block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                                    </label>
                                    <label className="text-xs font-medium text-gray-600">To
                                        <AustralianDateInput value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)}
                                            className="mt-1 block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                                    </label>
                                </div>
                            )}

                            <dl className="mt-4 grid grid-cols-3 gap-3 border-y border-gray-100 py-3">
                                <div>
                                    <dt className="text-xs text-gray-500">Approved days</dt>
                                    <dd className="mt-1 text-lg font-semibold tabular-nums text-brand">{data.days_taken.toFixed(1)}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-gray-500">Applications</dt>
                                    <dd className="mt-1 text-lg font-semibold tabular-nums text-brand">{data.applications.total}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-gray-500">Avg. decision time</dt>
                                    <dd className={`mt-1 tabular-nums ${turnaround ? 'text-lg font-semibold text-brand' : 'pt-1 text-sm text-gray-500'}`}>
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

                                <details className="rounded-xl border border-gray-200 p-4">
                                    <summary className="cursor-pointer font-medium text-gray-800">Breakdown by leave type and department</summary>
                                <div className="mt-4 grid gap-6 md:grid-cols-2">
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
                                </details>
                            </div>

                            {(drilling || drill) && (
                                <div className="mt-6 border-t border-gray-100 pt-4">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <h4 className="text-sm font-semibold text-gray-900">
                                                {drill ? `Who is behind “${drill.value}”` : 'Loading…'}
                                            </h4>
                                            <p className="mt-0.5 text-xs text-gray-500">
                                                Same measure as the chart, so these rows add up to the bar.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setDrill(null)}
                                            className="shrink-0 rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
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
                                            <table className="min-w-full divide-y divide-gray-200 text-sm">
                                                <thead className="text-left text-xs font-semibold uppercase text-gray-500">
                                                    <tr>
                                                        <th className="px-2 py-1.5">Staff member</th>
                                                        <th className="px-2 py-1.5">
                                                            {drill.dimension === 'department' ? 'Leave type' : 'Department'}
                                                        </th>
                                                        <th className="px-2 py-1.5 text-right">Days</th>
                                                        <th className="px-2 py-1.5 text-right">Applications</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {drill.rows.map((row, i) => (
                                                        <tr key={`${row.employee_name}-${row.leave_type_name}-${i}`}>
                                                            <td className="px-2 py-1.5 font-medium text-gray-900">{row.employee_name}</td>
                                                            <td className="px-2 py-1.5 text-gray-600">
                                                                {drill.dimension === 'department' ? row.leave_type_name : row.department_code}
                                                            </td>
                                                            <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">{row.days.toFixed(1)}</td>
                                                            <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">{row.applications}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}

                            <p className="mt-5 text-xs leading-5 text-gray-500">
                                Approved absence days fall within the selected dates and reflect the employee’s work schedule. Applications are counted by application date.
                            </p>
                        </section>

                        <div className="space-y-6">
                            <section className="app-panel p-5">
                                <h3 className="text-base font-semibold text-gray-950">Next 30 days</h3>
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
                                    <p className="mt-3 text-sm text-gray-500">Nobody has approved leave starting in the next 30 days.</p>
                                ) : (
                                    <div className="mt-3 divide-y divide-gray-100">
                                        {data.upcoming.map((u, i) => (
                                            <div key={i} className="py-2 text-sm">
                                                <div className="flex justify-between gap-3">
                                                    <span className="font-medium text-gray-900">{u.employee_name}</span>
                                                    <span className="shrink-0 tabular-nums text-gray-600">{u.days.toFixed(1)}d</span>
                                                </div>
                                                <p className="text-xs text-gray-500">
                                                    {u.leave_type_name} · {formatDate(u.start_date)} – {formatDate(u.end_date)}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>


                        </div>
                    </div>


                </>
            )}
        </div>
    );
}

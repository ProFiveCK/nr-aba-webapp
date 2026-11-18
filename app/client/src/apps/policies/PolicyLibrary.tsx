import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, Plus, Search } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { formatDate } from '../../lib/date';
import { Button, Card, EmptyState, LoadingState } from '../../components/Ui';
import { PolicyDetailsModal } from './PolicyDetailsModal';
import { snippetParts, typeLabel } from './policyContent';
import type { PolicyDocument, PolicyListItem, PolicyMeta } from './types';

/** What editors and publishers can narrow the list to; readers only ever see what is in force. */
const STATES = [
    { key: '', label: 'Everything' },
    { key: 'draft', label: 'Has a draft' },
    { key: 'unpublished', label: 'Not yet published' },
    { key: 'overdue', label: 'Review overdue' },
    { key: 'withdrawn', label: 'Withdrawn' },
] as const;

function inState(item: PolicyListItem, state: string): boolean {
    switch (state) {
        case 'draft': return item.draft_version_no != null;
        case 'unpublished': return item.published_version_no == null;
        case 'overdue': return !!item.review_overdue && !item.retired_at;
        case 'withdrawn': return !!item.retired_at;
        default: return true;
    }
}

function Badge({ tone, children }: { tone: 'amber' | 'gray' | 'rose' | 'blue'; children: string }) {
    const tones = {
        amber: 'bg-amber-50 text-amber-800 ring-amber-200',
        gray: 'bg-gray-100 text-gray-700 ring-gray-200',
        rose: 'bg-rose-50 text-rose-700 ring-rose-200',
        blue: 'bg-blue-50 text-brand ring-blue-200',
    };
    return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}

export function PolicyLibrary({ meta, onMetaChanged }: { meta: PolicyMeta; onMetaChanged: () => Promise<void> }) {
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const q = params.get('q') ?? '';
    const type = params.get('type') ?? '';
    const category = params.get('category') ?? '';
    const department = params.get('department') ?? '';
    const state = params.get('state') ?? '';
    const manager = meta.can_edit || meta.can_publish;

    // The box updates as people type; the address, and so the search, follows after a pause.
    const [typed, setTyped] = useState(q);
    const [items, setItems] = useState<PolicyListItem[] | null>(null);
    const [error, setError] = useState('');
    const [creating, setCreating] = useState(false);

    const setParam = (key: string, value: string) => setParams((current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value); else next.delete(key);
        return next;
    }, { replace: true });

    useEffect(() => {
        if (typed.trim() === q) return;
        const timer = setTimeout(() => setParam('q', typed.trim()), 300);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [typed]);

    useEffect(() => {
        const controller = new AbortController();
        const query = new URLSearchParams();
        if (q) query.set('q', q);
        if (type) query.set('type', type);
        if (category) query.set('category', category);
        if (department) query.set('department_id', department);
        apiClient.get<PolicyListItem[]>(`/policies?${query}`, { signal: controller.signal })
            .then((rows) => { setItems(rows); setError(''); })
            .catch((err) => { if (!controller.signal.aborted) setError((err as Error).message || 'The library could not be loaded.'); });
        return () => controller.abort();
    }, [q, type, category, department]);

    const shown = useMemo(() => (items ?? []).filter((item) => inState(item, state)), [items, state]);
    const filtered = !!(q || type || category || department || state);

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900">Policies &amp; Procedures</h2>
                    <p className="text-gray-600">The policies, procedures and guidelines in force. Search them, read them, print them.</p>
                </div>
                {meta.can_edit && (
                    <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />New document</Button>
                )}
            </div>

            <Card>
                <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
                    <label className="relative block">
                        <span className="sr-only">Search the library</span>
                        <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search titles, codes and text"
                            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" />
                    </label>
                    <select aria-label="Kind of document" value={type} onChange={(e) => setParam('type', e.target.value)}
                        className="rounded-lg border border-gray-300 px-3 py-2">
                        <option value="">All kinds</option>
                        {meta.types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </select>
                    <select aria-label="Category" value={category} onChange={(e) => setParam('category', e.target.value)}
                        className="rounded-lg border border-gray-300 px-3 py-2">
                        <option value="">All categories</option>
                        {meta.categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select aria-label="Owning department" value={department} onChange={(e) => setParam('department', e.target.value)}
                        className="rounded-lg border border-gray-300 px-3 py-2">
                        <option value="">All departments</option>
                        {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                </div>
                {manager && (
                    <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Show">
                        {STATES.map((s) => (
                            <button key={s.key} type="button" onClick={() => setParam('state', s.key)} aria-pressed={state === s.key}
                                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${state === s.key ? 'border-brand bg-brand text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
                                {s.label}
                            </button>
                        ))}
                    </div>
                )}
            </Card>

            {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p>}
            {!items && !error && <LoadingState label="Loading the library…" />}
            {items && !shown.length && (
                <Card>
                    <EmptyState
                        title={filtered ? 'Nothing matches that search.' : 'Nothing has been published yet.'}
                        detail={filtered ? 'Try other words, or clear the filters.' : manager ? 'Register a document with New document, write it, then publish it.' : 'Published policies and procedures will appear here.'}
                    />
                </Card>
            )}
            {!!shown.length && (
                <ul className="space-y-3" aria-label="Documents">
                    {shown.map((item) => (
                        <li key={item.id}>
                            <Link to={`/policies/${item.id}`}
                                className="group block rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-brand/30 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                                <div className="flex items-start gap-3">
                                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
                                        <FileText size={18} aria-hidden="true" />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            {item.code} · {typeLabel(meta, item.doc_type)}
                                        </p>
                                        <h3 className="text-base font-semibold text-gray-900 group-hover:text-brand">{item.title}</h3>
                                        <p className="text-gray-600">
                                            {[item.category, item.department_name].filter(Boolean).join(' · ')}
                                            {item.published_version_no != null && (
                                                <span className="text-gray-500">
                                                    {(item.category || item.department_name) ? ' · ' : ''}Version {item.published_version_no}, in force since {formatDate(item.published_at)}
                                                </span>
                                            )}
                                        </p>
                                        {item.snippet && (
                                            <p className="mt-1 text-gray-600">
                                                …{snippetParts(item.snippet).map((part, i) => part.match
                                                    ? <mark key={i} className="rounded bg-amber-100 px-0.5 text-gray-900">{part.text}</mark>
                                                    : <span key={i}>{part.text}</span>)}…
                                            </p>
                                        )}
                                        {manager && (
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {item.retired_at && <Badge tone="gray">Withdrawn</Badge>}
                                                {item.published_version_no == null && <Badge tone="amber">Not yet published</Badge>}
                                                {item.draft_version_no != null && <Badge tone="blue">{`Draft of version ${item.draft_version_no}`}</Badge>}
                                                {item.review_overdue && !item.retired_at && <Badge tone="rose">{`Review was due ${formatDate(item.review_due)}`}</Badge>}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            {creating && (
                <PolicyDetailsModal
                    meta={meta}
                    onClose={() => setCreating(false)}
                    onSaved={async (created: PolicyDocument) => {
                        setCreating(false);
                        await onMetaChanged();
                        navigate(`/policies/${created.id}/edit`);
                    }}
                />
            )}
        </div>
    );
}

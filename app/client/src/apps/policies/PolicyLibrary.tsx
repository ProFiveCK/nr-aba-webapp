import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FolderTree, Plus, Search } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { formatDate } from '../../lib/date';
import { compareCells, type SortState } from '../../lib/tableSort';
import { usePagination } from '../../lib/usePagination';
import { SortHeader } from '../../components/SortHeader';
import { Button, Card, EmptyState, LoadingState, Pager } from '../../components/Ui';
import { PolicyDetailsModal } from './PolicyDetailsModal';
import { categoryPath, categoryTree, snippetParts, typeLabel } from './policyContent';
import type { PolicyDocument, PolicyListItem, PolicyMeta } from './types';

/** Views of the library for people who write or publish, besides the categories. */
const WORK_VIEWS = [
    { key: 'draft', label: 'Drafts in progress' },
    { key: 'unpublished', label: 'Not yet published' },
    { key: 'overdue', label: 'Review overdue' },
    { key: 'withdrawn', label: 'Withdrawn' },
] as const;

type SortKey = 'relevance' | 'code' | 'title' | 'doc_type' | 'published_version_no' | 'published_at';

function Badge({ tone, children }: { tone: 'amber' | 'gray' | 'rose' | 'blue'; children: string }) {
    const tones = {
        amber: 'bg-amber-50 text-amber-800 ring-amber-200',
        gray: 'bg-gray-100 text-gray-700 ring-gray-200',
        rose: 'bg-rose-50 text-rose-700 ring-rose-200',
        blue: 'bg-blue-50 text-brand ring-blue-200',
    };
    return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}

function NavItem({ active, onClick, count, indent = false, children }: { active: boolean; onClick: () => void; count?: number; indent?: boolean; children: ReactNode }) {
    return (
        <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}
            className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${indent ? 'pl-6 text-[13px]' : 'font-medium'} ${active ? 'bg-blue-50 text-brand' : 'text-gray-700 hover:bg-gray-50'}`}>
            <span className="min-w-0 truncate">{children}</span>
            {count !== undefined && <span className={`shrink-0 text-xs tabular-nums ${active ? 'text-brand' : 'text-gray-400'}`}>{count}</span>}
        </button>
    );
}

/**
 * The library, browsed like a document management system: manuals and
 * their sections down the side, the documents in the one chosen as a table.
 * A manual's documents are grouped by section, like its table of contents.
 */
export function PolicyLibrary({ meta, onMetaChanged }: { meta: PolicyMeta; onMetaChanged: () => Promise<void> }) {
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const q = params.get('q') ?? '';
    const category = params.get('category') ?? '';
    const state = params.get('state') ?? '';
    const type = params.get('type') ?? '';
    const department = params.get('department') ?? '';
    const manager = meta.can_edit || meta.can_publish;
    const tree = useMemo(() => categoryTree(meta.categories), [meta.categories]);

    const [typed, setTyped] = useState(q);
    const [items, setItems] = useState<PolicyListItem[] | null>(null);
    const [error, setError] = useState('');
    const [creating, setCreating] = useState(false);
    const [sort, setSort] = useState<SortState<SortKey>>({ key: 'relevance', direction: 'asc' });
    const onSort = (key: SortKey, defaultDirection: 'asc' | 'desc' = 'asc') => setSort((current) => (
        current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: defaultDirection }));

    const update = (changes: Record<string, string>) => setParams((current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value); else next.delete(key);
        }
        return next;
    }, { replace: true });
    // A place in the library is a category or a work view, never both.
    const go = (place: { category?: string; state?: string }) => {
        update({ category: place.category ?? '', state: place.state ?? '' });
        setSort({ key: 'relevance', direction: 'asc' });
    };

    useEffect(() => {
        if (typed.trim() === q) return;
        const timer = setTimeout(() => update({ q: typed.trim() }), 300);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [typed]);

    useEffect(() => {
        const controller = new AbortController();
        const query = new URLSearchParams();
        for (const [key, value] of [['q', q], ['category', category], ['state', state], ['type', type], ['department_id', department]]) {
            if (value) query.set(key, value);
        }
        apiClient.get<PolicyListItem[]>(`/policies?${query}`, { signal: controller.signal })
            .then((rows) => { setItems(rows); setError(''); })
            .catch((err) => { if (!controller.signal.aborted) setError((err as Error).message || 'The library could not be loaded.'); });
        return () => controller.abort();
    }, [q, category, state, type, department]);

    const sorted = useMemo(() => {
        const rows = items ?? [];
        const key = sort.key;
        // Relevance is the order the server sent: best match first, or by code.
        if (key === 'relevance') return rows;
        const value = (row: PolicyListItem) => key === 'doc_type' ? typeLabel(meta, row.doc_type) : row[key];
        return [...rows].sort((a, b) => compareCells(value(a), value(b), sort.direction));
    }, [items, sort, meta]);
    const paging = usePagination(sorted, `${q}|${category}|${state}|${type}|${department}|${sort.key}|${sort.direction}`);

    // Where we are, for the heading and the empty message.
    const manual = tree.find((m) => m.id === category);
    const section = !manual ? tree.flatMap((m) => m.sections.map((s) => ({ ...s, manual: m }))).find((s) => s.id === category) : undefined;
    const workView = WORK_VIEWS.find((v) => v.key === state);
    const placeName = workView?.label ?? manual?.name ?? (section ? section.name : category === 'none' ? 'Not in a category' : 'All documents');
    const searchingIn = category || state ? `Search in ${placeName}` : 'Search all documents';

    // A manual reads like its table of contents: its documents grouped by
    // section, those tagged with the manual itself first. Searching flattens it.
    const groups = useMemo(() => {
        if (!manual || q || !items) return null;
        const inGroup = (id: string) => sorted.filter((row) => row.categories.some((t) => t.id === id));
        return [
            { id: manual.id, name: 'General', rows: inGroup(manual.id) },
            ...manual.sections.map((s) => ({ id: s.id, name: s.name, rows: inGroup(s.id) })),
        ].filter((group) => group.rows.length);
    }, [manual, q, items, sorted]);

    const filtersSet = !!(q || type || department);

    // Under a heading, a row names only the other places its document sits.
    const row = (item: PolicyListItem, keyPrefix = '', here: string | null = section?.id ?? null) => {
        const elsewhere = item.categories.filter((tag) => tag.id !== here);
        return (
        <tr key={keyPrefix + item.id}>
            <td className="w-32 font-medium text-gray-900">{item.code}</td>
            <td className="!whitespace-normal">
                <Link to={`/policies/${item.id}`} state={{ from: `/policies?${params}` }} className="font-medium text-brand hover:underline">{item.title}</Link>
                {!!elsewhere.length && (
                    <p className="text-xs text-gray-500">{here ? 'Also in ' : ''}{elsewhere.map(categoryPath).join(' · ')}</p>
                )}
                {item.snippet && (
                    <p className="mt-0.5 text-xs text-gray-600">
                        …{snippetParts(item.snippet).map((part, i) => part.match
                            ? <mark key={i} className="rounded bg-amber-100 px-0.5 text-gray-900">{part.text}</mark>
                            : <span key={i}>{part.text}</span>)}…
                    </p>
                )}
                {manager && (item.retired_at || item.published_version_no == null || item.draft_version_no != null || (item.review_overdue && !item.retired_at)) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                        {item.retired_at && <Badge tone="gray">Withdrawn</Badge>}
                        {item.published_version_no == null && <Badge tone="amber">Not yet published</Badge>}
                        {item.draft_version_no != null && <Badge tone="blue">{`Draft of version ${item.draft_version_no}`}</Badge>}
                        {item.review_overdue && !item.retired_at && <Badge tone="rose">{`Review was due ${formatDate(item.review_due)}`}</Badge>}
                    </div>
                )}
            </td>
            <td className="hidden md:table-cell">{typeLabel(meta, item.doc_type)}</td>
            <td className="hidden text-right tabular-nums sm:table-cell">{item.published_version_no ?? '—'}</td>
            <td className="hidden sm:table-cell">{item.published_at ? formatDate(item.published_at) : '—'}</td>
        </tr>
        );
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900">Policies &amp; Procedures</h2>
                    <p className="text-gray-600">The policies, procedures, guidelines and forms in force.</p>
                </div>
                {meta.can_edit && <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />New document</Button>}
            </div>

            {/* Phones choose a place from a list; wider screens get the side panel. */}
            <label className="block lg:hidden">
                <span className="sr-only">Browse the library</span>
                <select value={state ? `state:${state}` : category ? `category:${category}` : ''} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
                    onChange={(e) => { const [kind, value] = e.target.value.split(':'); go(kind === 'state' ? { state: value } : kind === 'category' ? { category: value } : {}); }}>
                    <option value="">All documents ({meta.document_count})</option>
                    {tree.map((m) => [
                        <option key={m.id} value={`category:${m.id}`}>{m.name} ({m.document_count})</option>,
                        ...m.sections.map((s) => <option key={s.id} value={`category:${s.id}`}>{'   '}{s.name} ({s.document_count})</option>),
                    ])}
                    {meta.uncategorised_count > 0 && <option value="category:none">Not in a category ({meta.uncategorised_count})</option>}
                    {manager && WORK_VIEWS.map((v) => <option key={v.key} value={`state:${v.key}`}>{v.label}</option>)}
                </select>
            </label>

            <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
                <nav aria-label="Library" className="hidden space-y-4 lg:block">
                    <Card className="p-2">
                        <NavItem active={!category && !state} onClick={() => go({})} count={meta.document_count}>All documents</NavItem>
                        {!!tree.length && <div className="my-1.5 border-t border-gray-100" />}
                        {tree.map((m) => (
                            <div key={m.id}>
                                <NavItem active={category === m.id} onClick={() => go({ category: m.id })} count={m.document_count}>{m.name}</NavItem>
                                {m.sections.map((s) => (
                                    <NavItem key={s.id} indent active={category === s.id} onClick={() => go({ category: s.id })} count={s.document_count}>{s.name}</NavItem>
                                ))}
                            </div>
                        ))}
                        {meta.uncategorised_count > 0 && (
                            <>
                                <div className="my-1.5 border-t border-gray-100" />
                                <NavItem active={category === 'none'} onClick={() => go({ category: 'none' })} count={meta.uncategorised_count}>Not in a category</NavItem>
                            </>
                        )}
                        {meta.can_publish && (
                            <Link to="/policies/categories" className="mt-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-gray-500 hover:bg-gray-50 hover:text-brand">
                                <FolderTree size={14} aria-hidden="true" />Manage categories
                            </Link>
                        )}
                    </Card>
                    {manager && (
                        <Card className="p-2">
                            <p className="px-2.5 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Work</p>
                            {WORK_VIEWS.map((v) => <NavItem key={v.key} active={state === v.key} onClick={() => go({ state: v.key })}>{v.label}</NavItem>)}
                        </Card>
                    )}
                </nav>

                <section aria-label={placeName} className="min-w-0 space-y-3">
                    <div>
                        {section && (
                            <button type="button" onClick={() => go({ category: section.manual.id })} className="text-xs font-medium uppercase tracking-wide text-gray-500 hover:text-brand">
                                {section.manual.name} ›
                            </button>
                        )}
                        <h3 className="text-lg font-semibold text-gray-900">{placeName}</h3>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                        <label className="relative block">
                            <span className="sr-only">{searchingIn}</span>
                            <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={searchingIn}
                                className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" />
                        </label>
                        <select aria-label="Kind of document" value={type} onChange={(e) => update({ type: e.target.value })}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-2">
                            <option value="">All kinds</option>
                            {meta.types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                        </select>
                        <select aria-label="Owning department" value={department} onChange={(e) => update({ department: e.target.value })}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-2">
                            <option value="">All departments</option>
                            {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                    </div>

                    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p>}
                    {!items && !error && <LoadingState label="Loading the library…" />}
                    {items && !items.length && (
                        <Card>
                            <EmptyState
                                title={filtersSet ? 'Nothing here matches that.' : workView ? 'Nothing here.' : meta.document_count ? 'Nothing in here yet.' : 'Nothing has been published yet.'}
                                detail={filtersSet ? 'Try other words, clear the filters, or search all documents.' : meta.can_edit && !workView ? 'Add a document with New document and tag it with this category.' : undefined}
                            />
                        </Card>
                    )}
                    {!!items?.length && (
                        <div className="data-table-wrap">
                            <div className="data-table-scroll">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <SortHeader label="Code" sortKey="code" sort={sort} onSort={onSort} defaultDirection="asc" />
                                            <SortHeader label="Title" sortKey="title" sort={sort} onSort={onSort} defaultDirection="asc" />
                                            <SortHeader label="Kind" sortKey="doc_type" sort={sort} onSort={onSort} defaultDirection="asc" className="hidden md:table-cell" />
                                            <SortHeader label="Version" sortKey="published_version_no" sort={sort} onSort={onSort} align="right" className="hidden sm:table-cell" />
                                            <SortHeader label="In force since" sortKey="published_at" sort={sort} onSort={onSort} className="hidden sm:table-cell" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {groups
                                            ? groups.map((group) => [
                                                <tr key={`group-${group.id}`} className="!bg-gray-50 hover:!bg-gray-50">
                                                    <th colSpan={5} scope="colgroup" className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                                                        {group.id === manual?.id ? group.name
                                                            : <button type="button" onClick={() => go({ category: group.id })} className="uppercase hover:text-brand">{group.name}</button>}
                                                        <span className="ml-2 font-normal normal-case text-gray-400">{group.rows.length}</span>
                                                    </th>
                                                </tr>,
                                                ...group.rows.map((item) => row(item, `${group.id}-`, group.id)),
                                            ])
                                            : paging.pageRows.map((item) => row(item))}
                                    </tbody>
                                </table>
                            </div>
                            {!groups && <Pager page={paging.page} pageCount={paging.pageCount} total={paging.total} pageSize={paging.pageSize} setPage={paging.setPage} />}
                        </div>
                    )}
                </section>
            </div>

            {creating && (
                <PolicyDetailsModal
                    meta={meta}
                    presetCategory={manual?.id ?? section?.id}
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

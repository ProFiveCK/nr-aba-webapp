import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/Ui';
import { apiClient } from '../../lib/api';
import { sectionsFromHtml } from './policyContent';
import type { PolicyDocument, PolicyListItem, PolicyMeta } from './types';

type Result = PolicyListItem & { snippet?: string };

/**
 * A link inserted from the library: search the documents as you type, choose one,
 * optionally point at one of its sections. The address tab keeps the way in for
 * web addresses, email addresses and anything outside the library.
 */
export function LinkPicker({ onInsert, onClose }: {
    onInsert: (href: string, text: string) => void;
    onClose: () => void;
}) {
    const [meta, setMeta] = useState<PolicyMeta | null>(null);
    const [tab, setTab] = useState<'library' | 'address'>('library');
    const [term, setTerm] = useState('');
    const [results, setResults] = useState<Result[] | null>(null);
    const [active, setActive] = useState(0);
    const [target, setTarget] = useState<PolicyDocument | null>(null);
    const [sections, setSections] = useState<{ id: string; text: string }[]>([]);
    const [address, setAddress] = useState('');
    const input = useRef<HTMLInputElement>(null);

    useEffect(() => { input.current?.focus(); }, [tab]);

    useEffect(() => {
        apiClient.get<PolicyMeta>('/policies/meta').then(setMeta).catch(() => setMeta(null));
    }, []);

    useEffect(() => {
        if (tab !== 'library') return;
        const query = term.trim();
        if (query.length < 2) return; // the view shows the hint while the search is too short
        const timer = setTimeout(() => {
            apiClient.get<Result[]>(`/policies?q=${encodeURIComponent(query)}`)
                .then((rows) => { setResults(rows || []); })
                .then(() => setActive(0))
                .catch(() => setResults([]));
        }, 250);
        return () => clearTimeout(timer);
    }, [term, tab]);

    /* Choosing a document opens its section list; picking one links straight to it. */
    const choose = async (picked: Result) => {
        const details = await apiClient.get<PolicyDocument>(`/policies/${picked.id}`).catch(() => null);
        const text = details?.published?.body_html ?? details?.draft?.body_html ?? '';
        const sections = sectionsFromHtml(text);
        if (!sections.length) { onInsert(`/policies/${picked.id}`, picked.title); onClose(); return; }
        setTarget((picked as unknown as PolicyDocument) || null);
        setSections(sections);
    };

    const insertDocument = (picked: PolicyDocument, section?: { id: string; text: string } | null) => {
        onInsert(section ? `/policies/${picked.id}#${section.id}` : `/policies/${picked.id}`,
            section ? section.text : picked.title);
        onClose();
    };

    const insertAddress = () => {
        const text = address.trim();
        if (!text) return;
        onInsert(/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(text) ? `mailto:${text}`
            : /^(https?:|mailto:|\/|#)/i.test(text) ? text : `https://${text}`, text);
        onClose();
    };

    const onKey = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') { onClose(); return; }
        if (tab === 'address' && event.key === 'Enter') { insertAddress(); return; }
        if (tab !== 'library' || !results?.length) return;
        if (event.key === 'ArrowDown') { event.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
        if (event.key === 'ArrowUp') { event.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
        if (event.key === 'Enter') { event.preventDefault(); if (results[active]) void choose(results[active]); }
    };

    const sectionLabel = (text: string) => text;

    return (
        <Modal title="Add a link" onClose={onClose} size="lg">
            <div className="space-y-3">
                <div className="flex gap-1 rounded-lg bg-gray-100 p-1 text-sm" role="tablist" aria-label="Where the link goes">
                    <button type="button" role="tab" aria-selected={tab === 'library'} onClick={() => setTab('library')}
                        className={`flex-1 rounded-md px-3 py-1.5 ${tab === 'library' ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-600'}`}>In the library</button>
                    <button type="button" role="tab" aria-selected={tab === 'address'} onClick={() => setTab('address')}
                        className={`flex-1 rounded-md px-3 py-1.5 ${tab === 'address' ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-600'}`}>A web or portal address</button>
                </div>
                {tab === 'library' ? (
                    <div className="space-y-2">
                        {!target ? (
                            <>
                                <input ref={input} autoFocus type="text" value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={onKey}
                                    placeholder="Search the library by words or code" aria-label="Search the library"
                                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" />
                                {term.trim().length < 2 ? <p className="text-xs text-gray-500">Type at least two letters. The search covers codes, titles, sections and the text of every policy in force.</p>
                                    : results === null ? <p role="status" className="text-xs text-gray-500">Searching…</p>
                                        : !results.length ? <p className="text-sm text-gray-500">Nothing in the library matches.</p>
                                            : <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200" role="listbox" aria-label="Documents">
                                                {results.map((row, index) => (
                                                    <li key={row.id}>
                                                        <button type="button" role="option" aria-selected={index === active}
                                                            onMouseEnter={() => setActive(index)} onDoubleClick={() => void choose(row)}
                                                            onClick={() => void choose(row)}
                                                            className={`w-full px-3 py-2 text-left text-sm ${index === active ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                                                            <span className="font-medium text-gray-900">{row.title}</span>
                                                            <span className="ml-2 text-xs text-gray-500">{row.code}{meta?.types.find((t) => t.key === row.doc_type)?.label && ` · ${meta.types.find((t) => t.key === row.doc_type)!.label}`}</span>
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>}
                                {term.trim().length >= 2 && !!results?.length && <p className="text-xs text-gray-500">Arrow keys to choose, Enter to open the section list.</p>}
                            </>
                        ) : (
                            <>
                                <p className="text-sm text-gray-700">Link to: <strong>{target.title}</strong> <span className="text-gray-500">({target.code})</span></p>
                                <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200" role="listbox" aria-label="Sections">
                                    <li><button type="button" role="option" className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50"
                                        onClick={() => insertDocument(target, null)}>Top of the document</button></li>
                                    {sections.map((section) => (
                                        <li key={section.id}>
                                            <button type="button" role="option" className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50"
                                                onClick={() => insertDocument(target, section)}>
                                                {sectionLabel(section.text)}
                                                {section.id && <span className="ml-2 text-xs text-gray-400">#{section.id}</span>}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                                <button type="button" className="text-xs font-medium text-gray-500 hover:text-brand" onClick={() => setTarget(null)}>← Choose another document</button>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="space-y-2">
                        <input ref={input} autoFocus type="text" value={address} onChange={(e) => setAddress(e.target.value)} onKeyDown={onKey}
                            placeholder="https://…, a name@… email, or a /portal/address" aria-label="Web address" className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" />
                        <p className="text-xs text-gray-500">Enter inserts the link.</p>
                    </div>
                )}
            </div>
        </Modal>
    );
}

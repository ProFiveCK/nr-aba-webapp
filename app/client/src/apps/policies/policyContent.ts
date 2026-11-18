import type { PolicyMeta } from './types';

/**
 * Section addresses for a page's headings, so a link can point straight at a
 * section (/policies/…#approvals). Built from the heading text, so the address
 * stays the same from one version to the next while the heading does; a
 * repeated heading gets -2, -3 and so on.
 */
export function headingAnchors(texts: string[]): string[] {
    const seen = new Map<string, number>();
    return texts.map((text) => {
        const base = text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
        const count = (seen.get(base) ?? 0) + 1;
        seen.set(base, count);
        return count === 1 ? base : `${base}-${count}`;
    });
}

/** A search passage split into plain and matched pieces, to show without any HTML. */
export function snippetParts(snippet: string): { text: string; match: boolean }[] {
    return snippet.split(/(⟦[^⟧]*⟧)/).filter(Boolean).map((part) => (
        part.startsWith('⟦') ? { text: part.slice(1, -1), match: true } : { text: part, match: false }
    ));
}

export function typeLabel(meta: PolicyMeta | null, key: string): string {
    return meta?.types.find((type) => type.key === key)?.label ?? key;
}

export function fileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The same day a year on, as `YYYY-MM-DD`: the usual next review after publishing. */
export function aYearAfter(iso: string): string {
    const [year, month, day] = iso.split('-').map(Number);
    // 29 February has no anniversary in a common year; take the 28th.
    const last = new Date(year + 1, month, 0).getDate();
    return `${year + 1}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/**
 * Where an in-portal link in a policy goes, for the router to follow without
 * reloading the page. Null for anything the browser should handle itself:
 * other sites, email, files to download, and links to another section of
 * the same page.
 */
export function portalLinkTarget(href: string | null): string | null {
    if (!href || !href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) return null;
    return href;
}

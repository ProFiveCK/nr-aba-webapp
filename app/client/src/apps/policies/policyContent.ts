import type { PolicyCategory, PolicyMeta } from './types';

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

export interface CategoryBranch extends PolicyCategory {
    sections: PolicyCategory[];
}

/** The flat category list as manuals, each with its sections, in their set order. */
export function categoryTree(categories: PolicyCategory[]): CategoryBranch[] {
    const order = (a: PolicyCategory, b: PolicyCategory) => a.sort_order - b.sort_order || a.name.localeCompare(b.name);
    return categories.filter((c) => !c.parent_id).sort(order).map((manual) => ({
        ...manual,
        sections: categories.filter((c) => c.parent_id === manual.id).sort(order),
    }));
}

/** "Finance Manual › Payments", or just "Finance Manual" for a manual. */
export function categoryPath(tag: { name: string; parent_name?: string | null }): string {
    return tag.parent_name ? `${tag.parent_name} › ${tag.name}` : tag.name;
}

/** A category from the list, named with its manual. */
export function categoryLabel(categories: PolicyCategory[], id: string): string {
    const category = categories.find((c) => c.id === id);
    if (!category) return '';
    const manual = category.parent_id ? categories.find((c) => c.id === category.parent_id) : null;
    return categoryPath({ name: category.name, parent_name: manual?.name });
}

const HTML_ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/**
 * The h2/h3 headings of a policy body, in reading order, each with the stable
 * section address the reader gives it — the same list the contents panel
 * builds, for anywhere else that needs a document's sections (link picker).
 */
export function sectionsFromHtml(html: string): { id: string; text: string }[] {
    const texts = [...String(html ?? '').matchAll(/<(?:h2|h3)(?:\s[^>]*)?>([\s\S]*?)<\/h[23]>/gi)]
        .map(([, raw]) => raw)
        .map((raw) => raw.replace(/<[^>]*>/g, ''))
        .map((text) => text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => HTML_ENTITIES[entity] ?? entity).trim())
        .filter(Boolean);
    const ids = headingAnchors(texts);
    return texts.map((text, i) => ({ id: ids[i], text }));
}

/**
 * Section addresses across a whole document: every heading that already
 * carries its address keeps it, the rest are numbered around them — so an
 * older body the server has not migrated yet still settles the same way.
 */
export function settleHeadingIds(existing: (string | null)[], texts: string[]): string[] {
    const seen = new Map<string, number>();
    for (const id of existing) {
        if (id) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    const out: string[] = [];
    existing.forEach((id, i) => {
        if (id) { out.push(id); return; }
        const base = (texts[i]?.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)) || 'section';
        let count = seen.get(base) ?? 0;
        let slug = count === 0 ? base : `${base}-${count + 1}`;
        while (seen.has(slug)) { count += 1; slug = `${base}-${count + 1}`; }
        seen.set(slug, (seen.get(slug) ?? 0) + 1);
        out.push(slug);
    });
    return out;
}

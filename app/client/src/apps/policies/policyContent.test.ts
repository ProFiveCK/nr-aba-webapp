import { expect, it } from 'vitest';
import { aYearAfter, categoryLabel, categoryTree, fileSize, headingAnchors, portalLinkTarget, sectionsFromHtml, snippetParts } from './policyContent';

it('gives each heading a readable section address, numbering repeats', () => {
    expect(headingAnchors(['Purpose', 'Who approves?', 'Purpose', 'Café rules', '***']))
        .toEqual(['purpose', 'who-approves', 'purpose-2', 'cafe-rules', 'section']);
});

it('splits a search passage into plain and matched pieces', () => {
    expect(snippetParts('needs two ⟦signatures⟧ before the ⟦cheque⟧')).toEqual([
        { text: 'needs two ', match: false },
        { text: 'signatures', match: true },
        { text: ' before the ', match: false },
        { text: 'cheque', match: true },
    ]);
    expect(snippetParts('<script>')).toEqual([{ text: '<script>', match: false }]);
});

it('sets the next review a year on, and 29 February to the 28th', () => {
    expect(aYearAfter('2026-11-18')).toBe('2027-11-18');
    expect(aYearAfter('2028-02-29')).toBe('2029-02-28');
});

it('follows portal links in the app, and leaves files, sections and other sites to the browser', () => {
    expect(portalLinkTarget('/policies/abc#approvals')).toBe('/policies/abc#approvals');
    expect(portalLinkTarget('/api/policies/files/abc')).toBeNull();
    expect(portalLinkTarget('#approvals')).toBeNull();
    expect(portalLinkTarget('https://gov.nr')).toBeNull();
    expect(portalLinkTarget('//evil.example')).toBeNull();
    expect(portalLinkTarget(null)).toBeNull();
});

it('shows file sizes the way people read them', () => {
    expect(fileSize(900)).toBe('900 B');
    expect(fileSize(20_480)).toBe('20 KB');
    expect(fileSize(3_250_000)).toBe('3.1 MB');
});

it('arranges categories as manuals holding their sections, in their set order', () => {
    const c = (id: string, name: string, parent_id: string | null, sort_order: number) => ({ id, name, parent_id, sort_order, document_count: 0 });
    const tree = categoryTree([c('p', 'Payments', 'f', 2), c('h', 'HR Manual', null, 2), c('f', 'Finance Manual', null, 1), c('r', 'Procurement', 'f', 1), c('l', 'Leave', 'h', 1)]);
    expect(tree.map((m) => [m.name, m.sections.map((s) => s.name)])).toEqual([
        ['Finance Manual', ['Procurement', 'Payments']],
        ['HR Manual', ['Leave']],
    ]);
    const all = tree.flatMap((m) => [m, ...m.sections]);
    expect(categoryLabel(all, 'p')).toBe('Finance Manual › Payments');
    expect(categoryLabel(all, 'h')).toBe('HR Manual');
    expect(categoryLabel(all, 'missing')).toBe('');
});

it('reads a body heading list into the same section addresses the reader gives', () => {
    expect(sectionsFromHtml('<h2>Purpose</h2><p>Who and why.</p><h3>Scope and <strong>limits</strong></h3><p>Six-month rule: &amp; more.</p><h2>Purpose</h2>'))
        .toEqual([
            { id: 'purpose', text: 'Purpose' },
            { id: 'scope-and-limits', text: 'Scope and limits' },
            { id: 'purpose-2', text: 'Purpose' },
        ]);
});

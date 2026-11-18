import { expect, it } from 'vitest';
import { aYearAfter, fileSize, headingAnchors, portalLinkTarget, snippetParts } from './policyContent';

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

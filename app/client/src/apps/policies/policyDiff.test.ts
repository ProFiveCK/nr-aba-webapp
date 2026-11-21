import { expect, it } from 'vitest';
import { diffParagraphs } from './policyDiff';

it('walks both texts, keeping matching lines and marking the moves', () => {
    const rows = diffParagraphs('Kept.\nOld rule.\nKept.\nAlso old.\nKept.', 'Kept.\nNew rule.\nKept.\nKept.');
    expect(rows).toEqual([
        { kind: 'same', text: 'Kept.', collapsed: false },
        { kind: 'removed', text: 'Old rule.' },
        { kind: 'added', text: 'New rule.' },
        { kind: 'same', text: 'Kept.', collapsed: false },
        { kind: 'removed', text: 'Also old.' },
        { kind: 'same', text: 'Kept.', collapsed: false },
    ]);
});

it('collapses a long run of unchanged lines into one muted row', () => {
    const kept = Array.from({ length: 8 }, () => 'Same.');
    const rows = diffParagraphs([...kept, 'Changed.'].join('\n'), [...kept, 'New ending.'].join('\n'));
    expect(rows).toEqual([
        { kind: 'same', text: 'Same.', collapsed: false },
        { kind: 'same', text: 'Same.', collapsed: false },
        { kind: 'same', text: '… 6 unchanged lines …', collapsed: true },
        { kind: 'removed', text: 'Changed.' },
        { kind: 'added', text: 'New ending.' },
    ]);
});

it('marks whole additions and removals', () => {
    expect(diffParagraphs('Only here.', '')).toEqual([{ kind: 'removed', text: 'Only here.' }]);
    expect(diffParagraphs('', 'Only there.')).toEqual([{ kind: 'added', text: 'Only there.' }]);
    expect(diffParagraphs('', '')).toEqual([]);
});

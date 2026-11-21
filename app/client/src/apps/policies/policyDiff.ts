/**
 * Paragraph-level diff between two versions of a policy, from the plain texts
 * the versions carry. A longest-common-subsequence walk over the lines a text
 * splits into — policy prose is a few hundred lines, so the straightforward
 * table is plenty — with runs of untouched lines collapsed, because nobody
 * reads a scroll of sameness to find three changed lines.
 */
export type DiffRow =
    | { kind: 'removed' | 'added'; text: string }
    | { kind: 'same'; text: string; collapsed: boolean };

/** One aligned pass over both texts, runs of sameness collapsed. */
export function diffParagraphs(oldText: string, newText: string, collapseAfter = 2): DiffRow[] {
    const a = String(oldText ?? '').split('\n').filter((line) => line !== '');
    const b = String(newText ?? '').split('\n').filter((line) => line !== '');
    const n = a.length, m = b.length;
    const width = m + 1;
    // dp[i][j]: how many words still match from a[i..] and b[j..].
    const dp = new Uint16Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i * width + j] = a[i] === b[j]
                ? dp[(i + 1) * width + (j + 1)] + 1
                : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
        }
    }
    const out: DiffRow[] = [];
    const sameRun: string[] = [];
    const flushSame = () => {
        if (!sameRun.length) return;
        for (const text of sameRun.slice(0, collapseAfter)) out.push({ kind: 'same', text, collapsed: false });
        const hidden = sameRun.length - Math.min(sameRun.length, collapseAfter);
        if (hidden > 0) {
            out.push({ kind: 'same', text: `… ${hidden} unchanged line${hidden === 1 ? '' : 's'} …`, collapsed: true });
        }
        sameRun.length = 0;
    };
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) { sameRun.push(a[i]); i++; j++; }
        else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) { flushSame(); out.push({ kind: 'removed', text: a[i] }); i++; }
        else { flushSame(); out.push({ kind: 'added', text: b[j] }); j++; }
    }
    flushSame();
    while (i < n) { out.push({ kind: 'removed', text: a[i] }); i++; }
    while (j < m) { out.push({ kind: 'added', text: b[j] }); j++; }
    return out;
}

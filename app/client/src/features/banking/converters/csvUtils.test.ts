import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readStatementText } from './csvUtils';

describe('readStatementText', () => {
  it('reads the actual rows from the DEV Numbers banking statement', async () => {
    const fixturePath = new URL('../../../../../../DEV/New York July 2026 - CSV -Account Statement_08052026.numbers', import.meta.url);
    const file = new File([readFileSync(fixturePath)], 'New York July 2026 - CSV -Account Statement_08052026.numbers', {
      type: 'application/x-apple-numbers',
    });

    const text = await readStatementText(file);

    expect(text).toContain('Statement Information');
    expect(text).toContain('Deposits and other credits');
    expect(text).toContain('2260 0709 0431');
  });
});

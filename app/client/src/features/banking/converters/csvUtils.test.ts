import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsvText, readStatementText } from './csvUtils';

// A real statement carrying account numbers, so it is deliberately not in the
// repository. Without it this test can only fail, which leaves `npm test` red
// for everyone who has not got a copy — so it skips instead.
const fixturePath = new URL(
  '../../../../../../DEV/New York July 2026 - CSV -Account Statement_08052026.numbers',
  import.meta.url
);
const havePrivateFixture = existsSync(fixturePath);

describe('readStatementText', () => {
  it('reads CSV files unchanged', async () => {
    const text = 'Date,Amount\r\n2026-10-01,100.00';
    expect(await readStatementText(new File([text], 'statement.csv'))).toBe(text);
  });
  it.runIf(havePrivateFixture)('reads the actual rows from the DEV Numbers banking statement', async () => {
    const file = new File([readFileSync(fixturePath)], 'New York July 2026 - CSV -Account Statement_08052026.numbers', {
      type: 'application/x-apple-numbers',
    });

    const text = await readStatementText(file);

    expect(text).toContain('Statement Information');
    expect(text).toContain('Deposits and other credits');
    expect(text).toContain('2260 0709 0431');
  });
});

describe('parseCsvText', () => {
  it('preserves multiline cells, escaped quotes, empty columns and trailing spaces', () => {
    expect(parseCsvText('\uFEFFDate,Description,Amount,\r\n2026-10-01,"Invoice, ""October""\r\nOffice rent",125.50,\r\n\r\n'))
      .toEqual([
        ['Date', 'Description', 'Amount', ''],
        ['2026-10-01', 'Invoice, "October"\r\nOffice rent', '125.50', ''],
      ]);
    expect(parseCsvText('a,b  ')).toEqual([['a', 'b  ']]);
  });

  it('reads semicolon records with quoted delimiters', () => {
    expect(parseCsvText('2026-10-01;"Invoice; October";125.50;', ';'))
      .toEqual([['2026-10-01', 'Invoice; October', '125.50', '']]);
  });
});

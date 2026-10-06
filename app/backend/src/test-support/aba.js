/**
 * Builds ABA files for tests, laid out the way the client's buildAbaFile
 * (app/client/src/lib/generator-utils.ts) writes them.
 */
const R = (s) => s.padEnd(120, ' ').slice(0, 120);

export const header = (desc, proc) =>
  R('0' + ' '.repeat(17) + '01' + 'CBA' + ' '.repeat(7) + 'REPUBLIC OF NAURU'.padEnd(26) + '123456' + desc.padEnd(12) + proc);

export const detail = (bsb, acct, code, cents, title, lodg, remitter = 'RON TREASURY') =>
  R('1' + bsb + acct.padStart(9, ' ') + ' ' + code + String(cents).padStart(10, '0')
    + title.padEnd(32) + lodg.padEnd(18) + '012-345' + '123456789' + remitter.padEnd(16) + '00000000');

export const trailer = (net, credits, debits, count) =>
  R('7999-999' + ' '.repeat(12) + [net, credits, debits].map((n) => String(n).padStart(10, '0')).join('')
    + ' '.repeat(24) + String(count).padStart(6, '0'));

export const file = (lines, eol = '\r\n') => Buffer.from(lines.join(eol) + eol, 'utf8');

/**
 * A balanced file paying `credits` ([bsb, account, cents] each), with the
 * balancing debit and a correct trailer unless `trailerCredits` overrides it.
 */
export function abaFile(credits, { proc = '061026', desc = 'SALARIES', trailerCredits } = {}) {
  const total = credits.reduce((sum, [, , cents]) => sum + cents, 0);
  return file([
    header(desc, proc),
    ...credits.map(([bsb, acct, cents]) => detail(bsb, acct, '53', cents, 'PAYEE', 'PAY')),
    detail('012-345', '11112222', '13', total, 'TREASURY OPERATING', `${desc}-${proc}`),
    trailer(0, trailerCredits ?? total, total, credits.length + 1),
  ]);
}

/** The payload the Generator sends alongside the file, for the same credits. */
export const payloadFor = (credits) => ({
  payload: {
    header: { proc: '061026', desc: 'SALARIES', remitter: 'RON TREASURY' },
    transactions: credits.map(([bsb, account, cents]) => ({ bsb, account, amount: cents / 100 })),
  },
});

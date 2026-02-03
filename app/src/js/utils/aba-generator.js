/**
 * ABA File Generator
 * Builds ABA file format from header and transaction rows
 */

import { digitsOnly, todayDDMMYY } from './formatters.js';
import { normalizeBSBStrict } from './formatters.js';

/**
 * Utility functions for padding/formatting
 */
const U = {
  digitsOnly: (s) => String(s || '').replace(/[^0-9]/g, ''),
  trunc: (s, n) => String(s || '').slice(0, n),
  padL: (s, w, ch = '0') => String(s || '').padStart(w, ch).slice(-w),
  padR: (s, w, ch = ' ') => String(s || '').padEnd(w, ch).slice(0, w),
  money: (cents) => (new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })).format((cents || 0) / 100),
};

/**
 * Build an ABA string from header and rows
 * @param {Object} h - Header object
 * @param {Array} rows - Transaction rows
 * @returns {string} ABA file content
 */
export function buildAbaFromHeader(h, rows) {
  if (!h || !rows) throw new Error('Header and rows are required.');
  if (!h.user || !h.remitter) throw new Error('User Name and Remitter Name are required.');
  
  const apca = U.digitsOnly(h.apca || '');
  if (apca.length !== 6) throw new Error('APCA/User ID must be exactly 6 digits.');

  const proc = /^\d{6}$/.test(h.proc) ? h.proc : todayDDMMYY();

  // Type 0 - Header Record
  const t0 = '0'
    + U.padR('', 17)
    + U.padL(String(h.reel || '1'), 2)
    + U.padR((h.fi || '').slice(0, 3), 3)
    + U.padR('', 7)
    + U.padR((h.user || '').slice(0, 26), 26)
    + U.padL(apca, 6)
    + U.padR((h.desc || '').slice(0, 12), 12)
    + U.padR(proc, 6)
    + U.padR('', 40);
  const lines = [(t0 + ' '.repeat(120)).slice(0, 120)];

  let credits = 0, count = 0;

  // Type 1 - Credit Records from rows
  rows.forEach((r, i) => {
    const n = i + 1;
    if (!r.lodgementRef || String(r.lodgementRef).trim() === '') {
      throw new Error(`Row ${n}: Lodgement Ref is required.`);
    }
    const bsbDigits = U.digitsOnly(r.bsb || '');
    if (bsbDigits.length !== 6) throw new Error(`Row ${n}: BSB must be 6 digits, format NNN-NNN.`);
    const normalizedBsb = normalizeBSBStrict(r.bsb);
    if (!normalizedBsb) throw new Error(`Row ${n}: BSB must be 6 digits, format NNN-NNN.`);
    const acctDigits = U.digitsOnly(r.account || '');
    if (acctDigits.length < 5 || acctDigits.length > 9) throw new Error(`Row ${n}: Account must be 5–9 digits.`);

    const amount = parseFloat(r.amount);
    if (isNaN(amount) || amount <= 0) throw new Error(`Row ${n}: Amount must be a positive number.`);
    const cents = Math.round(amount * 100);
    if (cents > 9999999999) throw new Error(`Row ${n}: Amount exceeds maximum allowed.`);

    const bsb7 = normalizedBsb.padEnd(7, ' ').slice(0, 7);
    const acct9 = U.padL(acctDigits, 9, ' ');
    const ind1 = ' ';
    const code2 = '53';
    const amt10 = U.padL(String(cents), 10);
    const name32 = U.padR((r.accountTitle || '').slice(0, 32), 32);
    const lodg18 = U.padR((r.lodgementRef || '').slice(0, 18), 18);
    const trbsb7 = (h.trace_bsb || '').padEnd(7, ' ').slice(0, 7);
    const tracct9 = U.padL(U.digitsOnly(h.trace_acct || ''), 9, ' ');
    const remit16 = U.padR((h.remitter || '').slice(0, 16), 16);
    const wtax8 = U.padL('0', 8);

    const t1 = '1' + bsb7 + acct9 + ind1 + code2 + amt10 + name32 + lodg18 + trbsb7 + tracct9 + remit16 + wtax8;
    lines.push((t1 + ' '.repeat(120)).slice(0, 120));
    count++;
    credits += cents;
  });

  // Balancing debit (code 13) from header fields
  const balAcctDigits = U.digitsOnly(h.balance_acct || '');
  const balBsbDigits = U.digitsOnly(h.balance_bsb || '');
  if (balBsbDigits.length !== 6) throw new Error('Balance BSB must be 6 digits.');
  const normalizedBalanceBsb = normalizeBSBStrict(h.balance_bsb || '');
  if (!normalizedBalanceBsb) throw new Error('Balance BSB must be 6 digits.');
  if (balAcctDigits.length < 5 || balAcctDigits.length > 9) throw new Error('Balance Account must be 5–9 digits.');

  const balCents = credits;
  const b_bsb7 = normalizedBalanceBsb.padEnd(7, ' ').slice(0, 7);
  const b_acct9 = U.padL(balAcctDigits, 9, ' ');
  const b_ind1 = ' ';
  const b_code2 = '13';
  const b_amt10 = U.padL(String(balCents), 10);
  const b_name32 = U.padR((h.balance_title || '').slice(0, 32), 32);
  const b_lodg18 = U.padR(`${(h.desc || '').slice(0, 12)}-${proc}`.slice(0, 18), 18);
  const b_trbsb7 = (h.trace_bsb || '').padEnd(7, ' ').slice(0, 7);
  const b_tracct9 = U.padL(U.digitsOnly(h.trace_acct || ''), 9, ' ');
  const b_remit16 = U.padR((h.remitter || '').slice(0, 16), 16);
  const b_wtax8 = U.padL('0', 8);

  const balT1 = '1' + b_bsb7 + b_acct9 + b_ind1 + b_code2 + b_amt10 + b_name32 + b_lodg18 + b_trbsb7 + b_tracct9 + b_remit16 + b_wtax8;
  lines.push((balT1 + ' '.repeat(120)).slice(0, 120));
  count++;

  // Type 7 - Control Record
  const netTotal = credits - balCents; // 0
  const t7 = '7'
    + '999-999'
    + U.padR('', 12)
    + U.padL(String(netTotal), 10)
    + U.padL(String(credits), 10)
    + U.padL(String(balCents), 10)
    + U.padR('', 24)
    + U.padL(String(count), 6)
    + U.padR('', 40);
  lines.push((t7 + ' '.repeat(120)).slice(0, 120));
  
  return lines.join('\r\n') + '\r\n';
}


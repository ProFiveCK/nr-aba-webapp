/**
 * The decisions the accrual engine makes, separated from the database work it
 * does. Pure, so the arithmetic that determines what staff are paid out can be
 * exercised directly.
 *
 * `services/leaveAccrual.js` holds the SQL and calls into here; nothing in this
 * file knows what a client or a transaction is.
 */

import { parseDateOnly } from './leaveDates.js';

/**
 * The balance an untouched leave type starts at for a year.
 *
 * Accruable types start at zero and grow with each pay run. Types granted
 * upfront start at their full annual entitlement.
 */
export function seedBalanceFor(type) {
  if (!type) return 0;
  return type.is_accruable ? 0 : Number(type.default_days);
}

/**
 * What carries into a new year from the most recent prior balance.
 *
 * Only types configured never to reset carry anything: their unused days are
 * added on top of the new year's grant. Days already held against a pending
 * application do not carry — they belong to that application, not the balance.
 * Never negative: an overdrawn balance is not turned into a carried debt here.
 */
export function carryoverFor(type, priorBalance) {
  if (!type || type.reset_period !== 'none' || !priorBalance) return 0;
  return Math.max(0, Number(priorBalance.balance) - Number(priorBalance.pending));
}

/**
 * The most recent date at which this employee's balance for a type should have
 * been reset, or null where the type never resets.
 *
 * NOTE: `financial_year` resets on 1 January — the calendar year, despite the
 * name. Naoero's financial year runs July to June, so this is either a
 * misnamed option or a policy gap; it is left as-is deliberately because
 * changing it moves real balances. See docs/HR-HARDENING-PLAN.md.
 *
 * `anniversary` uses the employee's join date, stepping back a year when this
 * year's anniversary has not arrived yet. An employee with no join date on
 * record has no boundary, so their balance is left alone.
 */
export function resetBoundaryFor(employee, resetPeriod, now) {
  if (resetPeriod === 'financial_year') {
    return new Date(now.getFullYear(), 0, 1);
  }
  if (resetPeriod === 'anniversary') {
    const joined = parseDateOnly(employee?.join_date);
    if (!joined) return null;
    const thisYear = new Date(now.getFullYear(), joined.getMonth(), joined.getDate());
    if (thisYear > now) return new Date(now.getFullYear() - 1, joined.getMonth(), joined.getDate());
    return thisYear;
  }
  return null;
}

/**
 * Whether a balance is due a reset: there is a boundary, and the balance has
 * not been reset since it passed. A balance never reset before is always due.
 */
export function isResetDue(lastResetAt, boundary) {
  if (!boundary) return false;
  if (!lastResetAt) return true;
  return new Date(lastResetAt) < boundary;
}

/**
 * The adjustment that records a reset: the difference between what the balance
 * becomes and what it was. Negative where unused days were forfeited, positive
 * where a fresh entitlement was granted, zero where nothing moved.
 */
export function resetDelta(type, currentBalance) {
  return seedBalanceFor(type) - Number(currentBalance);
}

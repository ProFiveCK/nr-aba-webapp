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

/** Unused days on a balance: what is on the books less what is already held. */
function unusedDays(balance) {
  if (!balance) return 0;
  // Never negative — an overdrawn balance is not turned into a carried debt.
  return Math.max(0, Number(balance.balance) - Number(balance.pending));
}

/**
 * What a balance row opens at when one is created for a new calendar year.
 *
 * Balances are keyed by calendar year, but an entitlement period is not
 * necessarily a calendar year. For a type that resets on 1 July, 1 January
 * falls in the middle of the period, so the new row continues the old one: it
 * carries the unused days and does NOT grant a fresh entitlement, because the
 * grant belongs to the period and already happened at the last boundary. The
 * forfeit-and-regrant is the reset's job, at the real boundary.
 *
 * Getting this wrong is how a 1 July reset would take leave away twice a year —
 * once when January silently opened a new row at zero, and again in July.
 *
 * A type that never resets is the exception: it has no period, so each calendar
 * year grants afresh on top of what carried.
 *
 * With no prior year at all this is someone's first year, so they get the
 * grant.
 */
export function openingBalanceFor(type, priorBalance) {
  if (!priorBalance) return seedBalanceFor(type);
  if (!type || type.reset_period === 'none') {
    return seedBalanceFor(type) + unusedDays(priorBalance);
  }
  return unusedDays(priorBalance);
}

/**
 * The month the financial year begins, 1-based. Naoero's runs July to June, so
 * a leave type set to reset on the financial year forfeits on 1 July.
 */
export const FINANCIAL_YEAR_START_MONTH = 7;

/**
 * The most recent date at which this employee's balance for a type should have
 * been reset, or null where the type never resets.
 *
 * `financial_year` is the most recent 1 July on or before `asAt`, stepping back
 * a year when this year's has not arrived yet.
 *
 * `anniversary` does the same with the employee's join date. An employee with
 * no join date on record has no boundary, so their balance is left alone rather
 * than reset against a guessed date.
 *
 * `asAt` is the date being judged — the accrual period being run, not the
 * clock. A catch-up run for an old period must apply that period's boundary.
 */
export function resetBoundaryFor(employee, resetPeriod, asAt) {
  if (resetPeriod === 'financial_year') {
    const thisYear = new Date(asAt.getFullYear(), FINANCIAL_YEAR_START_MONTH - 1, 1);
    if (thisYear > asAt) return new Date(asAt.getFullYear() - 1, FINANCIAL_YEAR_START_MONTH - 1, 1);
    return thisYear;
  }
  if (resetPeriod === 'anniversary') {
    const joined = parseDateOnly(employee?.join_date);
    if (!joined) return null;
    const thisYear = new Date(asAt.getFullYear(), joined.getMonth(), joined.getDate());
    if (thisYear > asAt) return new Date(asAt.getFullYear() - 1, joined.getMonth(), joined.getDate());
    return thisYear;
  }
  return null;
}

/**
 * Whether a balance is due a reset: there is a boundary, and the balance has
 * not been reset since it passed. A balance never reset before is always due.
 *
 * Both arguments are `YYYY-MM-DD` strings, compared as strings — ISO dates sort
 * correctly that way. Comparing Date objects would drag the server's timezone
 * into it, and a boundary is a calendar day, not an instant: an hour either
 * side of midnight must not decide whether someone loses their leave.
 */
export function isResetDue(lastResetDate, boundaryDate) {
  if (!boundaryDate) return false;
  if (!lastResetDate) return true;
  return String(lastResetDate) < String(boundaryDate);
}

/**
 * The adjustment that records a reset: the difference between what the balance
 * becomes and what it was. Negative where unused days were forfeited, positive
 * where a fresh entitlement was granted, zero where nothing moved.
 */
export function resetDelta(type, currentBalance) {
  return seedBalanceFor(type) - Number(currentBalance);
}

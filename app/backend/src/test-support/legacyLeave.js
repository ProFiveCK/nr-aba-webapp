/**
 * Test fixture: the retired employee-side "apply for leave" path.
 *
 * Production no longer accepts applications through this route (new leave goes
 * through the government workflow), but the legacy decide/cancel/balance
 * tests still need pending legacy applications to act on, so the original
 * implementation lives here rather than in the shipped service.
 */

import { ServiceError, badRequest, forbidden } from '../lib/serviceError.js';
import { calculateWorkingDays } from '../lib/leaveDates.js';
import { withTransaction } from '../lib/transaction.js';
import { ensureBalance } from '../services/leaveAccrual.js';
import { balanceYearFor } from '../services/leaveService.js';

/**
 * The public holidays in force, as a Set of `YYYY-MM-DD`.
 *
 * Loaded inside the caller's transaction so the day count and the balance it
 * is charged against are decided from the same snapshot of the calendar.
 */
export async function loadHolidays(client) {
  const { rows } = await client.query(
    "SELECT to_char(holiday_date, 'YYYY-MM-DD') AS day FROM hr_public_holidays"
  );
  return new Set(rows.map((r) => r.day));
}

/**
 * Submits an application and holds the days against the employee's balance.
 *
 * `attachments` are the supporting documents sent with the application, as
 * `{ fileName, contentType, buffer, checksum }`. A leave type marked
 * `requires_attachment` will not accept an application without at least one —
 * official leave is granted on the strength of the partner's invitation and
 * certified sick leave on the strength of the certificate, so an application
 * with neither is not a complete application.
 *
 * Returns `{ application, leaveType }`. The caller notifies the manager.
 */
export async function applyForLeave(
  pool,
  { employee, leaveTypeId, startDate, endDate, reason, attachments = [], actorId = null }
) {
  if (employee.leave_entitled === false) {
    throw forbidden('You are not entitled to leave.');
  }
  return withTransaction(pool, async (client) => {
    const {rows:[current]}=await client.query(`SELECT e.*,r.account_type FROM hr_employees e LEFT JOIN reviewers r ON r.id=e.reviewer_id WHERE e.id=$1 FOR UPDATE OF e`,[employee.id]);
    if(!current || current.status!=='active') throw forbidden('Your employee record is inactive. Contact HR.');
    if(current.leave_policy_regime==='government' || current.account_type==='employee') throw new ServiceError(409,'Government leave submission requires the staged approval workflow.');
    if(actorId && employee.reviewer_id && current.reviewer_id!==actorId) throw forbidden('Your verified employee link changed. Sign in again.');
    if(current.leave_entitled===false) throw forbidden('You are not entitled to leave.');
    // Public holidays are not leave: a day the office is closed does not come
    // off anyone's entitlement.
    const days = calculateWorkingDays(startDate, endDate, await loadHolidays(client));
    if (days <= 0) {
      throw badRequest('The selected dates contain no working days.');
    }

    const { rows: types } = await client.query(
      'SELECT * FROM hr_leave_types WHERE id = $1 AND is_active = TRUE',
      [leaveTypeId]
    );
    if (!types.length) throw badRequest('Unknown leave type.');
    const leaveType = types[0];

    const note = String(reason || '').trim();
    if (!note) {
      throw badRequest('An explanation or reason is required for every leave application.');
    }

    // Checked before the balance is touched, so a rejected application leaves
    // no hold behind.
    if (leaveType.requires_attachment && !attachments.length) {
      const what = String(leaveType.attachment_label || '').trim() || 'a supporting document';
      throw badRequest(`${leaveType.name} leave requires ${what}. Attach it and submit again.`);
    }

    const balance = await ensureBalance(client, employee.id, leaveTypeId, balanceYearFor(startDate));
    const available = Number(balance.balance) - Number(balance.pending);
    if (days > available) {
      throw badRequest(
        `Insufficient leave balance. You have ${available} working days available but requested ${days}.`
      );
    }

    await client.query(
      'UPDATE hr_leave_balances SET pending = pending + $1 WHERE id = $2',
      [days, balance.id]
    );
    const { rows: created } = await client.query(
      `INSERT INTO hr_leave_applications (employee_id, leave_type_id, start_date, end_date, days, reason)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [employee.id, leaveTypeId, startDate, endDate, days, note || null]
    );
    // Inside the same transaction as the application: an application that was
    // only accepted because a document came with it must never exist without
    // that document.
    const stored = [];
    for (const file of attachments) {
      const { rows } = await client.query(
        `INSERT INTO hr_leave_attachments
           (application_id, file_name, content_type, byte_size, file_data, checksum, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, file_name, content_type, byte_size, created_at`,
        [created[0].id, file.fileName, file.contentType || null, file.buffer.length,
         file.buffer, file.checksum, actorId]
      );
      stored.push(rows[0]);
    }
    return { application: { ...created[0], attachments: stored }, leaveType };
  });
}

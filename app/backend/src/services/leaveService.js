/**
 * What the leave workflow actually does, independent of HTTP.
 *
 * Routes handle authentication, capability checks and the shape of the
 * response; everything here is the business rule. Each function owns its
 * transaction, throws a ServiceError for anything the caller should see, and
 * returns the rows a caller needs — including for the notification a route
 * fires afterwards, which is deliberately not done here so that a mail outage
 * can never roll back an accepted application.
 *
 * The invariant these all protect: a day is held against `pending` from the
 * moment leave is applied for until it is decided, and is either released back
 * (cancelled, rejected) or moved out of `balance` (approved). It is never in
 * both places and never in neither.
 */

import { ensureBalance } from './leaveAccrual.js';
import { calculateWorkingDays, parseDateOnly } from '../lib/leaveDates.js';
import { withTransaction } from '../lib/transaction.js';
import { badRequest, forbidden, notFound } from '../lib/serviceError.js';

/**
 * Balances are held per calendar year, keyed on the year the leave starts in.
 * A leave crossing 31 December is charged wholly to the year it began — see
 * docs/HR-HARDENING-PLAN.md.
 */
function balanceYearFor(startDate) {
  const parsed = parseDateOnly(startDate);
  if (!parsed) throw badRequest('That is not a valid date.');
  return parsed.getFullYear();
}

/** Releases the hold an application placed on a balance when it was submitted. */
async function releasePending(client, application) {
  await client.query(
    `UPDATE hr_leave_balances
        SET pending = GREATEST(0, pending - $1)
      WHERE employee_id = $2 AND leave_type_id = $3 AND year = $4`,
    [application.days, application.employee_id, application.leave_type_id,
     balanceYearFor(application.start_date)]
  );
}

/**
 * Submits an application and holds the days against the employee's balance.
 *
 * Returns `{ application, leaveType }`. The caller notifies the manager.
 */
export async function applyForLeave(pool, { employee, leaveTypeId, startDate, endDate, reason }) {
  if (employee.leave_entitled === false) {
    throw forbidden('You are not entitled to leave.');
  }
  const days = calculateWorkingDays(startDate, endDate);
  if (days <= 0) {
    throw badRequest('The selected dates contain no working days.');
  }

  return withTransaction(pool, async (client) => {
    const { rows: types } = await client.query(
      'SELECT * FROM hr_leave_types WHERE id = $1 AND is_active = TRUE',
      [leaveTypeId]
    );
    if (!types.length) throw badRequest('Unknown leave type.');
    const leaveType = types[0];

    const note = String(reason || '').trim();
    if (leaveType.requires_note && !note) {
      throw badRequest(`${leaveType.name} leave requires a reason.`);
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
    return { application: created[0], leaveType };
  });
}

/**
 * Withdraws an applicant's own pending application and releases its hold.
 * Only the applicant may cancel, and only while it is still pending.
 */
export async function cancelLeave(pool, { employee, applicationId }) {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM hr_leave_applications WHERE id = $1 FOR UPDATE',
      [applicationId]
    );
    // Someone else's application is reported as missing rather than forbidden,
    // so this cannot be used to discover that an application exists.
    if (!rows.length || rows[0].employee_id !== employee.id) {
      throw notFound('Leave application not found.');
    }
    const application = rows[0];
    if (application.status !== 'pending') {
      throw badRequest('Only pending applications can be cancelled.');
    }

    await releasePending(client, application);
    await client.query(
      `UPDATE hr_leave_applications SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [application.id]
    );
    return { application };
  });
}

/**
 * Approves or rejects a pending application.
 *
 * `canAct` is supplied by the caller and decides whether this approver may act
 * on this employee — capability lives in the route, the reporting line lives in
 * the data, and neither belongs in here.
 *
 * On approval the held days move out of the balance; on rejection they are
 * released. Returns `{ application, applicant, leaveType }` for the caller to
 * notify with.
 */
export async function decideLeave(pool, { applicationId, decision, note, actorId, canAct }) {
  const reviewerNote = String(note || '').trim();
  if (decision === 'rejected' && !reviewerNote) {
    throw badRequest('A reason is required when rejecting leave.');
  }

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM hr_leave_applications WHERE id = $1 FOR UPDATE',
      [applicationId]
    );
    if (!rows.length) throw notFound('Leave application not found.');
    const application = rows[0];
    if (application.status !== 'pending') {
      throw badRequest('This application is no longer pending.');
    }
    if (!(await canAct(application.employee_id))) {
      throw forbidden('This person does not report to you.');
    }

    await releasePending(client, application);
    if (decision === 'approved') {
      await client.query(
        `UPDATE hr_leave_balances SET balance = balance - $1
          WHERE employee_id = $2 AND leave_type_id = $3 AND year = $4`,
        [application.days, application.employee_id, application.leave_type_id,
         balanceYearFor(application.start_date)]
      );
    }
    const { rows: decided } = await client.query(
      `UPDATE hr_leave_applications
          SET status = $1, reviewed_by = $2, reviewed_at = NOW(), reviewer_note = $3, updated_at = NOW()
        WHERE id = $4 RETURNING *`,
      [decision, actorId, reviewerNote || null, application.id]
    );

    const { rows: context } = await client.query(
      `SELECT e.display_name, e.email, t.name AS leave_type_name
         FROM hr_employees e, hr_leave_types t
        WHERE e.id = $1 AND t.id = $2`,
      [application.employee_id, application.leave_type_id]
    );
    return {
      application: decided[0],
      applicant: context[0] || null,
      leaveTypeName: context[0]?.leave_type_name || null,
    };
  });
}

/**
 * Corrects a balance by hand, recording why.
 *
 * Every adjustment is kept, so a balance can always be explained. A zero
 * adjustment is refused: it would be an audit row asserting nothing.
 */
export async function adjustBalance(pool, { employeeId, leaveTypeId, amount, reason, actorId, year }) {
  const delta = Number(amount);
  if (!Number.isFinite(delta) || delta === 0) {
    throw badRequest('Adjustment amount cannot be zero.');
  }
  const effectiveYear = Number(year) || new Date().getFullYear();
  const why = String(reason || '').trim();

  return withTransaction(pool, async (client) => {
    const balance = await applyAdjustment(client, {
      employeeId, leaveTypeId, delta, reason: why, actorId, year: effectiveYear,
    });
    return { balance, amount: delta, year: effectiveYear, reason: why };
  });
}

/**
 * Moves a balance by `delta` inside a transaction the caller owns, and records
 * why. This is the only path that changes a balance by hand, so every such
 * change has a reason attached to it.
 */
export async function applyAdjustment(client, { employeeId, leaveTypeId, delta, reason, actorId, year }) {
  const balance = await ensureBalance(client, employeeId, leaveTypeId, year);
  const { rows } = await client.query(
    'UPDATE hr_leave_balances SET balance = balance + $1 WHERE id = $2 RETURNING *',
    [delta, balance.id]
  );
  await client.query(
    `INSERT INTO hr_leave_adjustments (employee_id, leave_type_id, amount, reason, adjusted_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [employeeId, leaveTypeId, delta, reason, actorId]
  );
  return rows[0];
}

/**
 * Sets a balance to a figure rather than moving it by one, recording the
 * difference as the adjustment. Used when importing opening balances, so an
 * import leaves the same audit trail a manual correction would.
 *
 * Returns the delta applied, which is zero when the balance already matches.
 */
export async function setOpeningBalance(client, { employeeId, leaveTypeId, target, reason, actorId, year }) {
  const balance = await ensureBalance(client, employeeId, leaveTypeId, year);
  const delta = Number(target) - Number(balance.balance);
  if (delta === 0) return 0;
  await applyAdjustment(client, { employeeId, leaveTypeId, delta, reason, actorId, year });
  return delta;
}

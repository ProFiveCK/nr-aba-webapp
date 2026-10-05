import { pool } from '../db.js';
import { FRONTEND_BASE_URL } from '../config.js';
// One transport and one testing-mode switch for the whole app: mailService's,
// which follows the SMTP settings and testing mode saved in Admin.
import { mailTransport, sendMail, testingModeEnabled } from './mailService.js';
import { lowerEmail } from '../utils/helpers.js';

/**
 * A link into the portal.
 *
 * Leave now lives at real URLs rather than behind a `#`, and the base URL may
 * or may not carry a trailing slash, so joining by hand is how an email ends
 * up pointing at `...info//leave`. Everything still on a hash keeps using
 * `FRONTEND_BASE_URL` directly until its app is converted.
 */
function appUrl(path) {
  return `${FRONTEND_BASE_URL.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}

export async function notifyByPermission({
  permission,
  fallbackRoles = [],
  subject,
  text,
  replyTo,
  bcc,
}) {
  if (!mailTransport || testingModeEnabled) return [];

  // Match an explicit JSONB override OR a row in reviewer_capabilities; since
  // capabilities became the grant store, the JSONB alone holds only overrides.
  const hasPermission = permission
    ? `((r.permissions ? $1 AND (r.permissions -> $1)::boolean = TRUE)
        OR EXISTS (SELECT 1 FROM reviewer_capabilities c
                    WHERE c.reviewer_id = r.id AND c.capability = $1))`
    : 'FALSE';
  const fallback = fallbackRoles.length ? ` OR r.role = ANY($2::text[])` : '';
  const params = permission
    ? (fallbackRoles.length ? [permission, fallbackRoles] : [permission])
    : (fallbackRoles.length ? [fallbackRoles] : []);

  const { rows } = await pool.query(
    `SELECT email, display_name FROM reviewers r
      WHERE r.status = 'active'
        AND (${hasPermission}${fallback})
      ORDER BY r.email`,
    params
  );

  const recipients = Array.from(new Set(rows.map((row) => lowerEmail(row.email)).filter(Boolean)));
  if (!recipients.length) return [];

  const [primary, ...others] = recipients;
  const mailOptions = { to: primary, subject, text, replyTo };
  if (bcc) mailOptions.bcc = bcc;
  if (others.length) {
    mailOptions.bcc = [...(mailOptions.bcc || []), ...others];
  }
  await sendMail(mailOptions);
  return recipients;
}

export async function notifyForexTTReviewers(request, actor) {
  if (!mailTransport || testingModeEnabled) return [];

  const reviewLink = `${FRONTEND_BASE_URL}#reviews/forex-tt?id=${encodeURIComponent(request.request_id)}`;
  const actorName = actor?.display_name || actor?.email || 'A user';
  const subject = `FOREX TT submitted for review — ${request.request_id}`;
  const text = `Hi,

A new foreign currency telegraphic transfer request has been submitted for review.

Request ID: ${request.request_id}
Submitted by: ${actorName}
Status: submitted
Review it here: ${reviewLink}

This notification was sent because you are configured as a FOREX TT reviewer.
`;

  return notifyByPermission({
    permission: 'notify_forex_tt_submissions',
    fallbackRoles: ['reviewer', 'admin'],
    subject,
    text,
    replyTo: actor?.email,
  });
}

function formatForexTTStatusEmail(status) {
  switch (status) {
    case 'approved':
      return { action: 'approved', nextStep: 'No further action is required.' };
    case 'needs_changes':
      return { action: 'requires updates', nextStep: 'Please sign in to the Treasury Portal, open the request, make the requested changes, and resubmit.' };
    case 'cancelled':
      return { action: 'cancelled', nextStep: 'No further action is required.' };
    default:
      return { action: `moved to ${status}`, nextStep: 'Sign in to the Treasury Portal to review the latest status.' };
  }
}

export async function notifyForexTTSubmitter(request, newStatus, comments, actor) {
  if (!mailTransport || testingModeEnabled) return;

  const { rows } = await pool.query(
    'SELECT email, display_name FROM reviewers WHERE id = $1',
    [request.submitted_by]
  );
  if (!rows.length) return;
  const submitter = rows[0];
  const recipient = lowerEmail(submitter.email);
  if (!recipient) return;

  const actorName = actor?.display_name || actor?.email || 'FOREX TT reviewer';
  const requestId = request.request_id || request.id;
  const requestLink = `${FRONTEND_BASE_URL}#forex-tt?id=${encodeURIComponent(requestId)}`;
  const { action, nextStep } = formatForexTTStatusEmail(newStatus);
  const commentsBlock = comments?.trim()
    ? `\nReviewer comments:\n${comments.trim()}\n`
    : '';
  const bankConfirmationBlock = newStatus === 'approved' && request.bank_confirmation?.trim()
    ? `\nBank confirmation:\n${request.bank_confirmation.trim()}\n`
    : '';

  const subject = `FOREX TT ${action} — ${requestId}`;
  const text = `Hi ${submitter.display_name || 'there'},\n\nYour foreign currency telegraphic transfer request ${requestId} has been ${action} by ${actorName}.${commentsBlock}${bankConfirmationBlock}\n${nextStep}\n\nView the request: ${requestLink}\n\nNaoero Treasury Portal\n`;

  await sendMail({ to: recipient, replyTo: actor?.email, subject, text });
}

// ===== Leave & HR =====

function leaveDates(application) {
  const format = (value) => new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  return `${format(application.start_date)} to ${format(application.end_date)}`;
}

/** Tells the approving manager that leave is waiting for them. */
/**
 * Tells whoever will decide a leave application that it is waiting.
 *
 * `approvers` is a list rather than the applicant's manager alone, because a
 * staff record with no manager set used to notify nobody at all: the request
 * appeared in the administrators' queue and sat there unannounced. The caller
 * decides who they are; this only has to reach all of them.
 *
 * Returns the addresses written to, which is what the caller logs.
 */
export async function notifyLeaveSubmitted({ application, employee, approvers }) {
  if (!mailTransport || testingModeEnabled) return [];
  const to = [...new Set(
    (approvers || []).map((approver) => lowerEmail(approver?.email || '')).filter(Boolean)
  )];
  if (!to.length) return [];

  const link = appUrl('leave/approvals');
  const text = `${employee.display_name} has applied for leave and needs your approval.

Type: ${application.leave_type_name}
Dates: ${leaveDates(application)}
Working days: ${application.days}
${application.reason ? `Reason: ${application.reason}\n` : ''}
Review it here: ${link}
`;
  await sendMail({ to: to.join(', '), subject: `Leave approval needed — ${employee.display_name}`, text });
  return to;
}

/** Tells the applicant what was decided. Rejections always carry the reason. */
export async function notifyLeaveDecision({ application, employee, decision, note, decidedBy }) {
  if (!mailTransport || testingModeEnabled) return [];
  const to = lowerEmail(employee?.email || '');
  if (!to) return [];

  const outcome = decision === 'approved' ? 'approved' : 'not approved';
  const text = `Hello ${employee.display_name},

Your ${application.leave_type_name} leave request for ${leaveDates(application)} (${application.days} working days) has been ${outcome}${decidedBy ? ` by ${decidedBy}` : ''}.
${note ? `\nReason: ${note}\n` : ''}
You can see your leave at ${appUrl('leave/my-leave')}
`;
  await sendMail({ to, subject: `Your leave request was ${outcome}`, text });
  return [to];
}

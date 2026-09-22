import nodemailer from 'nodemailer';
import { pool } from '../db.js';
import {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  REPLY_TO,
  FRONTEND_BASE_URL,
} from '../config.js';
import { lowerEmail } from '../utils/helpers.js';

let testingModeEnabled = false;
let testingModeState = {
  updatedAt: null,
  setById: null,
  setByName: null,
  setByEmail: null,
};

export function setTestingMode(enabled, state = {}) {
  testingModeEnabled = enabled;
  testingModeState = {
    updatedAt: state.updatedAt || null,
    setById: state.setById || null,
    setByName: state.setByName || null,
    setByEmail: state.setByEmail || null,
  };
}

export function getTestingMode() {
  return {
    enabled: testingModeEnabled,
    updated_at: testingModeState.updatedAt,
    set_by_name: testingModeState.setByName,
    set_by_email: testingModeState.setByEmail,
  };
}

export let mailTransport = null;
if (SMTP_HOST) {
  mailTransport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
}

export async function sendMail(options = {}) {
  const subject = options.subject || '(no subject)';
  if (testingModeEnabled) {
    console.info('Testing mode active; skipping email send (subject="%s", to=%o).', subject, options.to);
    return;
  }
  if (!mailTransport) {
    console.warn('SMTP not configured; skipping email send for subject "%s".', subject);
    return;
  }

  let fromEmail = SMTP_FROM;
  let replyToEmail = REPLY_TO;
  try {
    const { rows } = await pool.query('SELECT from_email, reply_to_email FROM smtp_settings WHERE id = TRUE');
    if (rows.length > 0) {
      fromEmail = rows[0].from_email || fromEmail;
      replyToEmail = rows[0].reply_to_email || replyToEmail;
    }
  } catch (err) {
    console.warn('Failed to load SMTP settings from database, using environment defaults:', err.message);
  }

  const payload = { from: fromEmail, ...options };
  if (!payload.replyTo && replyToEmail) payload.replyTo = replyToEmail;
  try {
    await mailTransport.sendMail(payload);
  } catch (err) {
    console.error(
      'Email send failed (subject="%s", to=%o, cc=%o, bcc=%o): %s',
      subject,
      payload.to,
      payload.cc,
      payload.bcc,
      err?.message || err
    );
    throw err;
  }
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

export async function notifyReviewersOfNewBatch(batch, metadata) {
  const formattedCode = require('./utils/helpers.js').formatBatchCode(batch.code);
  const currencyFormatter = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
  const creditsValue = (metadata?.metrics?.creditsCents !== undefined)
    ? currencyFormatter.format((metadata.metrics.creditsCents || 0) / 100)
    : 'N/A';
  const duplicates = metadata?.duplicates ?? {};
  const transactionCount = metadata?.metrics?.transactionCount
    ?? metadata?.payload?.transactions?.length
    ?? 'N/A';
  const notesLine = metadata?.notes ? metadata.notes : 'None';
  const departmentCode = metadata?.department_code || batch.department_code || 'Unknown';
  const pdNumber = metadata?.pd_number || batch.pd_number || 'N/A';
  const submitter = metadata?.prepared_by || metadata?.prepared_by_name || batch.submitted_email || 'Unknown';
  const reviewLink = `${FRONTEND_BASE_URL}?batch=${encodeURIComponent(formattedCode)}`;
  const subject = `PD ${pdNumber} - Dept ${departmentCode} - ${formattedCode}`;
  const text = `A new ABA batch has been submitted for review.\n\nReference code: ${formattedCode}\nDepartment: ${departmentCode}\nPD number: ${pdNumber}\nPrepared by: ${submitter}\nTransactions: ${transactionCount}\nTotal credits: ${creditsValue}\nDuplicate sets: ${duplicates.sets ?? 0}\nDuplicate rows: ${duplicates.rows ?? 0}\nNotes: ${notesLine}\nStage: submitted\n\nReview it here: ${reviewLink}\n`;

  await notifyByPermission({
    permission: 'notify_aba_submissions',
    fallbackRoles: ['reviewer', 'admin'],
    subject,
    text,
    replyTo: batch.submitted_email || metadata?.submitted_by_email,
  });
}

export async function notifySubmitterOfApproval(batch, metadata, comments, actor) {
  const recipient = batch?.submitted_email || metadata?.submitted_by_email;
  if (!recipient) return;
  const formattedCode = require('./utils/helpers.js').formatBatchCode(batch.code);
  const departmentCode = metadata?.department_code || batch.department_code || 'Unknown';
  const pdNumber = metadata?.pd_number || batch.pd_number || 'N/A';
  const actorName = actor?.display_name || actor?.email || 'Reviewer';
  const submitterName = metadata?.prepared_by || metadata?.prepared_by_name || 'team';
  const subject = `PD ${pdNumber} - Dept ${departmentCode} - ${formattedCode} approved`;
  const commentsText = comments?.trim()
    ? `\nReviewer comments:\n${comments.trim()}\n`
    : '';
  const text = `Hi ${submitterName},\n\nYour ABA batch ${formattedCode} for department ${departmentCode} (PD ${pdNumber}) was approved by ${actorName}.${commentsText}\nSign in to the Naoero Treasury portal to view the approved batch.\n`;
  await sendMail({ to: recipient, replyTo: actor?.email, subject, text });
}

export async function notifySubmitterOfRejection(batch, metadata, comments, actor) {
  const recipient = batch?.submitted_email || metadata?.submitted_by_email;
  if (!recipient) return;
  const formattedCode = require('./utils/helpers.js').formatBatchCode(batch.code);
  const departmentCode = metadata?.department_code || batch.department_code || 'Unknown';
  const pdNumber = metadata?.pd_number || batch.pd_number || 'N/A';
  const actorName = actor?.display_name || actor?.email || 'Reviewer';
  const submitterName = metadata?.prepared_by || metadata?.prepared_by_name || 'team';
  const subject = `PD ${pdNumber} - Dept ${departmentCode} - ${formattedCode} requires updates`;
  const reasonText = comments?.trim() ? comments.trim() : 'No additional comments were provided.';
  const text = `Hi ${submitterName},\n\nYour ABA batch ${formattedCode} for department ${departmentCode} (PD ${pdNumber}) was rejected by ${actorName}.\n\nReviewer comments:\n${reasonText}\n\nSign in to the Naoero Treasury portal to review the notes and resubmit a corrected batch.\n`;
  await sendMail({ to: recipient, replyTo: actor?.email, subject, text });
}

export async function notifyAdminsOfSignupRequest({ email, name, departmentCode }) {
  const { rows: settingsRows } = await pool.query(
    `SELECT support_email FROM smtp_settings WHERE id = TRUE AND support_email IS NOT NULL AND support_email != ''`
  );

  let recipients;
  if (settingsRows.length > 0 && settingsRows[0].support_email) {
    recipients = [lowerEmail(settingsRows[0].support_email)];
  } else {
    const { rows } = await pool.query(
      `SELECT email FROM reviewers
        WHERE role = 'admin'
          AND status = 'active'
          AND email IS NOT NULL`
    );
    recipients = Array.from(new Set(rows.map((row) => lowerEmail(row.email)).filter(Boolean)));
  }

  if (!recipients.length) return;
  const signupName = name || email;
  const deptLine = departmentCode ? `Department Head: ${departmentCode}\n` : '';
  const adminLink = `${FRONTEND_BASE_URL}#admin`;
  const text = `A new signup request is waiting for review.\n\nName: ${signupName}\nEmail: ${email}\n${deptLine}\nReview the request from the Admin tab: ${adminLink}\n`;
  const subject = `Signup request submitted by ${signupName}`;
  const [primaryRecipient, ...bccRecipients] = recipients;
  const mailOptions = { to: primaryRecipient, subject, text };
  if (bccRecipients.length) mailOptions.bcc = bccRecipients;
  await sendMail(mailOptions);
}

export async function sendReviewerWelcomeEmail({ email, display_name, role }, tempPassword) {
  const name = display_name || email;
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Account';
  const loginUrl = FRONTEND_BASE_URL;
  const text = `Hi ${name},\n\nYour ${roleLabel.toLowerCase()} access has been created for the Naoero Treasury Portal.\n\nLogin: ${loginUrl}\nEmail: ${email}\nTemporary password: ${tempPassword}\n\nYou will be asked to set a new password after signing in.\n`;
  await sendMail({ to: email, subject: 'Naoero Treasury Portal access', text });
}

export async function sendReviewerPasswordResetEmail({ email, display_name, role }, tempPassword) {
  const name = display_name || email;
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'account';
  const loginUrl = FRONTEND_BASE_URL;
  const text = `Hi ${name},\n\nYour ${roleLabel.toLowerCase()} password has been reset. Use the temporary password below to sign in; you will be prompted to set a new password immediately afterwards.\n\nLogin: ${loginUrl}\nEmail: ${email}\nTemporary password: ${tempPassword}\n\nIf you did not request this change, contact an administrator immediately.\n`;
  await sendMail({ to: email, subject: 'Naoero Treasury Portal password reset', text });
}

// ===== Leave & HR =====

function leaveDates(application) {
  const format = (value) => new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  return `${format(application.start_date)} to ${format(application.end_date)}`;
}

/** Tells the approving manager that leave is waiting for them. */
export async function notifyLeaveSubmitted({ application, employee, manager }) {
  if (!mailTransport || testingModeEnabled) return [];
  const to = lowerEmail(manager?.email || '');
  if (!to) return [];

  const link = `${FRONTEND_BASE_URL}#hr/approvals`;
  const text = `${employee.display_name} has applied for leave and needs your approval.

Type: ${application.leave_type_name}
Dates: ${leaveDates(application)}
Working days: ${application.days}
${application.reason ? `Reason: ${application.reason}\n` : ''}
Review it here: ${link}
`;
  await sendMail({ to, subject: `Leave approval needed — ${employee.display_name}`, text });
  return [to];
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
You can see your leave at ${FRONTEND_BASE_URL}#hr/my-leave
`;
  await sendMail({ to, subject: `Your leave request was ${outcome}`, text });
  return [to];
}

/**
 * Mail for the ABA, signup and account flows, moved out of server.js unchanged.
 *
 * This keeps its own transport and testing-mode state, separate from
 * services/notificationService.js (which the FOREX TT and HR routers use). Only
 * this copy is reloaded from the smtp_settings table and follows the admin
 * testing-mode switch, exactly as before the move.
 */
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { pool } from '../db.js';
import {
  FRONTEND_BASE_URL,
  REPLY_TO,
  SMTP_FROM,
  SMTP_HOST,
  SMTP_PASS,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
} from '../config.js';
import { formatBatchCode, lowerEmail } from '../utils/helpers.js';

let testingModeEnabled = false;
let testingModeState = {
  updatedAt: null,
  setById: null,
  setByName: null,
  setByEmail: null
};

let mailTransport = null;
if (SMTP_HOST) {
  mailTransport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
  });
}

async function refreshTestingModeSetting() {
  try {
    const { rows } = await pool.query(
      `SELECT rs.testing_mode,
              rs.testing_mode_set_at,
              rs.testing_mode_set_by,
              rv.display_name AS set_by_name,
              rv.email AS set_by_email
         FROM reviewer_settings rs
         LEFT JOIN reviewers rv ON rv.id = rs.testing_mode_set_by
        WHERE rs.id = TRUE`
    );
    if (!rows.length) {
      testingModeEnabled = false;
      testingModeState = {
        updatedAt: null,
        setById: null,
        setByName: null,
        setByEmail: null
      };
      return {
        enabled: false,
        updated_at: null,
        set_by_name: null,
        set_by_email: null
      };
    }
    const row = rows[0];
    testingModeEnabled = !!row.testing_mode;
    testingModeState = {
      updatedAt: row.testing_mode_set_at,
      setById: row.testing_mode_set_by,
      setByName: row.set_by_name || row.set_by_email || null,
      setByEmail: row.set_by_email || null
    };
    return {
      enabled: testingModeEnabled,
      updated_at: row.testing_mode_set_at,
      set_by_name: row.set_by_name || row.set_by_email || null,
      set_by_email: row.set_by_email || null
    };
  } catch (err) {
    console.error('Failed to refresh testing mode setting', err);
    testingModeEnabled = false;
    testingModeState = {
      updatedAt: null,
      setById: null,
      setByName: null,
      setByEmail: null
    };
    throw err;
  }
}

async function sendMail(options = {}) {
  const subject = options.subject || '(no subject)';
  if (testingModeEnabled) {
    console.info(
      'Testing mode active; skipping email send (subject="%s", to=%o).',
      subject,
      options.to
    );
    return;
  }
  if (!mailTransport) {
    console.warn('SMTP not configured; skipping email send for subject "%s".', subject);
    return;
  }
  
  // Get from/reply-to from database settings if available
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

function buildBatchReviewLink(code) {
  const formatted = formatBatchCode(code);
  try {
    const url = new URL(FRONTEND_BASE_URL);
    url.searchParams.set('batch', formatted);
    return url.toString();
  } catch (_) {
    return `${FRONTEND_BASE_URL}?batch=${encodeURIComponent(formatted)}`;
  }
}

async function sendReviewerWelcomeEmail({ email, display_name, role }, tempPassword) {
  const name = display_name || email;
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Account';
  const loginUrl = FRONTEND_BASE_URL;
  const text = `Hi ${name},

Your ${roleLabel.toLowerCase()} access has been created for the Naoero Treasury Portal.

Login: ${loginUrl}
Email: ${email}
Temporary password: ${tempPassword}

You will be asked to set a new password after signing in.
`;
  await sendMail({ to: email, subject: 'Naoero Treasury Portal access', text });
}

async function sendReviewerPasswordResetEmail({ email, display_name, role }, tempPassword) {
  const name = display_name || email;
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'account';
  const loginUrl = FRONTEND_BASE_URL;
  const text = `Hi ${name},

Your ${roleLabel.toLowerCase()} password has been reset. Use the temporary password below to sign in; you will be prompted to set a new password immediately afterwards.

Login: ${loginUrl}
Email: ${email}
Temporary password: ${tempPassword}

If you did not request this change, contact an administrator immediately.
`;
  await sendMail({ to: email, subject: 'Naoero Treasury Portal password reset', text });
}

async function notifyAdminsOfSignupRequest({ email, name, departmentCode, requestedRole }) {
  if (!mailTransport || testingModeEnabled) return;
  
  // Check if support_email is configured in smtp_settings
  const { rows: settingsRows } = await pool.query(
    `SELECT support_email FROM smtp_settings WHERE id = TRUE AND support_email IS NOT NULL AND support_email != ''`
  );
  
  let recipients;
  if (settingsRows.length > 0 && settingsRows[0].support_email) {
    // Use configured support email
    recipients = [lowerEmail(settingsRows[0].support_email)];
  } else {
    // Fallback to all active admins
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
  const roleLine = requestedRole ? `Requested access: ${requestedRole}\n` : '';
  const adminLink = `${FRONTEND_BASE_URL}#admin`;
  const text = `A new signup request is waiting for review.\n\nName: ${signupName}\nEmail: ${email}\n${deptLine}${roleLine}\nReview the request from the Admin tab: ${adminLink}\n`;
  const subject = `Signup request submitted by ${signupName}`;
  const [primaryRecipient, ...bccRecipients] = recipients;
  const mailOptions = { to: primaryRecipient, subject, text };
  if (bccRecipients.length) mailOptions.bcc = bccRecipients;
  await sendMail(mailOptions);
}

async function notifyReviewersOfNewBatch(batch, metadata) {
  if (!mailTransport || testingModeEnabled) return;
  // Notify reviewers/admins who have notify_on_submission = true
  const { rows } = await pool.query(
    `SELECT email, display_name FROM reviewers
      WHERE status = 'active'
        AND role IN ('reviewer', 'admin')
        AND notify_on_submission = TRUE`
  );
  if (!rows.length) return;
  const recipients = Array.from(new Set(rows.map((row) => lowerEmail(row.email)).filter(Boolean)));
  if (!recipients.length) return;
  const formattedCode = formatBatchCode(batch.code);
  const reviewLink = buildBatchReviewLink(batch.code);
  const currencyFormatter = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
  const creditsValue = (metadata?.metrics?.creditsCents !== undefined)
    ? currencyFormatter.format((metadata.metrics.creditsCents || 0) / 100)
    : 'N/A';
  const duplicates = metadata?.duplicates ?? {};
  const duplicateSets = duplicates.sets ?? 0;
  const duplicateRows = duplicates.rows ?? 0;
  const transactionCount = metadata?.metrics?.transactionCount
    ?? metadata?.payload?.transactions?.length
    ?? 'N/A';
  const notesLine = metadata?.notes ? metadata.notes : 'None';
  const departmentCode = metadata?.department_code || batch.department_code || 'Unknown';
  const pdNumber = metadata?.pd_number || batch.pd_number || 'N/A';
  const submitter = metadata?.prepared_by || metadata?.prepared_by_name || batch.submitted_email || 'Unknown';
  const subject = `PD ${pdNumber} - Dept ${departmentCode} - ${formattedCode}`;
  const text = `A new ABA batch has been submitted for review.

Reference code: ${formattedCode}
Department: ${departmentCode}
PD number: ${pdNumber}
Prepared by: ${submitter}
Transactions: ${transactionCount}
Total credits: ${creditsValue}
Duplicate sets: ${duplicateSets}
Duplicate rows: ${duplicateRows}
Notes: ${notesLine}
Stage: submitted

Review it here: ${reviewLink}
`;
  const [primaryRecipient, ...bccRecipients] = recipients;
  const mailOptions = {
    to: primaryRecipient,
    subject,
    text,
    replyTo: batch.submitted_email || metadata?.submitted_by_email
  };
  if (bccRecipients.length) mailOptions.bcc = bccRecipients;
  await sendMail(mailOptions);
}

async function notifyPublicHealthReviewers(batch, metadata) {
  if (!mailTransport || testingModeEnabled) return;
  const { rows } = await pool.query(
    `SELECT email, display_name FROM reviewers
      WHERE status = 'active'
        AND role IN ('reviewer', 'admin')
        AND notify_on_submission = TRUE`
  );
  if (!rows.length) return;
  const recipients = Array.from(new Set(rows.map((row) => lowerEmail(row.email)).filter(Boolean)));
  if (!recipients.length) return;
  const formattedCode = formatBatchCode(batch.code);
  const paidDate = metadata?.paid_date || 'N/A';
  const participantCount = metadata?.participant_count ?? 'N/A';
  const submitter = metadata?.prepared_by || batch.submitted_email || 'Unknown';
  const reviewLink = `${FRONTEND_BASE_URL}#public-health/review`;
  const subject = `Fit for Duty pay run submitted — ${formattedCode}`;
  const text = `A new Fit for Duty allowance pay run has been submitted for review.\n\nReference code: ${formattedCode}\nPaid date: ${paidDate}\nParticipants: ${participantCount}\nSubmitted by: ${submitter}\n\nReview it here: ${reviewLink}\n`;
  const [primaryRecipient, ...bccRecipients] = recipients;
  const mailOptions = {
    to: primaryRecipient,
    subject,
    text,
    replyTo: batch.submitted_email || metadata?.submitted_by_email
  };
  if (bccRecipients.length) mailOptions.bcc = bccRecipients;
  await sendMail(mailOptions);
}

async function notifySubmitterOfApproval(batch, metadata, comments, actor) {
  if (!mailTransport || testingModeEnabled) return;
  const recipient = batch?.submitted_email || metadata?.submitted_by_email;
  if (!recipient) return;
  const formattedCode = formatBatchCode(batch.code);
  const departmentCode = metadata?.department_code || batch.department_code || 'Unknown';
  const pdNumber = metadata?.pd_number || batch.pd_number || 'N/A';
  const actorName = actor?.display_name || actor?.email || 'Reviewer';
  const submitterName = metadata?.prepared_by || metadata?.prepared_by_name || 'team';
  const subject = `PD ${pdNumber} - Dept ${departmentCode} - ${formattedCode} approved`;
  const commentsText = comments?.trim()
    ? `\nReviewer comments:\n${comments.trim()}\n`
    : '';
  const text = `Hi ${submitterName},

Your ABA batch ${formattedCode} for department ${departmentCode} (PD ${pdNumber}) was approved by ${actorName}.
${commentsText}
Sign in to the Naoero Treasury portal to view the approved batch.
`;
  await sendMail({ to: recipient, replyTo: actor?.email, subject, text });
}

async function notifySubmitterOfRejection(batch, metadata, comments, actor) {
  if (!mailTransport || testingModeEnabled) return;
  const recipient = batch?.submitted_email || metadata?.submitted_by_email;
  if (!recipient) return;
  const formattedCode = formatBatchCode(batch.code);
  const departmentCode = metadata?.department_code || batch.department_code || 'Unknown';
  const pdNumber = metadata?.pd_number || batch.pd_number || 'N/A';
  const actorName = actor?.display_name || actor?.email || 'Reviewer';
  const submitterName = metadata?.prepared_by || metadata?.prepared_by_name || 'team';
  const subject = `PD ${pdNumber} - Dept ${departmentCode} - ${formattedCode} requires updates`;
  const reasonText = comments?.trim() ? comments.trim() : 'No additional comments were provided.';
  const text = `Hi ${submitterName},

Your ABA batch ${formattedCode} for department ${departmentCode} (PD ${pdNumber}) was rejected by ${actorName}.

Reviewer comments:
${reasonText}

Sign in to the Naoero Treasury portal to review the notes and resubmit a corrected batch.
`;
  await sendMail({ to: recipient, replyTo: actor?.email, subject, text });
}

// SMTP password encryption (AES-256-GCM). Requires SMTP_ENC_KEY (64 hex chars = 32 bytes).
// If unset, SMTP passwords stored in the DB remain plaintext (legacy) and a warning is logged.
const SMTP_ENC_KEY_HEX = process.env.SMTP_ENC_KEY || null;
function smtpEncryptionKey() {
  if (!SMTP_ENC_KEY_HEX) return null;
  try {
    return Buffer.from(SMTP_ENC_KEY_HEX, 'hex');
  } catch {
    return null;
  }
}

// Encrypt a plaintext string to a base64 "v1:<iv>:<ciphertext>" token.
function encryptSmtpPass(plain) {
  if (!plain) return null;
  const key = smtpEncryptionKey();
  if (!key) return plain; // encryption disabled — store as-is (legacy)
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

// Decrypt a value produced by encryptSmtpPass. Returns null on any failure.
function decryptSmtpPass(stored) {
  if (!stored) return null;
  const key = smtpEncryptionKey();
  if (!key) return stored; // encryption disabled — value is plaintext (legacy)
  const parts = String(stored).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null; // not our format / tampered
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const enc = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}

if (!SMTP_ENC_KEY_HEX) {
  console.warn('SECURITY WARNING: SMTP_ENC_KEY is not set. SMTP passwords will be stored without at-rest encryption.');
}

// Helper function to reload mail transport with new settings
async function reloadMailTransport() {
  try {
    const { rows } = await pool.query(`
      SELECT smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass_encrypted, from_email, reply_to_email
      FROM smtp_settings WHERE id = TRUE
    `);
    
    if (rows.length > 0) {
      const settings = rows[0];
      let smtpPass = null;
      if (settings.smtp_pass_encrypted) {
        // Decrypt password (AES-256-GCM). Falls back to legacy plaintext if key unset.
        const decrypted = decryptSmtpPass(settings.smtp_pass_encrypted);
        if (decrypted === null) {
          console.error('Failed to decrypt SMTP password (SMTP_ENC_KEY changed or corrupt ciphertext).');
        } else {
          smtpPass = decrypted;
        }
      }
      
      mailTransport = nodemailer.createTransport({
        host: settings.smtp_host,
        port: settings.smtp_port,
        secure: settings.smtp_secure,
        auth: settings.smtp_user ? { user: settings.smtp_user, pass: smtpPass } : undefined
      });
      
      return settings;
    } else {
      // Fall back to environment variables
      if (SMTP_HOST) {
        mailTransport = nodemailer.createTransport({
          host: SMTP_HOST,
          port: SMTP_PORT,
          secure: SMTP_SECURE,
          auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
        });
      }
      return null;
    }
  } catch (err) {
    console.error('Failed to reload mail transport:', err);
    throw err;
  }
}

export {
  encryptSmtpPass,
  mailTransport,
  notifyAdminsOfSignupRequest,
  notifyPublicHealthReviewers,
  notifySubmitterOfApproval,
  notifySubmitterOfRejection,
  refreshTestingModeSetting,
  reloadMailTransport,
  sendMail,
  sendReviewerPasswordResetEmail,
  sendReviewerWelcomeEmail,
};

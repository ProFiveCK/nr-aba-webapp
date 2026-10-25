import { withTransaction } from '../lib/transaction.js';
import { badRequest, notFound, ServiceError } from '../lib/serviceError.js';
import { recordAudit } from './auditService.js';
import { sendMail } from './mailService.js';
import { lowerEmail } from '../utils/helpers.js';

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Changes the email address an account signs in with.
 *
 * The address is the login ID and is copied or matched in several places, so
 * changing it is one transaction rather than a single UPDATE:
 *  - the linked employee's contact address follows the login;
 *  - sessions, password-reset links and activation links are ended, because the
 *    old mailbox may have been the one that received them;
 *  - the Google link is removed, so the next Google sign-in must match the new
 *    verified address (a typo cannot hand the account to someone else's mailbox);
 *  - batches this person submitted before submissions were tied to an account id
 *    are attached to the account, so they stay theirs and the old address, once
 *    reused, cannot inherit them.
 * Both the old and the new address are told afterwards (best effort).
 */
export async function changeAccountEmail(pool, { reviewerId, email, reason, actor }) {
  const next = lowerEmail(email);
  if (!next || next.length > 254 || !EMAIL_SHAPE.test(next)) throw badRequest('Enter a valid email address.');
  if (typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 1000) {
    throw badRequest('Give a reason of 10–1,000 characters.');
  }

  const previous = await withTransaction(pool, async (client) => {
    const { rows: [account] } = await client.query(
      'SELECT id, email FROM reviewers WHERE id = $1 FOR UPDATE', [reviewerId]);
    if (!account) throw notFound('Account not found.');
    const before = account.email ? lowerEmail(account.email) : null;
    if (before === next) throw badRequest('That is already this account’s email address.');

    const { rows: [clash] } = await client.query(
      `SELECT 'account' AS kind FROM reviewers WHERE id <> $2 AND (lower(email) = $1 OR lower(login_alias) = $1)
       UNION ALL SELECT 'signup' FROM signup_requests WHERE status = 'pending' AND lower(email) = $1
       LIMIT 1`, [next, reviewerId]);
    if (clash) {
      throw new ServiceError(409, clash.kind === 'signup'
        ? 'A pending sign-up request already uses that address. Decide that request first.'
        : 'Another account already uses that email address or login ID.');
    }

    try {
      await client.query('UPDATE reviewers SET email = $2, updated_at = NOW() WHERE id = $1', [reviewerId, next]);
    } catch (err) {
      if (err.code === '23505') throw new ServiceError(409, 'Another account already uses that email address.');
      throw err;
    }
    await client.query('UPDATE hr_employees SET email = $2 WHERE reviewer_id = $1', [reviewerId, next]);

    await client.query('DELETE FROM reviewer_sessions WHERE reviewer_id = $1', [reviewerId]);
    await client.query('DELETE FROM password_reset_tokens WHERE reviewer_id = $1', [reviewerId]);
    await client.query(
      'UPDATE hr_account_tokens SET revoked_at = NOW() WHERE reviewer_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL',
      [reviewerId]);
    await client.query('DELETE FROM reviewer_identities WHERE reviewer_id = $1', [reviewerId]);

    if (before) {
      for (const table of ['batch_archives', 'batch_archives_history']) {
        await client.query(
          `UPDATE ${table} SET submitted_by = $1 WHERE submitted_by IS NULL AND lower(submitted_email) = $2`,
          [reviewerId, before]);
      }
    }

    await recordAudit({
      client, actor, action: 'reviewer.email_changed', entityType: 'reviewer', entityId: reviewerId,
      before: { email: account.email || null }, after: { email: next }, metadata: { reason: reason.trim() },
    });
    return account.email || null;
  });

  const notice = (to, text) => sendMail({ to, subject: 'Your Naoero Treasury Portal sign-in email was changed', text })
    .catch((err) => console.error('Failed to send email-change notice', err));
  const message = `The sign-in email for this Naoero Treasury Portal account was changed${previous ? ` from ${previous}` : ''} to ${next} by an administrator.\n\nIf you did not expect this, contact the portal administrator.`;
  if (previous) await notice(previous, message);
  await notice(next, message);

  return { id: reviewerId, email: next, previous_email: previous };
}

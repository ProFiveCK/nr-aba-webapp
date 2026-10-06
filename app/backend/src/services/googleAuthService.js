import { randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { pool } from '../db.js';
import { GOOGLE_CLIENT_ID } from '../config.js';
import { lowerEmail } from '../utils/helpers.js';
import { recordAudit } from './auditService.js';

const PROVIDER = 'google';

export const googleSignInEnabled = Boolean(GOOGLE_CLIENT_ID);

const client = googleSignInEnabled ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const REVIEWER_COLUMNS = `r.id, r.email, r.display_name, r.role, r.status, r.must_change_password,
       r.last_login_at, r.created_at, r.updated_at, r.department_code, r.division_code,
       r.notify_on_submission, r.permissions, r.account_type`;

/**
 * Outcomes are deliberately coarse for the caller to map onto HTTP codes.
 * Anything other than 'ok' must NOT create an account: a Google identity that
 * does not already resolve to an active reviewer gets no access and no row.
 */
export const GoogleSignInResult = {
  OK: 'ok',
  DISABLED: 'disabled',
  BAD_TOKEN: 'bad_token',
  EMAIL_UNVERIFIED: 'email_unverified',
  NO_ACCOUNT: 'no_account',
  INACTIVE: 'inactive',
};

async function verifyIdToken(idToken) {
  const ticket = await client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  return ticket.getPayload();
}

/**
 * Resolve a Google ID token to an existing reviewer.
 *
 * Lookup is by the immutable `sub` claim first; an email match is only used to
 * establish the very first link, and only when Google says the address is
 * verified. Accounts are never created here.
 */
export async function resolveGoogleIdentity(idToken, { ip } = {}) {
  if (!googleSignInEnabled) return { result: GoogleSignInResult.DISABLED };

  let payload;
  try {
    payload = await verifyIdToken(idToken);
  } catch (err) {
    console.warn(`[google-auth] token verification failed from ${ip}: ${err.message}`);
    return { result: GoogleSignInResult.BAD_TOKEN };
  }

  const subject = payload?.sub;
  const email = lowerEmail(payload?.email || '');
  if (!subject || !email) return { result: GoogleSignInResult.BAD_TOKEN };

  // Already linked: the subject is authoritative, even if the address changed.
  const linked = await pool.query(
    `SELECT ${REVIEWER_COLUMNS}
       FROM reviewer_identities i
       JOIN reviewers r ON r.id = i.reviewer_id
      WHERE i.provider = $1 AND i.provider_subject = $2`,
    [PROVIDER, subject]
  );
  if (linked.rows.length) {
    const reviewer = linked.rows[0];
    if (reviewer.status !== 'active') {
      console.warn(`[google-auth] inactive account ${reviewer.email} from ${ip}`);
      return { result: GoogleSignInResult.INACTIVE };
    }
    await pool.query(
      'UPDATE reviewer_identities SET last_login_at = NOW(), email = $3 WHERE provider = $1 AND provider_subject = $2',
      [PROVIDER, subject, email]
    );
    return { result: GoogleSignInResult.OK, reviewer, linkedNow: false };
  }

  // First-time link requires a Google-verified address matching an existing account.
  if (payload.email_verified !== true) {
    console.warn(`[google-auth] unverified google email ${email} from ${ip}`);
    return { result: GoogleSignInResult.EMAIL_UNVERIFIED };
  }

  const matched = await pool.query(
    `SELECT ${REVIEWER_COLUMNS} FROM reviewers r WHERE r.email = $1`,
    [email]
  );
  if (!matched.rows.length) {
    console.warn(`[google-auth] no portal account for ${email} from ${ip}`);
    return { result: GoogleSignInResult.NO_ACCOUNT };
  }

  const reviewer = matched.rows[0];
  if (reviewer.status !== 'active') {
    console.warn(`[google-auth] inactive account ${email} from ${ip}`);
    return { result: GoogleSignInResult.INACTIVE };
  }

  await pool.query(
    `INSERT INTO reviewer_identities (reviewer_id, provider, provider_subject, email, last_login_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (provider, provider_subject) DO NOTHING`,
    [reviewer.id, PROVIDER, subject, email]
  );
  await recordAudit({
    actor: { id: reviewer.id, email: reviewer.email, ip },
    action: 'auth.google.link',
    entityType: 'reviewer',
    entityId: reviewer.id,
    metadata: { provider: PROVIDER, email },
  });
  console.info(`[google-auth] linked ${email} to reviewer ${reviewer.id} from ${ip}`);

  return { result: GoogleSignInResult.OK, reviewer, linkedNow: true };
}

export async function listIdentities(reviewerId) {
  const { rows } = await pool.query(
    `SELECT provider, email, linked_at, last_login_at
       FROM reviewer_identities WHERE reviewer_id = $1 ORDER BY linked_at`,
    [reviewerId]
  );
  return rows;
}

export async function unlinkIdentity(reviewerId, provider) {
  const { rowCount } = await pool.query(
    'DELETE FROM reviewer_identities WHERE reviewer_id = $1 AND provider = $2',
    [reviewerId, provider]
  );
  return rowCount > 0;
}

/**
 * Retires a pending temporary password when its owner signs in with Google.
 *
 * `must_change_password` means an administrator set a password and told
 * somebody what it was. Until it is replaced it is a live credential a second
 * person knows, which is why such a session is otherwise allowed to do
 * nothing but replace it. That left anyone who never used the temporary
 * password stuck: signing in with Google worked, and then every request was
 * refused until they produced a password they had never been given.
 *
 * Signing in with Google proves who they are without it, so the flag is
 * cleared. Clearing it alone would leave the shared password working, so the
 * hash is replaced with a value no input can match — bcrypt compares against
 * it and simply returns false. The account becomes Google-only.
 *
 * Only a *pending temporary* password is retired. Somebody who chose their
 * own password keeps it, because while Google is not yet the only way in, a
 * problem with the Google configuration must not be able to lock out
 * everyone who has ever used it. When Google does become the only route,
 * widen this to every sign-in.
 *
 * Returns true when a password was retired, so the caller can correct the
 * session payload it is about to send.
 */
export async function retireTemporaryPassword(reviewer, { ip } = {}) {
  if (!reviewer?.must_change_password) return false;

  await pool.query(
    `UPDATE reviewers
        SET password_hash = $1, must_change_password = FALSE, updated_at = NOW()
      WHERE id = $2`,
    [`google-only:${randomBytes(32).toString('hex')}`, reviewer.id]
  );
  await recordAudit({
    actor: { id: reviewer.id, email: reviewer.email, ip },
    action: 'auth.google.password_retired',
    entityType: 'reviewer',
    entityId: reviewer.id,
    after: { must_change_password: false, password: 'retired — account signs in with Google' },
  });
  console.info(`[google-auth] retired the temporary password for ${reviewer.email}`);
  return true;
}

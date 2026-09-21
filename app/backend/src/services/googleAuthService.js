import { OAuth2Client } from 'google-auth-library';
import { pool } from '../db.js';
import { GOOGLE_CLIENT_ID } from '../config.js';
import { lowerEmail } from '../utils/helpers.js';
import { recordAudit } from './auditService.js';

const PROVIDER = 'google';

export const googleSignInEnabled = Boolean(GOOGLE_CLIENT_ID);

const client = googleSignInEnabled ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const REVIEWER_COLUMNS = `id, email, display_name, role, status, must_change_password,
       last_login_at, created_at, updated_at, department_code, division_code,
       notify_on_submission, permissions`;

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
    `SELECT r.${REVIEWER_COLUMNS}
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
    `SELECT ${REVIEWER_COLUMNS} FROM reviewers WHERE email = $1`,
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

import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { body, handleValidation } from '../middleware/validation.js';
import { pool } from '../db.js';
import {
  buildTokenPayload,
  clearAuthCookie,
  createSession,
  invalidateSession,
  loadCapabilities,
  requireAuth,
  reviewerAllowedPresets,
  reviewerSummary,
  setAuthCookie,
} from '../services/authService.js';
import {
  GoogleSignInResult,
  googleSignInEnabled,
  retireTemporaryPassword,
  resolveGoogleIdentity,
} from '../services/googleAuthService.js';
import { clearLoginAttempts, isAccountLocked, recordLoginAttempt } from '../services/loginAttempts.js';
import { notifyAdminsOfSignupRequest, sendMail } from '../services/mailService.js';
import { lowerEmail } from '../utils/helpers.js';
import { actorFrom, recordAudit } from '../services/auditService.js';
import {
  FRONTEND_BASE_URL,
  GOOGLE_CLIENT_ID,
  PASS_HASH_ROUNDS,
  PASSWORD_MIN_LENGTH,
  REPLY_TO,
  SIGNUP_APP_IDS,
  SIGNUP_APPS,
  SIGNUP_ROLES,
  WORKFLOW_GUIDE_TEXT,
} from '../config.js';

const router = express.Router();

// Every sign-in outcome goes to the audit log. A failure has no signed-in
// actor, so the address that was tried is recorded as the actor's email.
function auditSignIn(req, action, { reviewer = null, email = null, method = 'password', reason = null } = {}) {
  return recordAudit({
    actor: { id: reviewer?.id ?? null, email: reviewer?.email ?? email, ip: req.ip },
    action,
    entityType: 'reviewer',
    entityId: reviewer?.id ?? null,
    metadata: { method, ...(reason ? { reason } : {}) },
  });
}

// ===== Authentication =====

router.post(
  '/signup',
  [
    body('email').isEmail(),
    body('name').isString().isLength({ min: 1, max: 100 }),
    body('password').isString().isLength({ min: PASSWORD_MIN_LENGTH, max: 128 })
      .withMessage(`Passwords must be at least ${PASSWORD_MIN_LENGTH} characters.`),
    body('department_code').optional({ nullable: true }).matches(/^\d{2}$/),
    body('requested_role').optional({ nullable: true }).isIn(SIGNUP_ROLES),
    body('requested_apps').optional().isArray(),
    body('requested_apps.*').isIn(SIGNUP_APP_IDS)
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const email = lowerEmail(req.body.email);
    const name = req.body.name.trim();
    const password = req.body.password;
    const departmentCode = req.body.department_code || null;
    const requestedRole = SIGNUP_ROLES.includes(req.body.requested_role) ? req.body.requested_role : 'user';
    const requestedApps = Array.isArray(req.body.requested_apps)
      ? [...new Set(req.body.requested_apps.filter((a) => SIGNUP_APP_IDS.includes(a)))]
      : [];
    const passwordHash = await bcrypt.hash(password, PASS_HASH_ROUNDS);
    try {
      const { rows: existingAccounts } = await pool.query(
        'SELECT id FROM reviewers WHERE email = $1',
        [email]
      );
      if (existingAccounts.length) {
        res.status(409).json({ message: 'An account with this email already exists.' });
        return;
      }

      const { rows: existingRequests } = await pool.query(
        'SELECT id, status FROM signup_requests WHERE email = $1',
        [email]
      );

      if (existingRequests.length) {
        const existing = existingRequests[0];
        if (existing.status === 'pending') {
          res.status(409).json({ message: 'A signup request is already pending for this email.' });
          return;
        }

        await pool.query(
          `UPDATE signup_requests
             SET name = $2,
                 password_hash = $3,
                 department_code = $4,
                 requested_role = $5,
                 requested_apps = $6,
                 status = 'pending',
                 created_at = NOW(),
                 reviewed_at = NULL,
                 reviewer_id = NULL,
                 review_comment = NULL
           WHERE email = $1`,
          [email, name, passwordHash, departmentCode, requestedRole, requestedApps]
        );
        notifyAdminsOfSignupRequest({ email, name, departmentCode, requestedRole }).catch((err) => {
          console.error('Failed to notify admins of signup request', err);
        });
        res.status(200).json({ message: 'Signup request resubmitted. Await admin approval.' });
        return;
      }

      await pool.query(
        `INSERT INTO signup_requests (email, name, password_hash, department_code, requested_role, requested_apps)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [email, name, passwordHash, departmentCode, requestedRole, requestedApps]
      );
      notifyAdminsOfSignupRequest({ email, name, departmentCode, requestedRole }).catch((err) => {
        console.error('Failed to notify admins of signup request', err);
      });
      res.status(201).json({ message: 'Signup request submitted. Await admin approval.' });
    } catch (err) {
      console.error('Failed to submit signup request', err);
      res.status(500).json({ message: 'Unable to submit signup request.' });
    }
  }
);
// Public: lets the login page decide whether to render the Google button.
// OAuth client IDs are public by design; no secret is exposed here.
router.get('/config', (_req, res) => {
  res.json({
    google_enabled: googleSignInEnabled,
    google_client_id: GOOGLE_CLIENT_ID,
    signup_apps: SIGNUP_APPS.map(({ id, label }) => ({ id, label })),
  });
});

// Compared against when the account does not exist, to take the same time.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), PASS_HASH_ROUNDS);

router.post(
  '/login',
  [
    body('email').isEmail(),
    body('password').isString().isLength({ min: 1, max: 128 })
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const email = lowerEmail(req.body.email);
    const password = req.body.password;
    const clientIp = req.ip;

    // Per-account database lockout: survives container restarts and keys by
    // email rather than IP, so shared gateways do not lock out other staff.
    if (await isAccountLocked(email)) {
      console.warn(`[login] account locked due to failed attempts: ${email} from ${clientIp}`);
      await auditSignIn(req, 'login.failure', { email, reason: 'locked' });
      res.status(429).json({ message: 'Too many failed login attempts for this account. Please try again later.' });
      return;
    }

    console.info(`[login] attempt for ${email} from ${clientIp}`);

    const { rows } = await pool.query(
      `SELECT id, email, display_name, role, status, password_hash, must_change_password,
              last_login_at, created_at, updated_at, department_code, division_code, notify_on_submission,
              permissions
         FROM reviewers WHERE email = $1`,
      [email]
    );
    // Unknown, inactive and wrong-password all cost one bcrypt comparison and
    // get the same answer, so a caller cannot tell which accounts exist.
    const reviewer = rows[0];
    const valid = await bcrypt.compare(password, reviewer?.password_hash || DUMMY_PASSWORD_HASH);
    if (!reviewer || !valid) {
      await recordLoginAttempt(email, clientIp, false);
      console.warn(`[login] ${reviewer ? 'wrong password' : 'unknown email'}: ${email} from ${clientIp}`);
      await auditSignIn(req, 'login.failure', { email, reason: reviewer ? 'wrong_password' : 'unknown_account' });
      res.status(401).json({ message: 'Invalid credentials.' });
      return;
    }
    if (reviewer.status !== 'active') {
      console.warn(`[login] inactive account: ${email} from ${clientIp}`);
      await auditSignIn(req, 'login.failure', { email, reason: 'inactive' });
      res.status(403).json({ message: 'Account inactive.' });
      return;
    }

    await clearLoginAttempts(email);
    const { tokenId, expiresAt } = await createSession(reviewer.id);
    await pool.query('UPDATE reviewers SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1', [reviewer.id]);
    const token = buildTokenPayload(reviewer, tokenId, expiresAt);
    console.info(`[login] success: ${email} (${reviewer.role}) from ${clientIp}, session expires ${expiresAt.toISOString()}`);
    await auditSignIn(req, 'login.success', { reviewer });
    const expiresIso = expiresAt.toISOString();
    const allowedPresets = await reviewerAllowedPresets(reviewer.id);
    const payload = { ...reviewerSummary(reviewer, allowedPresets, await loadCapabilities(reviewer.id)), session_expires_at: expiresIso };
    setAuthCookie(res, token, expiresAt);
    res.json({ token, expires_at: expiresIso, reviewer: payload });
  }
);

// Google sign-in. Issues exactly the same session as password login; the
// difference is only how the account is established.
router.post(
  '/google',
  [body('credential').isString().isLength({ min: 1, max: 4096 })],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const clientIp = req.ip;
    const { result, reviewer } = await resolveGoogleIdentity(req.body.credential, { ip: clientIp });

    if (result !== GoogleSignInResult.OK) {
      const responses = {
        [GoogleSignInResult.DISABLED]: [503, 'Google sign-in is not configured.'],
        [GoogleSignInResult.BAD_TOKEN]: [401, 'Could not verify your Google account.'],
        [GoogleSignInResult.EMAIL_UNVERIFIED]: [403, 'Your Google email address is not verified.'],
        [GoogleSignInResult.NO_ACCOUNT]: [403, 'No portal access for this Google account. Contact your administrator.'],
        [GoogleSignInResult.INACTIVE]: [403, 'Account inactive.'],
      };
      const [status, message] = responses[result] ?? [401, 'Sign-in failed.'];
      if (result !== GoogleSignInResult.DISABLED) {
        await auditSignIn(req, 'login.failure', { reviewer, method: 'google', reason: String(result) });
      }
      res.status(status).json({ message });
      return;
    }

    await clearLoginAttempts(reviewer.email);
    // Proving who you are through Google settles a pending temporary
    // password: the flag it set is cleared and the password itself retired,
    // so the account is Google-only from here. Done before the session is
    // built, because the session carries the flag.
    if (await retireTemporaryPassword(reviewer, { ip: clientIp })) {
      reviewer.must_change_password = false;
    }
    const { tokenId, expiresAt } = await createSession(reviewer.id);
    await pool.query('UPDATE reviewers SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1', [reviewer.id]);
    const token = buildTokenPayload(reviewer, tokenId, expiresAt);
    console.info(`[login] google success: ${reviewer.email} (${reviewer.role}) from ${clientIp}`);
    await auditSignIn(req, 'login.success', { reviewer, method: 'google' });
    const expiresIso = expiresAt.toISOString();
    const allowedPresets = await reviewerAllowedPresets(reviewer.id);
    const payload = { ...reviewerSummary(reviewer, allowedPresets, await loadCapabilities(reviewer.id)), session_expires_at: expiresIso };
    setAuthCookie(res, token, expiresAt);
    res.json({ token, expires_at: expiresIso, reviewer: payload });
  }
);

router.post('/logout', requireAuth(), async (req, res) => {
  await invalidateSession(req.user?.tokenId);
  await recordAudit({ actor: actorFrom(req), action: 'logout', entityType: 'reviewer', entityId: req.user?.id });
  clearAuthCookie(res);
  res.status(204).send();
});

router.get('/me', requireAuth(), async (req, res) => {
  res.json({ reviewer: req.user });
});

router.patch(
  '/me',
  requireAuth(),
  [
    body('display_name').optional({ nullable: true }).isString().isLength({ min: 0, max: 200 })
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const reviewerId = req.user.id;
    const patch = {};
    if (req.body.display_name !== undefined) {
      patch.display_name = req.body.display_name === null ? null : (req.body.display_name?.trim() || null);
    }

    const fields = [];
    const values = [];
    Object.entries(patch).forEach(([key, value]) => {
      if (value === undefined) return;
      values.push(value);
      fields.push(`${key} = $${values.length}`);
    });
    if (!fields.length) {
      res.status(400).json({ message: 'No fields to update.' });
      return;
    }
    fields.push('updated_at = NOW()');
    values.push(reviewerId);
    const { rows } = await pool.query(
      `UPDATE reviewers SET ${fields.join(', ')} WHERE id = $${values.length}
       RETURNING id, email, display_name, role, status, must_change_password, last_login_at, created_at, updated_at,
                 department_code, division_code, notify_on_submission`,
      values
    );
    const allowedPresets = await reviewerAllowedPresets(rows[0].id);
    res.json({ reviewer: reviewerSummary(rows[0], allowedPresets, await loadCapabilities(rows[0].id)) });
  }
);

router.post('/refresh', requireAuth(), async (req, res) => {
  const reviewerId = req.user.id;
  await invalidateSession(req.user.tokenId);
  const { rows } = await pool.query(
    `SELECT id, email, display_name, role, status, must_change_password, last_login_at, created_at, updated_at,
            department_code, division_code, notify_on_submission,
            permissions
       FROM reviewers WHERE id = $1`,
    [reviewerId]
  );
  if (!rows.length) {
    res.status(404).json({ message: 'Account not found.' });
    return;
  }
  const reviewer = rows[0];
  if (reviewer.status !== 'active') {
    res.status(403).json({ message: 'Account inactive.' });
    return;
  }
  const { tokenId, expiresAt } = await createSession(reviewer.id);
  const token = buildTokenPayload(reviewer, tokenId, expiresAt);
  const expiresIso = expiresAt.toISOString();
  const allowedPresets = await reviewerAllowedPresets(reviewer.id);
  setAuthCookie(res, token, expiresAt);
  res.json({ token, expires_at: expiresIso, reviewer: { ...reviewerSummary(reviewer, allowedPresets, await loadCapabilities(reviewer.id)), session_expires_at: expiresIso } });
});

router.post(
  '/change-password',
  requireAuth(),
  [
    body('current_password').isString().isLength({ min: 1 }),
    body('new_password').isString().isLength({ min: PASSWORD_MIN_LENGTH, max: 128 })
      .withMessage(`Passwords must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const reviewerId = req.user.id;
    const { current_password, new_password } = req.body;
    const { rows } = await pool.query('SELECT password_hash FROM reviewers WHERE id = $1', [reviewerId]);
    if (!rows.length) {
      res.status(404).json({ message: 'Account not found.' });
      return;
    }
    const currentHash = rows[0].password_hash;
    const matches = await bcrypt.compare(current_password, currentHash);
    if (!matches) {
      res.status(400).json({ message: 'Current password is incorrect.' });
      return;
    }
    const sameAsOld = await bcrypt.compare(new_password, currentHash);
    if (sameAsOld) {
      res.status(400).json({ message: 'Choose a password you have not used before.' });
      return;
    }
    const newHash = await bcrypt.hash(new_password, PASS_HASH_ROUNDS);
    await invalidateSession(req.user.tokenId);
    await pool.query('DELETE FROM reviewer_sessions WHERE reviewer_id = $1', [reviewerId]);
    await pool.query(
      'UPDATE reviewers SET password_hash = $1, must_change_password = FALSE, updated_at = NOW() WHERE id = $2',
      [newHash, reviewerId]
    );
    await recordAudit({
      actor: actorFrom(req),
      action: 'password.change',
      entityType: 'reviewer',
      entityId: reviewerId,
      metadata: { was_temporary: req.user.must_change_password === true },
    });
    const { rows: reviewerRows } = await pool.query(
      `SELECT id, email, display_name, role, status, must_change_password, last_login_at, created_at, updated_at,
              department_code, division_code, notify_on_submission,
              permissions
         FROM reviewers WHERE id = $1`,
      [reviewerId]
    );
    const reviewer = reviewerRows[0];
    const { tokenId, expiresAt } = await createSession(reviewerId);
    const token = buildTokenPayload(reviewer, tokenId, expiresAt);
    const expiresIso = expiresAt.toISOString();
    const allowedPresets = await reviewerAllowedPresets(reviewer.id);
    setAuthCookie(res, token, expiresAt);
    res.json({ token, expires_at: expiresIso, reviewer: { ...reviewerSummary(reviewer, allowedPresets, await loadCapabilities(reviewer.id)), session_expires_at: expiresIso } });
  }
);

// ===== Password Reset (Self-Service) =====
const sha256Hex = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

router.post(
  '/forgot-password',
  [body('email').isEmail()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const email = lowerEmail(req.body.email);
    
    // Always respond success to prevent email enumeration
    const successResponse = { message: 'If this email is associated with an account, you will receive password reset instructions.' };
    
    const { rows } = await pool.query('SELECT id, email, display_name, status FROM reviewers WHERE email = $1', [email]);
    if (!rows.length || rows[0].status !== 'active') {
      res.json(successResponse);
      return;
    }
    
    const user = rows[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    
    // Store reset token (replace existing if any)
    await pool.query(
      `INSERT INTO password_reset_tokens (reviewer_id, token, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (reviewer_id) DO UPDATE SET 
         token = EXCLUDED.token, 
         expires_at = EXCLUDED.expires_at, 
         created_at = NOW()`,
      // Stored hashed: a copy of the table cannot be used to reset anyone.
      [user.id, sha256Hex(resetToken), expiresAt]
    );
    await recordAudit({
      actor: { id: null, email, ip: req.ip },
      action: 'password.reset_requested',
      entityType: 'reviewer',
      entityId: user.id,
    });
    
    // Send reset email
    try {
      const resetUrl = `${FRONTEND_BASE_URL}#reset-password=${resetToken}`;
      await sendMail({
        to: email,
        replyTo: REPLY_TO,
        subject: 'Reset your Naoero Treasury account password',
        text: `Hello ${user.display_name || 'User'},

You requested a password reset for your Naoero Treasury account.

Click the link below to reset your password:
${resetUrl}

This link will expire in 1 hour.

If you did not request this reset, please ignore this email.

${WORKFLOW_GUIDE_TEXT}
`
      });
    } catch (err) {
      console.error('Failed to send password reset email', err);
    }
    
    res.json(successResponse);
  }
);

router.post(
  '/reset-password',
  [
    body('token').isString().isLength({ min: 1 }),
    body('new_password').isString().isLength({ min: PASSWORD_MIN_LENGTH, max: 128 })
      .withMessage(`Passwords must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { token, new_password } = req.body;
    
    const { rows } = await pool.query(
      `SELECT prt.reviewer_id, prt.expires_at, r.email, r.display_name, r.status
       FROM password_reset_tokens prt
       JOIN reviewers r ON r.id = prt.reviewer_id
       WHERE prt.token = $1 AND prt.expires_at > NOW()`,
      [sha256Hex(token)]
    );
    
    if (!rows.length) {
      res.status(400).json({ message: 'Invalid or expired reset token.' });
      return;
    }
    
    const { reviewer_id, email, display_name, status } = rows[0];
    
    if (status !== 'active') {
      res.status(403).json({ message: 'Account is inactive.' });
      return;
    }
    
    // Update password
    const newHash = await bcrypt.hash(new_password, PASS_HASH_ROUNDS);
    await pool.query(
      'UPDATE reviewers SET password_hash = $1, must_change_password = FALSE, updated_at = NOW() WHERE id = $2',
      [newHash, reviewer_id]
    );
    
    // Clean up reset token and sessions
    await pool.query('DELETE FROM password_reset_tokens WHERE reviewer_id = $1', [reviewer_id]);
    await pool.query('DELETE FROM reviewer_sessions WHERE reviewer_id = $1', [reviewer_id]);
    await recordAudit({
      actor: { id: null, email, ip: req.ip },
      action: 'password.reset',
      entityType: 'reviewer',
      entityId: reviewer_id,
    });
    
    res.json({ message: 'Password reset successful. You can now sign in with your new password.' });
  }
);

export default router;

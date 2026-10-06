import express from 'express';
import bcrypt from 'bcryptjs';
import { body, param, handleValidation } from '../middleware/validation.js';
import { pool } from '../db.js';
import {
  generateTempPassword,
  loadCapabilities,
  requireAuth,
  reviewerAllowedPresets,
  reviewerSummary,
  setCapabilities,
} from '../services/authService.js';
import { recordAudit } from '../services/auditService.js';
import { clearLoginAttempts } from '../services/loginAttempts.js';
import {
  encryptSmtpPass,
  mailTransport,
  refreshTestingModeSetting,
  reloadMailTransport,
  sendMail,
  sendReviewerPasswordResetEmail,
  sendReviewerWelcomeEmail,
} from '../services/mailService.js';
import { lowerEmail } from '../utils/helpers.js';
import {
  ACCOUNT_ROLES,
  ACCOUNT_STATUSES,
  ALL_CAPABILITIES,
  BANK_PRESET_KEYS,
  CAPABILITY_CATALOGUE,
  FRONTEND_BASE_URL,
  PASS_HASH_ROUNDS,
  PASSWORD_MIN_LENGTH,
  REPLY_TO,
  ROLE_CAPABILITIES,
  SIGNUP_APP_IDS,
  SIGNUP_ROLES,
  SMTP_FROM,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  WORKFLOW_GUIDE_TEXT,
  capabilitiesForApps,
} from '../config.js';

const router = express.Router();

function defaultPermissionsForRole(role) {
  switch (role) {
    case 'user':
      return { submit_aba: true, submit_forex_tt: true };
    case 'reviewer':
      return {
        review_aba: true,
        review_forex_tt: true,
        notify_aba_submissions: true,
        notify_forex_tt_submissions: true,
        public_health_review: true,
      };
    case 'public_health':
      return { public_health_manage: true };
    case 'admin':
      return {
        admin: true,
        submit_aba: true,
        review_aba: true,
        notify_aba_submissions: true,
        submit_forex_tt: true,
        review_forex_tt: true,
        notify_forex_tt_submissions: true,
        public_health_manage: true,
        public_health_review: true,
      };
    default:
      return {};
  }
}

// ===== Signup Request =====
// List pending signup requests (admin only)
router.get('/admin/signup-requests', requireAuth(['admin']), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT sr.id,
            sr.email,
            sr.name,
            sr.department_code,
            sr.requested_role,
            sr.status,
            sr.created_at,
            sr.reviewed_at,
            sr.reviewer_id,
            sr.review_comment,
            rv.display_name AS reviewer_name,
            rv.email       AS reviewer_email
       FROM signup_requests sr
       LEFT JOIN reviewers rv ON rv.id = sr.reviewer_id
      ORDER BY sr.created_at DESC`
  );
  res.json(rows);
});

// Approve signup request (admin only). The admin may override the requested role
// by passing `role` in the body (e.g. correcting a wrong app selection).
router.post('/admin/signup-requests/:id/approve', requireAuth(['admin']), async (req, res) => {
  const requestId = req.params.id;
  const reviewerId = req.user.id;
  const { review_comment } = req.body || {};
  // Get request
  const { rows } = await pool.query('SELECT * FROM signup_requests WHERE id = $1', [requestId]);
  if (!rows.length) return res.status(404).json({ message: 'Signup request not found.' });
  const reqData = rows[0];
  if (reqData.status !== 'pending') return res.status(400).json({ message: 'Request already processed.' });

  const requestedRole = req.body.role || reqData.requested_role || 'user';
  if (!SIGNUP_ROLES.includes(requestedRole) && requestedRole !== 'admin') {
    return res.status(400).json({ message: 'Invalid role.' });
  }
  const permissions = defaultPermissionsForRole(requestedRole);

  // Apps the person asked for, unless the admin overrode the selection.
  const approvedApps = Array.isArray(req.body.apps)
    ? req.body.apps.filter((a) => SIGNUP_APP_IDS.includes(a))
    : (reqData.requested_apps || []);

  // Create reviewer account
  try {
    const { rows: created } = await pool.query(
      `INSERT INTO reviewers (email, display_name, role, status, password_hash, must_change_password, department_code, permissions)
       VALUES ($1, $2, $3, 'active', $4, FALSE, $5, $6) RETURNING id`,
      [reqData.email, reqData.name, requestedRole, reqData.password_hash, reqData.department_code, JSON.stringify(permissions)]
    );
    const capabilities = new Set([
      ...(ROLE_CAPABILITIES[requestedRole] ?? []),
      ...capabilitiesForApps(approvedApps),
    ]);
    await setCapabilities(created[0].id, [...capabilities], reviewerId);
    await pool.query(
      `UPDATE signup_requests SET status = 'approved', reviewed_at = NOW(), reviewer_id = $1, review_comment = $2, requested_role = $3 WHERE id = $4`,
      [reviewerId, review_comment || null, requestedRole, requestId]
    );
    // Send email to user
    await sendMail({
      to: reqData.email,
      subject: 'Your Naoero Treasury account is approved',
      text: `Hello ${reqData.name},\n\nYour account request has been approved. You may now sign in at ${FRONTEND_BASE_URL} using your email and password.\n\n${WORKFLOW_GUIDE_TEXT}\n\nIf you have questions, reply to this email.`
    });
    res.json({ message: 'Signup request approved and user notified.' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Account with this email already exists.' });
    }
    console.error('Failed to approve signup request', err);
    res.status(500).json({ message: 'Unable to approve signup request.' });
  }
});

// Reject signup request (admin only)
router.post('/admin/signup-requests/:id/reject', requireAuth(['admin']), async (req, res) => {
  const requestId = req.params.id;
  const reviewerId = req.user.id;
  const { review_comment } = req.body || {};
  const { rows } = await pool.query('SELECT * FROM signup_requests WHERE id = $1', [requestId]);
  if (!rows.length) return res.status(404).json({ message: 'Signup request not found.' });
  const reqData = rows[0];
  if (reqData.status !== 'pending') return res.status(400).json({ message: 'Request already processed.' });
  await pool.query(
    `UPDATE signup_requests SET status = 'rejected', reviewed_at = NOW(), reviewer_id = $1, review_comment = $2 WHERE id = $3`,
    [reviewerId, review_comment || null, requestId]
  );
  // Optionally notify user of rejection
  await sendMail({
    to: reqData.email,
    subject: 'Your Naoero Treasury account request was rejected',
    text: `Hello ${reqData.name},\n\nYour account request was not approved. Reason: ${review_comment || 'No reason provided.'}\n\nIf you have questions, reply to this email.`
  });
  res.json({ message: 'Signup request rejected.' });
});

// ===== Account management (admin) =====

// ===== Department Profiles =====
router.get('/department-profiles/active', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, department_code, division_code, name
         FROM department_profiles
        ORDER BY department_code, division_code`
    );
    res.json(rows.map((row) => ({
      ...row,
      division_code: row.division_code || '00',
    })));
  } catch (err) {
    console.error('Failed to load active department profiles', err);
    res.status(500).json({ message: 'Unable to load department profiles.' });
  }
});

router.get('/department-profiles', requireAuth(['admin']), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, department_code, division_code, name, allowed_bank_presets, created_at, updated_at
         FROM department_profiles
        ORDER BY department_code, division_code`
    );
    res.json(rows.map((row) => ({
      ...row,
      division_code: row.division_code || '00',
      allowed_bank_presets: Array.isArray(row.allowed_bank_presets) ? row.allowed_bank_presets : [],
    })));
  } catch (err) {
    console.error('Failed to load department profiles', err);
    res.status(500).json({ message: 'Unable to load department profiles.' });
  }
});

router.post(
  '/department-profiles',
  requireAuth(['admin']),
  [
    body('department_code').isString().trim().matches(/^\d{2}$/),
    body('division_code').optional({ nullable: true }).isString().trim().matches(/^\d{2}$/),
    body('name').isString().trim().isLength({ min: 1, max: 200 }),
    body('allowed_bank_presets').isArray({ min: 1, max: BANK_PRESET_KEYS.length }),
    body('allowed_bank_presets.*').isString().isIn(BANK_PRESET_KEYS),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const departmentCode = String(req.body.department_code).trim();
    const divisionCode = String(req.body.division_code || '00').trim() || '00';
    const name = String(req.body.name).trim();
    const presets = Array.from(new Set(req.body.allowed_bank_presets.filter((k) => BANK_PRESET_KEYS.includes(k))));
    try {
      const { rows } = await pool.query(
        `INSERT INTO department_profiles (department_code, division_code, name, allowed_bank_presets)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (department_code, division_code)
         DO UPDATE SET name = EXCLUDED.name,
                       allowed_bank_presets = EXCLUDED.allowed_bank_presets,
                       updated_at = NOW()
         RETURNING id, department_code, division_code, name, allowed_bank_presets, created_at, updated_at`,
        [departmentCode, divisionCode, name, presets]
      );
      res.status(201).json({ profile: rows[0] });
    } catch (err) {
      console.error('Failed to save department profile', err);
      res.status(500).json({ message: 'Unable to save department profile.' });
    }
  }
);

router.put(
  '/department-profiles/:id',
  requireAuth(['admin']),
  [
    param('id').isUUID(),
    body('department_code').optional().isString().trim().matches(/^\d{2}$/),
    body('division_code').optional({ nullable: true }).isString().trim().matches(/^\d{2}$/),
    body('name').optional().isString().trim().isLength({ min: 1, max: 200 }),
    body('allowed_bank_presets').optional().isArray({ min: 1, max: BANK_PRESET_KEYS.length }),
    body('allowed_bank_presets.*').optional().isString().isIn(BANK_PRESET_KEYS),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const id = req.params.id;
    const patch = {};
    if (req.body.department_code !== undefined) patch.department_code = String(req.body.department_code).trim();
    if (req.body.division_code !== undefined) patch.division_code = String(req.body.division_code || '00').trim() || '00';
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body.allowed_bank_presets !== undefined) {
      patch.allowed_bank_presets = Array.from(new Set(req.body.allowed_bank_presets.filter((k) => BANK_PRESET_KEYS.includes(k))));
    }
    if (!Object.keys(patch).length) {
      res.status(400).json({ message: 'No fields to update.' });
      return;
    }
    const fields = [];
    const values = [];
    Object.entries(patch).forEach(([key, value]) => {
      values.push(value);
      fields.push(`${key} = $${values.length}`);
    });
    fields.push('updated_at = NOW()');
    values.push(id);
    try {
      const { rows } = await pool.query(
        `UPDATE department_profiles SET ${fields.join(', ')} WHERE id = $${values.length}
         RETURNING id, department_code, division_code, name, allowed_bank_presets, created_at, updated_at`,
        values
      );
      if (!rows.length) {
        res.status(404).json({ message: 'Department profile not found.' });
        return;
      }
      res.json({ profile: rows[0] });
    } catch (err) {
      if (err.code === '23505') {
        res.status(409).json({ message: 'A profile already exists for this department and division.' });
        return;
      }
      console.error('Failed to update department profile', err);
      res.status(500).json({ message: 'Unable to update department profile.' });
    }
  }
);

router.delete(
  '/department-profiles/:id',
  [requireAuth(['admin']), param('id').isUUID()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { rowCount } = await pool.query('DELETE FROM department_profiles WHERE id = $1', [req.params.id]);
    if (!rowCount) {
      res.status(404).json({ message: 'Department profile not found.' });
      return;
    }
    res.status(204).send();
  }
);

// ===== Account management (admin) =====
// Capability catalogue, so the admin UI renders its checkboxes from data
// rather than hardcoding them for each new app.
router.get('/capability-catalogue', requireAuth(['admin']), (_req, res) => {
  res.json({ groups: CAPABILITY_CATALOGUE, role_capabilities: ROLE_CAPABILITIES });
});

router.get('/reviewers', requireAuth(['admin']), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, email, display_name, role, status, must_change_password, last_login_at, created_at, updated_at,
            department_code, division_code, notify_on_submission, permissions, account_type
       FROM reviewers
      ORDER BY LOWER(COALESCE(NULLIF(display_name, ''), email)) ASC`
  );
  res.json(await Promise.all(rows.map(async (row) => reviewerSummary(row, await reviewerAllowedPresets(row.id), await loadCapabilities(row.id)))));
});

router.post(
  '/reviewers',
  requireAuth(['admin']),
  [
    body('email').isEmail(),
    body('display_name').optional({ nullable: true }).isString().isLength({ min: 0, max: 200 }),
    body('role').optional().isIn(ACCOUNT_ROLES),
    body('status').optional().isIn(ACCOUNT_STATUSES),
    body('password').optional().isString().isLength({ min: PASSWORD_MIN_LENGTH, max: 128 })
      .withMessage(`Passwords must be at least ${PASSWORD_MIN_LENGTH} characters.`),
    body('department_code').optional({ nullable: true }).matches(/^\d{2}$/),
    body('division_code').optional({ nullable: true }).matches(/^\d{2}$/),
    body('notify_on_submission').optional().isBoolean(),
    body('send_email').optional().isBoolean(),
    body('capabilities').optional().isArray(),
    body('capabilities.*').isIn(ALL_CAPABILITIES)
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const email = lowerEmail(req.body.email);
    const displayName = req.body.display_name?.trim() || null;
    const role = req.body.role || 'reviewer';
    const status = req.body.status || 'active';
    const departmentCode = req.body.department_code ? String(req.body.department_code).trim() : null;
    const divisionCodeRaw = req.body.division_code ? String(req.body.division_code).trim() : null;
    const divisionCode = divisionCodeRaw || '00';
    if (role === 'user' && !departmentCode) {
      res.status(400).json({ message: 'Department Head is required for user accounts.' });
      return;
    }
    let notifyOnSubmission;
    if (role === 'reviewer') {
      if (req.body.notify_on_submission === undefined || req.body.notify_on_submission === null) {
        notifyOnSubmission = true;
      } else {
        notifyOnSubmission = req.body.notify_on_submission === true;
      }
    } else if (role === 'admin') {
      notifyOnSubmission = req.body.notify_on_submission === true;
    } else {
      notifyOnSubmission = false;
    }
    let permissions = {};
    if (req.body.permissions !== undefined) {
      if (req.body.permissions !== null && (typeof req.body.permissions !== 'object' || Array.isArray(req.body.permissions))) {
        res.status(400).json({ message: 'permissions must be an object.' });
        return;
      }
      permissions = req.body.permissions || {};
    }
    let password = req.body.password || '';
    let generated = false;
    if (!password) {
      password = generateTempPassword();
      generated = true;
    }
    const passwordHash = await bcrypt.hash(password, PASS_HASH_ROUNDS);
    try {
      const { rows } = await pool.query(
        `INSERT INTO reviewers (email, display_name, role, status, password_hash, must_change_password, department_code, division_code, notify_on_submission, permissions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         RETURNING id, email, display_name, role, status, must_change_password, last_login_at, created_at, updated_at,
                   department_code, division_code, notify_on_submission, permissions, account_type`,
        [email, displayName, role, status, passwordHash, true, departmentCode, divisionCode, notifyOnSubmission, permissions]
      );
      const reviewer = rows[0];
      const sendEmail = req.body.send_email === true;
      if (sendEmail) {
        try {
          await sendReviewerWelcomeEmail(reviewer, password);
        } catch (err) {
          console.error('Failed to send reviewer welcome email', err);
        }
      }
      if (req.body.capabilities !== undefined) {
        await setCapabilities(reviewer.id, req.body.capabilities, req.user.id);
        await recordAudit({
          actor: { id: req.user.id, email: req.user.email, ip: req.ip },
          action: 'reviewer.capabilities.set',
          entityType: 'reviewer',
          entityId: reviewer.id,
          after: { capabilities: req.body.capabilities },
        });
      }
      const allowedPresets = await reviewerAllowedPresets(reviewer.id);
      res.status(201).json({ reviewer: reviewerSummary(reviewer, allowedPresets, await loadCapabilities(reviewer.id)), temporary_password: generated ? password : undefined });
    } catch (err) {
      if (err.code === '23505') {
        res.status(409).json({ message: 'Account with this email already exists.' });
        return;
      }
      console.error('Failed to create account', err);
      res.status(500).json({ message: 'Unable to create account.' });
    }
  }
);

router.put(
  '/reviewers/:id',
  requireAuth(['admin']),
  [
    param('id').isUUID(),
    body('display_name').optional({ nullable: true }).isString().isLength({ min: 0, max: 200 }),
    body('role').optional().isIn(ACCOUNT_ROLES),
    body('status').optional().isIn(ACCOUNT_STATUSES),
    body('department_code').optional({ nullable: true }).matches(/^\d{2}$/),
    body('division_code').optional({ nullable: true }).matches(/^\d{2}$/),
    body('notify_on_submission').optional().isBoolean(),
    body('permissions').optional().custom((value) => {
      if (value === null) return true;
      if (value && typeof value === 'object' && !Array.isArray(value)) return true;
      throw new Error('permissions must be an object.');
    }),
    body('capabilities').optional().isArray(),
    body('capabilities.*').isIn(ALL_CAPABILITIES)
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const reviewerId = req.params.id;
    const { rows: existingRows } = await pool.query(
      `SELECT id, role, department_code, division_code, notify_on_submission, permissions, account_type FROM reviewers WHERE id = $1`,
      [reviewerId]
    );
    if (!existingRows.length) {
      res.status(404).json({ message: 'Account not found.' });
      return;
    }
    const existing = existingRows[0];
    if (existing.account_type === 'employee' && req.body.role && req.body.role !== 'user') {
      res.status(400).json({ message: 'Employee-only accounts use explicit Leave grants. Keep the user role.' });
      return;
    }
    const patch = {};
    if (req.body.display_name !== undefined) {
      patch.display_name = req.body.display_name === null ? null : (req.body.display_name?.trim() || null);
    }
    if (req.body.role !== undefined) {
      patch.role = req.body.role;
    }
    if (req.body.status !== undefined) {
      patch.status = req.body.status;
    }
    if (req.body.department_code !== undefined) {
      const dept = req.body.department_code ? String(req.body.department_code).trim() : null;
      patch.department_code = dept || null;
    }
    if (req.body.division_code !== undefined) {
      patch.division_code = req.body.division_code ? String(req.body.division_code).trim() : '00';
    }
    if (req.body.notify_on_submission !== undefined) {
      patch.notify_on_submission = req.body.notify_on_submission === true;
    }
    if (req.body.permissions !== undefined) {
      if (req.body.permissions !== null && (typeof req.body.permissions !== 'object' || Array.isArray(req.body.permissions))) {
        res.status(400).json({ message: 'permissions must be an object.' });
        return;
      }
      patch.permissions = req.body.permissions === null ? null : req.body.permissions;
    }

    const finalRole = patch.role ?? existing.role;
    const finalDept = Object.prototype.hasOwnProperty.call(patch, 'department_code')
      ? patch.department_code
      : existing.department_code;
    if (finalRole === 'user' && !finalDept) {
      res.status(400).json({ message: 'Department Head is required for user accounts.' });
      return;
    }
    if (!['reviewer', 'admin'].includes(finalRole)) {
      patch.notify_on_submission = false;
    }

    const finalDivision = Object.prototype.hasOwnProperty.call(patch, 'division_code')
      ? patch.division_code
      : (existing.division_code || '00');
    patch.division_code = finalDivision;

    const fields = [];
    const values = [];
    Object.entries(patch).forEach(([key, value]) => {
      if (value === undefined) return;
      if (key === 'permissions') {
        values.push(value === null ? null : JSON.stringify(value));
        fields.push(`${key} = $${values.length}::jsonb`);
      } else {
        values.push(value);
        fields.push(`${key} = $${values.length}`);
      }
    });
    if (!fields.length && req.body.capabilities === undefined) {
      res.status(400).json({ message: 'No fields to update.' });
      return;
    }

    let rows;
    if (fields.length) {
      fields.push('updated_at = NOW()');
      values.push(reviewerId);
      ({ rows } = await pool.query(
        `UPDATE reviewers SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING id, email, display_name, role, status, last_login_at, created_at, updated_at,
          must_change_password, department_code, division_code, notify_on_submission, permissions, account_type`,
        values
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT id, email, display_name, role, status, last_login_at, created_at, updated_at,
          must_change_password, department_code, division_code, notify_on_submission, permissions, account_type
         FROM reviewers WHERE id = $1`,
        [reviewerId]
      ));
    }

    if (req.body.capabilities !== undefined) {
      await setCapabilities(reviewerId, req.body.capabilities, req.user.id);
      await recordAudit({
        actor: { id: req.user.id, email: req.user.email, ip: req.ip },
        action: 'reviewer.capabilities.set',
        entityType: 'reviewer',
        entityId: reviewerId,
        after: { capabilities: req.body.capabilities },
      });
    }

    const allowedPresets = await reviewerAllowedPresets(rows[0].id);
    res.json({ reviewer: reviewerSummary(rows[0], allowedPresets, await loadCapabilities(rows[0].id)) });
  }
);

router.post(
  '/reviewers/:id/reset-password',
  requireAuth(['admin']),
  [
    param('id').isUUID(),
    body('new_password').optional({ nullable: true }).isString().isLength({ min: PASSWORD_MIN_LENGTH, max: 128 })
      .withMessage(`Passwords must be at least ${PASSWORD_MIN_LENGTH} characters.`),
    body('send_email').optional().isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const reviewerId = req.params.id;
    const { rows } = await pool.query(
      `SELECT id, email, display_name, role, status, must_change_password, last_login_at, created_at, updated_at,
              department_code, division_code, notify_on_submission, permissions, account_type
         FROM reviewers WHERE id = $1`,
      [reviewerId]
    );
    if (!rows.length) {
      res.status(404).json({ message: 'Account not found.' });
      return;
    }
    const reviewer = rows[0];
    let password = req.body.new_password || '';
    let generated = false;
    if (!password) {
      password = generateTempPassword();
      generated = true;
    }
    const hash = await bcrypt.hash(password, PASS_HASH_ROUNDS);
    await pool.query('UPDATE reviewers SET password_hash = $1, must_change_password = TRUE, updated_at = NOW() WHERE id = $2', [hash, reviewerId]);
    await clearLoginAttempts(reviewer.email);
    await pool.query('DELETE FROM reviewer_sessions WHERE reviewer_id = $1', [reviewerId]);
    reviewer.must_change_password = true;
    const sendEmail = req.body.send_email === true;
    if (sendEmail) {
      try {
        await sendReviewerPasswordResetEmail(reviewer, password);
      } catch (err) {
        console.error('Failed to send reset email', err);
      }
    }
    const allowedPresets = await reviewerAllowedPresets(reviewer.id);
    res.json({ reviewer: reviewerSummary(reviewer, allowedPresets, await loadCapabilities(reviewer.id)), temporary_password: generated ? password : undefined });
  }
);

router.delete(
  '/reviewers/:id',
  requireAuth(['admin']),
  [param('id').isUUID()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const targetId = req.params.id;
    if (targetId === req.user.id) {
      res.status(400).json({ message: 'You cannot delete your own account.' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: targetRows } = await client.query(
        'SELECT id, role FROM reviewers WHERE id = $1',
        [targetId]
      );
      if (!targetRows.length) {
        await client.query('ROLLBACK');
        res.status(404).json({ message: 'Account not found.' });
        return;
      }
      const target = targetRows[0];
      if (target.role === 'admin') {
        const { rows: adminCountRows } = await client.query(
          "SELECT COUNT(*) AS count FROM reviewers WHERE role = 'admin'"
        );
        const adminCount = Number(adminCountRows[0]?.count ?? 0);
        if (adminCount <= 1) {
          await client.query('ROLLBACK');
          res.status(400).json({ message: 'At least one admin account must remain.' });
          return;
        }
      }

      await client.query('UPDATE batch_archives SET submitted_by = NULL WHERE submitted_by = $1', [targetId]);
      await client.query('UPDATE batch_reviews SET actor_id = NULL WHERE actor_id = $1', [targetId]);
      await client.query('UPDATE signup_requests SET reviewer_id = NULL WHERE reviewer_id = $1', [targetId]);
      await client.query('DELETE FROM reviewers WHERE id = $1', [targetId]);
      await client.query('COMMIT');
      res.status(204).send();
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Failed to delete reviewer', err);
      res.status(500).json({ message: 'Unable to delete account.' });
    } finally {
      client.release();
    }
  }
);

router.get('/admin/testing-mode', requireAuth(['admin']), async (_req, res) => {
  try {
    const state = await refreshTestingModeSetting();
    res.json(state);
  } catch (err) {
    res.status(500).json({ message: 'Unable to load testing mode setting.' });
  }
});

router.post(
  '/admin/testing-mode',
  [requireAuth(['admin']), body('enabled').isBoolean()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const enabled = !!req.body.enabled;
    const actorId = req.user?.id || null;
    try {
      await pool.query(
        `INSERT INTO reviewer_settings (id, testing_mode, testing_mode_set_at, testing_mode_set_by, updated_at)
         VALUES (TRUE, $1, NOW(), $2, NOW())
         ON CONFLICT (id) DO UPDATE
           SET testing_mode = EXCLUDED.testing_mode,
               testing_mode_set_at = EXCLUDED.testing_mode_set_at,
               testing_mode_set_by = EXCLUDED.testing_mode_set_by,
               updated_at = NOW()`,
        [enabled, actorId]
      );
      const state = await refreshTestingModeSetting();
      res.json(state);
    } catch (err) {
      console.error('Failed to update testing mode setting', err);
      res.status(500).json({ message: 'Unable to update testing mode.' });
    }
  }
);

// ========== SMTP SETTINGS ENDPOINTS ==========

// Get current SMTP settings (password masked)
router.get('/admin/smtp-settings', requireAuth(['admin']), async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT smtp_host, smtp_port, smtp_secure, smtp_user, from_email, reply_to_email, support_email, updated_at
      FROM smtp_settings WHERE id = TRUE
    `);
    
    if (rows.length > 0) {
      res.json({ ...rows[0], configured: true, source: 'database' });
    } else {
      // Return environment variable defaults
      res.json({
        configured: !!SMTP_HOST,
        source: 'environment',
        smtp_host: SMTP_HOST || '',
        smtp_port: SMTP_PORT,
        smtp_secure: SMTP_SECURE,
        smtp_user: SMTP_USER || '',
        from_email: SMTP_FROM,
        reply_to_email: REPLY_TO || '',
        support_email: ''
      });
    }
  } catch (err) {
    console.error('Failed to load SMTP settings:', err);
    res.status(500).json({ message: 'Failed to load SMTP settings.' });
  }
});

// Update SMTP settings
router.post(
  '/admin/smtp-settings',
  [
    requireAuth(['admin']),
    body('smtp_host').isString().trim().notEmpty(),
    body('smtp_port').isInt({ min: 1, max: 65535 }),
    body('smtp_secure').isBoolean(),
    body('smtp_user').optional().isString().trim(),
    body('smtp_pass').optional().isString(),
    body('from_email').isEmail(),
    body('reply_to_email').optional().isEmail(),
    body('support_email').optional().isEmail()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    
    try {
      const { smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, from_email, reply_to_email, support_email } = req.body;
      const actorId = req.user?.id || null;
      
      // Encrypt the SMTP password at rest with AES-256-GCM (requires SMTP_ENC_KEY).
      // If SMTP_ENC_KEY is unset this degrades to legacy plaintext storage with a startup warning.
      const passEncrypted = smtp_pass ? encryptSmtpPass(smtp_pass) : null;
      
      await pool.query(`
        INSERT INTO smtp_settings (id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass_encrypted, from_email, reply_to_email, support_email, updated_at, updated_by)
        VALUES (TRUE, $1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
        ON CONFLICT (id) DO UPDATE SET
          smtp_host = EXCLUDED.smtp_host,
          smtp_port = EXCLUDED.smtp_port,
          smtp_secure = EXCLUDED.smtp_secure,
          smtp_user = EXCLUDED.smtp_user,
          smtp_pass_encrypted = CASE WHEN $5 IS NULL THEN smtp_settings.smtp_pass_encrypted ELSE EXCLUDED.smtp_pass_encrypted END,
          from_email = EXCLUDED.from_email,
          reply_to_email = EXCLUDED.reply_to_email,
          support_email = EXCLUDED.support_email,
          updated_at = NOW(),
          updated_by = EXCLUDED.updated_by
      `, [smtp_host, smtp_port, smtp_secure, smtp_user, passEncrypted, from_email, reply_to_email, support_email, actorId]);
      
      // Reload mail transport with new settings
      await reloadMailTransport();
      
      res.json({ message: 'SMTP settings updated successfully.' });
    } catch (err) {
      console.error('Failed to update SMTP settings:', err);
      res.status(500).json({ message: 'Failed to update SMTP settings.' });
    }
  }
);

// Test SMTP connection
router.post('/admin/smtp-settings/test', [
  requireAuth(['admin']),
  body('test_email').isEmail().normalizeEmail()
], async (req, res) => {
  if (!handleValidation(req, res)) return;
  try {
    if (!mailTransport) {
      res.status(400).json({ success: false, message: 'SMTP not configured.' });
      return;
    }
    
    // Verify connection
    await mailTransport.verify();
    
    const testEmail = req.body.test_email;
    await sendMail({
      to: testEmail,
      subject: 'Naoero Treasury Portal - SMTP Test',
      text: `This is a test email from the Naoero Treasury Portal.\n\nSent at: ${new Date().toISOString()}\n\nIf you receive this, your SMTP settings are working correctly.`
    });
    res.json({ success: true, message: `Test email sent to ${testEmail}` });
  } catch (err) {
    console.error('SMTP test failed:', err);
    res.status(400).json({ success: false, message: err.message || 'SMTP test failed.' });
  }
});

export default router;

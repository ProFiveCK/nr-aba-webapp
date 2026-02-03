import express from 'express';
import cors from 'cors';
import { body, param, query, validationResult } from 'express-validator';
import { pool, initSchema } from './db.js';
import dotenv from 'dotenv';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import OpenAI from 'openai';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const SESSION_MINUTES = Number(process.env.REVIEWER_SESSION_MINUTES || 480);
const PASS_HASH_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'http://localhost:8080';
const TEMP_PASSWORD_LENGTH = Number(process.env.REVIEWER_TEMP_PASSWORD_LENGTH || 12);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'no-reply@example.com';
const REPLY_TO = process.env.REPLY_TO_EMAIL;
const ACCOUNT_ROLES = ['user', 'banking', 'reviewer', 'admin'];
const REVIEW_ACCESS_ROLES = ['reviewer', 'admin'];
const ACCOUNT_STATUSES = ['active', 'inactive'];
const BSB_REGEX = /^[0-9]{3}-[0-9]{3}$/;
const ADMIN_ARCHIVE_LIMIT_DEFAULT = 100;
const REVIEWER_ARCHIVE_LIMIT_DEFAULT = 50;

// AI Helper Configuration
const AI_HELPER_ENABLED = process.env.AI_HELPER_ENABLED === 'true';
const AI_PROVIDER = process.env.AI_PROVIDER || 'ollama'; // 'openai', 'ollama', or 'github'
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://host.docker.internal:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama2';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_MODEL = process.env.GITHUB_MODEL || 'gpt-4o-mini';

let aiClient = null;
if (AI_HELPER_ENABLED) {
  if (AI_PROVIDER === 'openai' && OPENAI_API_KEY) {
    aiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
  } else if (AI_PROVIDER === 'github' && GITHUB_TOKEN) {
    aiClient = new OpenAI({ 
      baseURL: 'https://models.inference.ai.azure.com',
      apiKey: GITHUB_TOKEN
    });
  } else if (AI_PROVIDER === 'ollama') {
    aiClient = new OpenAI({ 
      baseURL: OLLAMA_BASE_URL + '/v1',
      apiKey: 'ollama' // Ollama doesn't need a real key
    });
  }
}

const ADMIN_ARCHIVE_LIMIT_MAX = 500;
const REVIEWER_ARCHIVE_LIMIT_MAX = 100;
const BLACKLIST_IMPORT_LIMIT = 1000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKFLOW_GUIDE_TEXT = `Workflow Guide:\n\n1. Level 1 users prepare an ABA file in the Generator, enter the PD#, add notes, and click Commit.\n2. Reviewers are notified by email, open the Reviewer tab, and approve or reject the batch.\n3. If rejected, the submitter fixes their copy (upload via Reader → Load) and resubmits.\n4. Once approved, reviewers/admins can download the ABA from the archive; admins can delete batches when finished.`;

// SFTP Sync Configuration
const SFTP_SYNC_METHOD = process.env.SFTP_SYNC_METHOD || 'database'; // 'direct', 'file', or 'database'
// Default to host.docker.internal for Docker containers (Windows/Mac), fallback to localhost for Linux native
const WINDOWS_SYNC_URL = process.env.WINDOWS_SYNC_URL || 'http://host.docker.internal:8088/sync-trigger';
const SYNC_TRIGGER_PATH = process.env.SYNC_TRIGGER_PATH || null; // For file-based approach
const SYNC_TIMEOUT = Number(process.env.SYNC_TIMEOUT || 30000); // 30 seconds

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

const app = express();
app.use(cors());
// Allow larger payloads for ABA uploads (base64 inflates size by ~33%)
app.use(express.json({ limit: '10mb' }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ===== Authentication =====
// ===== Signup Request =====
// List pending signup requests (admin only)
app.get('/api/admin/signup-requests', requireAuth(['admin']), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT sr.id,
            sr.email,
            sr.name,
            sr.department_code,
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

// Approve signup request (admin only)
app.post('/api/admin/signup-requests/:id/approve', requireAuth(['admin']), async (req, res) => {
  const requestId = req.params.id;
  const reviewerId = req.user.id;
  const { review_comment } = req.body || {};
  // Get request
  const { rows } = await pool.query('SELECT * FROM signup_requests WHERE id = $1', [requestId]);
  if (!rows.length) return res.status(404).json({ message: 'Signup request not found.' });
  const reqData = rows[0];
  if (reqData.status !== 'pending') return res.status(400).json({ message: 'Request already processed.' });
  // Create reviewer account
  try {
    await pool.query(
      `INSERT INTO reviewers (email, display_name, role, status, password_hash, must_change_password, department_code)
       VALUES ($1, $2, 'user', 'active', $3, FALSE, $4)`,
      [reqData.email, reqData.name, reqData.password_hash, reqData.department_code]
    );
    await pool.query(
      `UPDATE signup_requests SET status = 'approved', reviewed_at = NOW(), reviewer_id = $1, review_comment = $2 WHERE id = $3`,
      [reviewerId, review_comment || null, requestId]
    );
    // Send email to user
    await sendMail({
      to: reqData.email,
      subject: 'Your Nauru Treasury account is approved',
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
app.post('/api/admin/signup-requests/:id/reject', requireAuth(['admin']), async (req, res) => {
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
    subject: 'Your Nauru Treasury account request was rejected',
    text: `Hello ${reqData.name},\n\nYour account request was not approved. Reason: ${review_comment || 'No reason provided.'}\n\nIf you have questions, reply to this email.`
  });
  res.json({ message: 'Signup request rejected.' });
});
app.post(
  '/api/auth/signup',
  [
    body('email').isEmail(),
    body('name').isString().isLength({ min: 1, max: 100 }),
    body('password').isString().isLength({ min: 6, max: 128 }),
    body('department_code').optional({ nullable: true }).matches(/^\d{2}$/)
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const email = lowerEmail(req.body.email);
    const name = req.body.name.trim();
    const password = req.body.password;
    const departmentCode = req.body.department_code || null;
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
                 status = 'pending',
                 created_at = NOW(),
                 reviewed_at = NULL,
                 reviewer_id = NULL,
                 review_comment = NULL
           WHERE email = $1`,
          [email, name, passwordHash, departmentCode]
        );
        notifyAdminsOfSignupRequest({ email, name, departmentCode }).catch((err) => {
          console.error('Failed to notify admins of signup request', err);
        });
        res.status(200).json({ message: 'Signup request resubmitted. Await admin approval.' });
        return;
      }

      await pool.query(
        `INSERT INTO signup_requests (email, name, password_hash, department_code)
         VALUES ($1, $2, $3, $4)`,
        [email, name, passwordHash, departmentCode]
      );
      notifyAdminsOfSignupRequest({ email, name, departmentCode }).catch((err) => {
        console.error('Failed to notify admins of signup request', err);
      });
      res.status(201).json({ message: 'Signup request submitted. Await admin approval.' });
    } catch (err) {
      console.error('Failed to submit signup request', err);
      res.status(500).json({ message: 'Unable to submit signup request.' });
    }
  }
);
app.post(
  '/api/auth/login',
  [
    body('email').isEmail(),
    body('password').isString().isLength({ min: 6, max: 128 })
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const email = lowerEmail(req.body.email);
    const password = req.body.password;
    const { rows } = await pool.query(
      `SELECT id, email, display_name, role, status, password_hash, must_change_password,
              last_login_at, created_at, updated_at, department_code, notify_on_submission
         FROM reviewers WHERE email = $1`,
      [email]
    );
    if (!rows.length) {
      res.status(401).json({ message: 'Invalid credentials.' });
      return;
    }
    const reviewer = rows[0];
    if (reviewer.status !== 'active') {
      res.status(403).json({ message: 'Account inactive.' });
      return;
    }
    const valid = await bcrypt.compare(password, reviewer.password_hash);
    if (!valid) {
      res.status(401).json({ message: 'Invalid credentials.' });
      return;
    }
    const { tokenId, expiresAt } = await createSession(reviewer.id);
    await pool.query('UPDATE reviewers SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1', [reviewer.id]);
    const token = buildTokenPayload(reviewer, tokenId, expiresAt);
    const expiresIso = expiresAt.toISOString();
    const payload = { ...reviewerSummary(reviewer), session_expires_at: expiresIso };
    res.json({ token, expires_at: expiresIso, reviewer: payload });
  }
);

app.post('/api/auth/logout', requireAuth(), async (req, res) => {
  await invalidateSession(req.user?.tokenId);
  res.status(204).send();
});

app.get('/api/auth/me', requireAuth(), async (req, res) => {
  res.json({ reviewer: req.user });
});

app.post('/api/auth/refresh', requireAuth(), async (req, res) => {
  const reviewerId = req.user.id;
  await invalidateSession(req.user.tokenId);
  const { rows } = await pool.query(
    `SELECT id, email, display_name, role, status, must_change_password, last_login_at, created_at, updated_at,
            department_code, notify_on_submission
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
  res.json({ token, expires_at: expiresIso, reviewer: { ...reviewerSummary(reviewer), session_expires_at: expiresIso } });
});

app.post(
  '/api/auth/change-password',
  requireAuth(),
  [
    body('current_password').isString().isLength({ min: 1 }),
    body('new_password').isString().isLength({ min: 6, max: 128 })
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
    const { rows: reviewerRows } = await pool.query(
      `SELECT id, email, display_name, role, status, must_change_password, last_login_at, created_at, updated_at,
              department_code, notify_on_submission
         FROM reviewers WHERE id = $1`,
      [reviewerId]
    );
    const reviewer = reviewerRows[0];
    const { tokenId, expiresAt } = await createSession(reviewerId);
    const token = buildTokenPayload(reviewer, tokenId, expiresAt);
    const expiresIso = expiresAt.toISOString();
    res.json({ token, expires_at: expiresIso, reviewer: { ...reviewerSummary(reviewer), session_expires_at: expiresIso } });
  }
);

// ===== Password Reset (Self-Service) =====
app.post(
  '/api/auth/forgot-password',
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
      [user.id, resetToken, expiresAt]
    );
    
    // Send reset email
    try {
      const resetUrl = `${FRONTEND_BASE_URL}#reset-password=${resetToken}`;
      await sendMail({
        to: email,
        replyTo: REPLY_TO,
        subject: 'Reset your Nauru Treasury account password',
        text: `Hello ${user.display_name || 'User'},

You requested a password reset for your Nauru Treasury account.

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

app.post(
  '/api/auth/reset-password',
  [
    body('token').isString().isLength({ min: 1 }),
    body('new_password').isString().isLength({ min: 6, max: 128 })
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { token, new_password } = req.body;
    
    const { rows } = await pool.query(
      `SELECT prt.reviewer_id, prt.expires_at, r.email, r.display_name, r.status
       FROM password_reset_tokens prt
       JOIN reviewers r ON r.id = prt.reviewer_id
       WHERE prt.token = $1 AND prt.expires_at > NOW()`,
      [token]
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
    
    res.json({ message: 'Password reset successful. You can now sign in with your new password.' });
  }
);

// ===== Account management (admin) =====
app.get('/api/reviewers', requireAuth(['admin']), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, email, display_name, role, status, must_change_password, last_login_at, created_at, updated_at,
            department_code, notify_on_submission
       FROM reviewers
      ORDER BY LOWER(COALESCE(NULLIF(display_name, ''), email)) ASC`
  );
  res.json(rows.map(reviewerSummary));
});

app.post(
  '/api/reviewers',
  requireAuth(['admin']),
  [
    body('email').isEmail(),
    body('display_name').optional({ nullable: true }).isString().isLength({ min: 0, max: 200 }),
    body('role').optional().isIn(ACCOUNT_ROLES),
    body('status').optional().isIn(ACCOUNT_STATUSES),
    body('password').optional().isString().isLength({ min: 6, max: 128 }),
    body('department_code').optional({ nullable: true }).matches(/^\d{2}$/),
    body('notify_on_submission').optional().isBoolean(),
    body('send_email').optional().isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const email = lowerEmail(req.body.email);
    const displayName = req.body.display_name?.trim() || null;
    const role = req.body.role || 'reviewer';
    const status = req.body.status || 'active';
    const departmentCodeRaw = req.body.department_code ? String(req.body.department_code).trim() : null;
    const departmentCode = departmentCodeRaw || null;
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
    let password = req.body.password || '';
    let generated = false;
    if (!password) {
      password = generateTempPassword();
      generated = true;
    }
    const passwordHash = await bcrypt.hash(password, PASS_HASH_ROUNDS);
    try {
      const { rows } = await pool.query(
        `INSERT INTO reviewers (email, display_name, role, status, password_hash, must_change_password, department_code, notify_on_submission)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, email, display_name, role, status, must_change_password, last_login_at, created_at, updated_at,
                   department_code, notify_on_submission`,
        [email, displayName, role, status, passwordHash, true, departmentCode, notifyOnSubmission]
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
      res.status(201).json({ reviewer: reviewerSummary(reviewer), temporary_password: generated ? password : undefined });
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

app.put(
  '/api/reviewers/:id',
  requireAuth(['admin']),
  [
    param('id').isUUID(),
    body('display_name').optional({ nullable: true }).isString().isLength({ min: 0, max: 200 }),
    body('role').optional().isIn(ACCOUNT_ROLES),
    body('status').optional().isIn(ACCOUNT_STATUSES),
    body('department_code').optional({ nullable: true }).matches(/^\d{2}$/),
    body('notify_on_submission').optional().isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const reviewerId = req.params.id;
    const { rows: existingRows } = await pool.query(
      `SELECT id, role, department_code, notify_on_submission FROM reviewers WHERE id = $1`,
      [reviewerId]
    );
    if (!existingRows.length) {
      res.status(404).json({ message: 'Account not found.' });
      return;
    }
    const existing = existingRows[0];
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
    if (req.body.notify_on_submission !== undefined) {
      patch.notify_on_submission = req.body.notify_on_submission === true;
    }

    const finalRole = patch.role ?? existing.role;
    const finalDept = Object.prototype.hasOwnProperty.call(patch, 'department_code')
      ? patch.department_code
      : existing.department_code;
    if (finalRole === 'user' && !finalDept) {
      res.status(400).json({ message: 'Department Head is required for user accounts.' });
      return;
    }
    if (finalRole === 'user') {
      patch.notify_on_submission = false;
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
      `UPDATE reviewers SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING id, email, display_name, role, status, last_login_at, created_at, updated_at,
        must_change_password, department_code, notify_on_submission`,
      values
    );
    res.json({ reviewer: reviewerSummary(rows[0]) });
  }
);

app.post(
  '/api/reviewers/:id/reset-password',
  requireAuth(['admin']),
  [
    param('id').isUUID(),
    body('new_password').optional({ nullable: true }).isString().isLength({ min: 6, max: 128 }),
    body('send_email').optional().isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const reviewerId = req.params.id;
    const { rows } = await pool.query(
      `SELECT id, email, display_name, role, status, must_change_password, last_login_at, created_at, updated_at,
              department_code, notify_on_submission
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
    res.json({ reviewer: reviewerSummary(reviewer), temporary_password: generated ? password : undefined });
  }
);

app.delete(
  '/api/reviewers/:id',
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

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array() });
    return false;
  }
  return true;
}

function formatBatchCode(code) {
  if (!code) return '';
  const str = String(code);
  if (str.includes('-')) return str;
  const digits = str.replace(/[^0-9]/g, '');
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

const lowerEmail = (email) => String(email || '').trim().toLowerCase();

function normalizeBsb(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 6);
  if (digits.length !== 6) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

function normalizeAccountNumber(value) {
  return String(value || '').replace(/[^0-9]/g, '').trim();
}

const buildBlacklistKey = (bsb, account) => {
  const normalizedBsb = normalizeBsb(bsb);
  const normalizedAccount = normalizeAccountNumber(account);
  if (!normalizedBsb || !normalizedAccount) return null;
  return `${normalizedBsb}|${normalizedAccount}`;
};

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
  if (replyToEmail) payload.replyTo = replyToEmail;
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

async function createSession(reviewerId) {
  const tokenId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_MINUTES * 60 * 1000);
  await pool.query(
    `INSERT INTO reviewer_sessions (reviewer_id, token_id, expires_at)
     VALUES ($1, $2, $3)`,
    [reviewerId, tokenId, expiresAt.toISOString()]
  );
  return { tokenId, expiresAt };
}

async function invalidateSession(tokenId) {
  if (!tokenId) return;
  await pool.query('DELETE FROM reviewer_sessions WHERE token_id = $1', [tokenId]);
}

async function lookupSession(tokenId) {
  if (!tokenId) return null;
  const { rows } = await pool.query(
    `SELECT r.id, r.email, r.display_name, r.role, r.status, r.must_change_password, r.last_login_at,
            r.created_at, r.updated_at, r.department_code, r.notify_on_submission, s.expires_at
       FROM reviewer_sessions s
       JOIN reviewers r ON r.id = s.reviewer_id
      WHERE s.token_id = $1`,
    [tokenId]
  );
  if (!rows.length) return null;
  return rows[0];
}

function buildTokenPayload(reviewer, tokenId, expiresAt) {
  return jwt.sign(
    {
      sub: reviewer.id,
      email: reviewer.email,
      role: reviewer.role,
      tokenId
    },
    JWT_SECRET,
    { expiresIn: `${SESSION_MINUTES}m` }
  );
}

function reviewerSummary(row) {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    status: row.status,
    must_change_password: row.must_change_password ?? false,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    department_code: row.department_code || null,
    notify_on_submission: row.notify_on_submission !== false
  };
}

function requireAuth(roles = []) {
  const allowedRoles = Array.isArray(roles) && roles.length ? roles : null;
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      if (!header.startsWith('Bearer ')) {
        res.status(401).json({ message: 'Authentication required.' });
        return;
      }
      const token = header.slice(7);
      let payload;
      try {
        payload = jwt.verify(token, JWT_SECRET);
      } catch (err) {
        res.status(401).json({ message: 'Invalid or expired token.' });
        return;
      }
      const session = await lookupSession(payload.tokenId);
      if (!session) {
        res.status(401).json({ message: 'Session not found.' });
        return;
      }
      if (session.status !== 'active') {
        res.status(403).json({ message: 'Account inactive.' });
        return;
      }
      const now = new Date();
      const expiry = new Date(session.expires_at);
      if (expiry <= now) {
        await invalidateSession(payload.tokenId);
        res.status(401).json({ message: 'Session expired.' });
        return;
      }
      if (allowedRoles && !allowedRoles.includes(session.role)) {
        res.status(403).json({ message: 'Forbidden.' });
        return;
      }
      req.user = {
        id: session.id,
        email: session.email,
        display_name: session.display_name,
        role: session.role,
        must_change_password: session.must_change_password ?? false,
        tokenId: payload.tokenId,
        session_expires_at: session.expires_at,
        department_code: session.department_code || null,
        notify_on_submission: session.notify_on_submission !== false
      };
      next();
    } catch (err) {
      console.error('Authentication error', err);
      res.status(500).json({ message: 'Authentication failed.' });
    }
  };
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

function generateTempPassword(length = TEMP_PASSWORD_LENGTH) {
  const bytes = crypto.randomBytes(Math.ceil(length * 0.75));
  return bytes.toString('base64url').slice(0, length);
}


async function sendReviewerWelcomeEmail({ email, display_name, role }, tempPassword) {
  const name = display_name || email;
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Account';
  const loginUrl = FRONTEND_BASE_URL;
  const text = `Hi ${name},

Your ${roleLabel.toLowerCase()} access has been created for the RON ABA portal.

Login: ${loginUrl}
Email: ${email}
Temporary password: ${tempPassword}

You will be asked to set a new password after signing in.
`;
  await sendMail({ to: email, subject: 'RON Treasury ABA reviewer access', text });
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
  await sendMail({ to: email, subject: 'RON Treasury ABA reviewer password reset', text });
}

async function notifyAdminsOfSignupRequest({ email, name, departmentCode }) {
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
  const adminLink = `${FRONTEND_BASE_URL}#admin`;
  const text = `A new signup request is waiting for review.\n\nName: ${signupName}\nEmail: ${email}\n${deptLine}\nReview the request from the Admin tab: ${adminLink}\n`;
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
  const mailOptions = { to: primaryRecipient, subject, text };
  if (bccRecipients.length) mailOptions.bcc = bccRecipients;
  await sendMail(mailOptions);
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

Sign in to the Nauru Treasury portal to review the notes and resubmit a corrected batch.
`;
  await sendMail({ to: recipient, subject, text });
}

async function fetchRecentArchives(limit) {
  const requested = Number.isFinite(limit) ? limit : REVIEWER_ARCHIVE_LIMIT_DEFAULT;
  const clamped = Math.max(1, Math.min(requested, ADMIN_ARCHIVE_LIMIT_MAX));
  const { rows } = await pool.query(
    `SELECT code, root_batch_id, department_code, file_name, checksum, transactions, created_at,
      stage, stage_updated_at, pd_number, submitted_email, submitted_by, is_draft
       FROM batch_archives
      ORDER BY created_at DESC
      LIMIT $1`,
    [clamped]
  );
  return rows;
}

async function fetchAllArchives() {
  const { rows } = await pool.query(
    `SELECT code, root_batch_id, department_code, file_name, checksum, transactions, created_at,
            stage, stage_updated_at, pd_number, submitted_email, submitted_by, is_draft,
            archived_at, from_history
       FROM combined_batch_archives
      ORDER BY created_at DESC`
  );
  return rows;
}

function maskArchivesForRole(rows, isAdmin) {
  if (isAdmin) return rows;
  return rows.map(({ checksum, ...rest }) => rest);
}

async function fetchBatchHistory(rootBatchId) {
  if (!rootBatchId) return [];
  const { rows: relatedBatches } = await pool.query(
    `SELECT batch_id, code, stage, stage_updated_at, created_at, archived_at
       FROM combined_batch_archives
      WHERE root_batch_id = $1
      ORDER BY created_at ASC`,
    [rootBatchId]
  );
  if (!relatedBatches.length) return [];
  const batchIds = relatedBatches.map((row) => row.batch_id);
  const { rows: events } = await pool.query(
    `SELECT id, batch_id, reviewer, status, stage, comments, metadata, actor_id, created_at
       FROM batch_reviews
      WHERE batch_id = ANY($1::uuid[])
      ORDER BY created_at ASC`,
    [batchIds]
  );
  const batchLookup = new Map(relatedBatches.map((row) => [row.batch_id, row]));
  return events.map((event) => {
    const batchMeta = batchLookup.get(event.batch_id) || {};
    return {
      id: event.id,
      batch_id: event.batch_id,
      code: batchMeta.code || null,
      reviewer: event.reviewer,
      status: event.status,
      stage: event.stage || batchMeta.stage || null,
      comments: event.comments,
      metadata: event.metadata,
      actor_id: event.actor_id,
      created_at: event.created_at,
      batch_created_at: batchMeta.created_at || null,
      batch_stage: batchMeta.stage || null,
      batch_stage_updated_at: batchMeta.stage_updated_at || null
    };
  });
}

async function bootstrapDefaultAdmin() {
  const email = lowerEmail(process.env.DEFAULT_ADMIN_EMAIL);
  const password = process.env.DEFAULT_ADMIN_PASSWORD;
  if (!email || !password) return;
  const displayName = process.env.DEFAULT_ADMIN_NAME || 'Admin';
  const { rows } = await pool.query('SELECT id FROM reviewers WHERE email = $1', [email]);
  if (rows.length) return;
  const hash = await bcrypt.hash(password, PASS_HASH_ROUNDS);
  await pool.query(
    `INSERT INTO reviewers (email, display_name, role, status, password_hash, must_change_password, department_code, notify_on_submission)
     VALUES ($1, $2, 'admin', 'active', $3, TRUE, NULL, FALSE)`,
    [email, displayName, hash]
  );
  console.log(`Created default admin account for ${email}`);
}

// ===== Sanity thresholds =====
app.get('/api/thresholds', requireAuth(REVIEW_ACCESS_ROLES), async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM sanity_thresholds ORDER BY created_at DESC');
  res.json(rows);
});

app.post(
  '/api/thresholds',
  requireAuth(['admin']),
  [
    body('name').isString().trim().notEmpty(),
    body('amount_limit').isFloat({ gt: 0 }),
    body('per_account_daily_limit').optional({ nullable: true }).isInt({ gt: 0 }),
    body('currency').optional({ nullable: true }).isString().isLength({ min: 3, max: 3 }),
    body('description').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('active').optional({ nullable: true }).isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { name, description, currency = 'AUD', amount_limit, per_account_daily_limit, active } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO sanity_thresholds (name, description, currency, amount_limit, per_account_daily_limit, active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, description ?? null, currency.toUpperCase(), amount_limit, per_account_daily_limit ?? null, active !== undefined ? active : false]
    );
    res.status(201).json(rows[0]);
  }
);

app.put(
  '/api/thresholds/:id',
  requireAuth(['admin']),
  [
    param('id').isInt({ gt: 0 }),
    body('name').optional().isString().trim().notEmpty(),
    body('description').optional({ nullable: true }).isString(),
    body('currency').optional({ nullable: true }).isString().isLength({ min: 3, max: 3 }),
    body('amount_limit').optional().isFloat({ gt: 0 }),
    body('per_account_daily_limit').optional({ nullable: true }).isInt({ gt: 0 }),
    body('active').optional({ nullable: true }).isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const id = Number(req.params.id);
    const patch = { ...req.body };
    if (patch.active !== undefined) patch.active = !!patch.active;
    const fields = [];
    const values = [];
    Object.entries(patch).forEach(([key, value], idx) => {
      if (value === undefined) return;
      fields.push(`${key} = $${idx + 1}`);
      values.push(key === 'currency' ? value.toUpperCase() : value);
    });
    if (!fields.length) {
      res.status(400).json({ message: 'No fields to update.' });
      return;
    }
    fields.push(`updated_at = NOW()`);
    const query = `UPDATE sanity_thresholds SET ${fields.join(', ')} WHERE id = $${values.length + 1} RETURNING *`;
    values.push(id);
    const { rows } = await pool.query(query, values);
    if (!rows.length) {
      res.status(404).json({ message: 'Threshold not found.' });
      return;
    }
    res.json(rows[0]);
  }
);

app.delete('/api/thresholds/:id', [requireAuth(['admin']), param('id').isInt({ gt: 0 })], async (req, res) => {
  if (!handleValidation(req, res)) return;
  const id = Number(req.params.id);
  const { rowCount } = await pool.query('DELETE FROM sanity_thresholds WHERE id = $1', [id]);
  if (!rowCount) {
    res.status(404).json({ message: 'Threshold not found.' });
    return;
  }
  res.status(204).send();
});

// ===== Whitelist =====
app.get('/api/whitelist', requireAuth(REVIEW_ACCESS_ROLES), async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM whitelist_entries ORDER BY alias ASC');
  res.json(rows);
});

app.post(
  '/api/whitelist',
  requireAuth(['admin']),
  [
    body('bsb').matches(/^[0-9]{3}-[0-9]{3}$/),
    body('account').isLength({ min: 5, max: 16 }),
    body('alias').isString().trim().notEmpty(),
    body('notes').optional({ nullable: true }).isString(),
    body('active').optional({ nullable: true }).isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { bsb, account, alias, notes, active } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO whitelist_entries (bsb, account, alias, notes, active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (bsb, account) DO UPDATE SET alias = EXCLUDED.alias, notes = EXCLUDED.notes, active = EXCLUDED.active, updated_at = NOW()
       RETURNING *`,
      [bsb, account, alias, notes ?? null, active !== undefined ? active : false]
    );
    res.status(201).json(rows[0]);
  }
);

app.put(
  '/api/whitelist/:id',
  requireAuth(['admin']),
  [
    param('id').isInt({ gt: 0 }),
    body('alias').optional().isString().trim().notEmpty(),
    body('notes').optional({ nullable: true }).isString(),
    body('active').optional({ nullable: true }).isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const id = Number(req.params.id);
    const patch = { ...req.body };
    if (patch.active !== undefined) patch.active = !!patch.active;
    const fields = [];
    const values = [];
    Object.entries(patch).forEach(([key, value], idx) => {
      if (value === undefined) return;
      fields.push(`${key} = $${idx + 1}`);
      values.push(value);
    });
    if (!fields.length) {
      res.status(400).json({ message: 'No fields to update.' });
      return;
    }
    fields.push('updated_at = NOW()');
    const query = `UPDATE whitelist_entries SET ${fields.join(', ')} WHERE id = $${values.length + 1} RETURNING *`;
    values.push(id);
    const { rows } = await pool.query(query, values);
    if (!rows.length) {
      res.status(404).json({ message: 'Whitelist entry not found.' });
      return;
    }
    res.json(rows[0]);
  }
);

app.delete('/api/whitelist/:id', [requireAuth(['admin']), param('id').isInt({ gt: 0 })], async (req, res) => {
  if (!handleValidation(req, res)) return;
  const id = Number(req.params.id);
  const { rowCount } = await pool.query('DELETE FROM whitelist_entries WHERE id = $1', [id]);
  if (!rowCount) {
    res.status(404).json({ message: 'Whitelist entry not found.' });
    return;
  }
  res.status(204).send();
});

// ===== Blacklist =====
app.get('/api/blacklist', requireAuth(['admin']), async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM blacklist_entries ORDER BY bsb ASC, account ASC');
  res.json(rows);
});

app.get('/api/blacklist/active', requireAuth(), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT bsb, account, label FROM blacklist_entries
      WHERE active = TRUE
      ORDER BY bsb ASC, account ASC`
  );
  res.json(rows);
});

app.post(
  '/api/blacklist',
  requireAuth(['admin']),
  [
    body('bsb').matches(BSB_REGEX),
    body('account').matches(/^\d{5,16}$/),
    body('label').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body('notes').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('active').optional({ nullable: true }).isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const bsb = normalizeBsb(req.body.bsb);
    const account = normalizeAccountNumber(req.body.account);
    const label = req.body.label ? String(req.body.label).trim() : null;
    const notes = req.body.notes ? String(req.body.notes).trim() : null;
    const active = req.body.active === undefined ? true : !!req.body.active;
    if (!bsb || !account) {
      res.status(400).json({ message: 'Provide a valid BSB and account number.' });
      return;
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO blacklist_entries (bsb, account, label, notes, active)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (bsb, account)
         DO UPDATE SET label = EXCLUDED.label, notes = EXCLUDED.notes, active = EXCLUDED.active, updated_at = NOW()
         RETURNING *`,
        [bsb, account, label, notes, active]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      console.error('Failed to upsert blacklist entry', err);
      res.status(500).json({ message: 'Unable to store blacklist entry.' });
    }
  }
);

app.post(
  '/api/blacklist/import',
  requireAuth(['admin']),
  [
    body('entries').isArray({ min: 1, max: BLACKLIST_IMPORT_LIMIT })
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const rawEntries = Array.isArray(req.body.entries) ? req.body.entries : [];
    const invalid = [];
    const validEntries = [];
    const parseActive = (value) => {
      if (value === undefined || value === null || value === '') return true;
      const lowered = String(value).trim().toLowerCase();
      if (!lowered) return true;
      if (['true', 't', '1', 'yes', 'y', 'active'].includes(lowered)) return true;
      if (['false', 'f', '0', 'no', 'n', 'inactive'].includes(lowered)) return false;
      return null;
    };
    rawEntries.forEach((entry, idx) => {
      const rowNumberCandidate = Number(entry?.rowNumber ?? entry?.row_number);
      const rowNumber = Number.isFinite(rowNumberCandidate) && rowNumberCandidate > 0 ? Math.floor(rowNumberCandidate) : idx + 1;
      if (!entry || typeof entry !== 'object') {
        invalid.push({ index: rowNumber, message: 'Row is empty or invalid.' });
        return;
      }
      const bsb = normalizeBsb(entry.bsb);
      const account = normalizeAccountNumber(entry.account);
      const labelRaw = entry.label === undefined || entry.label === null ? null : String(entry.label).trim();
      const notesRaw = entry.notes === undefined || entry.notes === null ? null : String(entry.notes).trim();
      const activeParsed = parseActive(entry.active);
      if (!bsb) {
        invalid.push({ index: rowNumber, message: 'Invalid BSB. Use NNN-NNN.' });
        return;
      }
      if (!account || account.length < 5 || account.length > 16) {
        invalid.push({ index: rowNumber, message: 'Account number must be 5-16 digits.' });
        return;
      }
      if (labelRaw && labelRaw.length > 200) {
        invalid.push({ index: rowNumber, message: 'Label exceeds 200 characters.' });
        return;
      }
      if (notesRaw && notesRaw.length > 2000) {
        invalid.push({ index: rowNumber, message: 'Notes exceed 2000 characters.' });
        return;
      }
      if (activeParsed === null) {
        invalid.push({ index: rowNumber, message: 'Active flag must be yes/no or true/false.' });
        return;
      }
      validEntries.push({
        rowNumber,
        bsb,
        account,
        label: labelRaw || null,
        notes: notesRaw || null,
        active: activeParsed
      });
    });
    if (!validEntries.length) {
      res.status(400).json({ message: 'No valid entries to import.', errors: invalid });
      return;
    }
    const client = await pool.connect();
    const stats = { inserted: 0, updated: 0 };
    try {
      await client.query('BEGIN');
      for (const entry of validEntries) {
        try {
          const { rows } = await client.query(
            `INSERT INTO blacklist_entries (bsb, account, label, notes, active)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (bsb, account)
             DO UPDATE SET label = EXCLUDED.label, notes = EXCLUDED.notes, active = EXCLUDED.active, updated_at = NOW()
             RETURNING (xmax = 0)::boolean AS inserted` ,
            [entry.bsb, entry.account, entry.label, entry.notes, entry.active]
          );
          if (rows[0]?.inserted) stats.inserted += 1;
          else stats.updated += 1;
        } catch (err) {
          console.error('Import blacklist row failed', err);
          invalid.push({ index: entry.rowNumber, message: 'Database error while importing row.' });
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Failed to import blacklist entries', err);
      res.status(500).json({ message: 'Unable to import blacklist entries.' });
      return;
    } finally {
      client.release();
    }
    res.status(201).json({
      inserted: stats.inserted,
      updated: stats.updated,
      skipped: invalid.length,
      errors: invalid
    });
  }
);

app.put(
  '/api/blacklist/:id',
  requireAuth(['admin']),
  [
    param('id').isInt({ gt: 0 }),
    body('bsb').optional().matches(BSB_REGEX),
    body('account').optional().matches(/^\d{5,16}$/),
    body('label').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body('notes').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('active').optional({ nullable: true }).isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const id = Number(req.params.id);
    const patch = { ...req.body };
    if (patch.bsb !== undefined) {
      const normalized = normalizeBsb(patch.bsb);
      if (!normalized) {
        res.status(400).json({ message: 'BSB must be formatted as NNN-NNN.' });
        return;
      }
      patch.bsb = normalized;
    }
    if (patch.account !== undefined) {
      const normalized = normalizeAccountNumber(patch.account);
      if (!normalized) {
        res.status(400).json({ message: 'Account number is required.' });
        return;
      }
      patch.account = normalized;
    }
    if (patch.label !== undefined) patch.label = patch.label === null ? null : String(patch.label).trim();
    if (patch.notes !== undefined) patch.notes = patch.notes === null ? null : String(patch.notes).trim();
    if (patch.active !== undefined) patch.active = !!patch.active;
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (!entries.length) {
      res.status(400).json({ message: 'No fields to update.' });
      return;
    }
    const fields = entries.map(([key], idx) => `${key} = $${idx + 1}`);
    const values = entries.map(([, value]) => value);
    fields.push(`updated_at = NOW()`);
    values.push(id);
    try {
      const { rows } = await pool.query(
        `UPDATE blacklist_entries SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
        values
      );
      if (!rows.length) {
        res.status(404).json({ message: 'Blacklist entry not found.' });
        return;
      }
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        res.status(409).json({ message: 'A blacklist entry for this BSB/account already exists.' });
        return;
      }
      console.error('Failed to update blacklist entry', err);
      res.status(500).json({ message: 'Unable to update blacklist entry.' });
    }
  }
);

app.delete('/api/blacklist/:id', [requireAuth(['admin']), param('id').isInt({ gt: 0 })], async (req, res) => {
  if (!handleValidation(req, res)) return;
  const id = Number(req.params.id);
  try {
    const { rowCount } = await pool.query('DELETE FROM blacklist_entries WHERE id = $1', [id]);
    if (!rowCount) {
      res.status(404).json({ message: 'Blacklist entry not found.' });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error('Failed to delete blacklist entry', err);
    res.status(500).json({ message: 'Unable to delete blacklist entry.' });
  }
});

// ===== Reviews =====
app.post(
  '/api/reviews',
  requireAuth(REVIEW_ACCESS_ROLES),
  [
    body('batch_id').isUUID(),
    body('reviewer').isString().trim().notEmpty(),
    body('status').isIn(['submitted', 'pending', 'approved', 'rejected']),
    body('comments').optional({ nullable: true }).isString(),
    body('metadata').optional({ nullable: true })
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { batch_id, reviewer, status, comments, metadata } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO batch_reviews (batch_id, reviewer, status, comments, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [batch_id, reviewer, status, comments ?? null, metadata ?? {}]
    );
    res.status(201).json(rows[0]);
  }
);

app.get('/api/reviews', requireAuth(['admin']), async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM batch_reviews ORDER BY created_at DESC LIMIT 100');
  res.json(rows);
});

app.get('/api/reviews/:batchId', [requireAuth(REVIEW_ACCESS_ROLES), param('batchId').isUUID()], async (req, res) => {
  if (!handleValidation(req, res)) return;
  const { rows } = await pool.query(
    'SELECT * FROM batch_reviews WHERE batch_id = $1 ORDER BY created_at DESC',
    [req.params.batchId]
  );
  res.json(rows);
});

app.get(
  '/api/pd/:pdNumber',
  requireAuth(),
  [
    param('pdNumber').isString().trim().isLength({ min: 1, max: 50 }),
    query('root_batch_id').optional().isString()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const digitsOnly = req.params.pdNumber.replace(/\D/g, '');
    if (!digitsOnly) {
      res.status(400).json({ message: 'PD number must include digits.' });
      return;
    }

    const rootBatchIdRaw = typeof req.query.root_batch_id === 'string' ? req.query.root_batch_id : null;
    const duplicateParams = [digitsOnly];
    let duplicateQuery = `
      SELECT code, stage, department_code, root_batch_id, is_draft
        FROM combined_batch_archives
       WHERE REGEXP_REPLACE(COALESCE(pd_number, ''), '\\D', '', 'g') = $1
         AND COALESCE(is_draft, FALSE) = FALSE
         AND stage <> 'rejected'
    `;
    if (rootBatchIdRaw && UUID_REGEX.test(rootBatchIdRaw)) {
      duplicateQuery += ' AND root_batch_id <> $2';
      duplicateParams.push(rootBatchIdRaw);
    }
    duplicateQuery += ' ORDER BY created_at DESC LIMIT 1';

    const { rows } = await pool.query(duplicateQuery, duplicateParams);
    if (rows.length) {
      const conflict = rows[0];
      const conflictLabel = conflict.code ? formatBatchCode(conflict.code) : 'an existing batch';
      const deptLabel = conflict.department_code ? ` for department ${conflict.department_code}` : '';
      const stageLabel = conflict.stage ? ` (currently ${conflict.stage})` : '';
      res.status(409).json({
        message: `PD ${digitsOnly} has already been used on ${conflictLabel}${deptLabel}${stageLabel}.`,
        conflict,
      });
      return;
    }

    res.json({ exists: false });
  }
);

// ===== Batch storage =====
app.post(
  '/api/batches',
  requireAuth(),
  [
    body('aba_content').isString(),
    body('pd_number').isString().trim().isLength({ min: 1, max: 50 }),
    body('metadata').optional({ nullable: true }),
    body('checksum').optional({ nullable: true }).isString(),
    body('suggested_file_name').optional({ nullable: true }).isString(),
    body('dept_code').optional({ nullable: true }).matches(/^\d{2}$/)
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const account = req.user;
    const pdNumber = String(req.body.pd_number || '').trim();
    if (!pdNumber) {
      res.status(400).json({ message: 'PD number is required.' });
      return;
    }
    let fileData;
    try {
      fileData = Buffer.from(req.body.aba_content, 'base64');
    } catch (err) {
      res.status(400).json({ message: 'Invalid ABA content.' });
      return;
    }
    const accountDept = account.department_code ? String(account.department_code).trim() : '';
    const fallbackDept = req.body.dept_code ? String(req.body.dept_code).trim() : '';
    const deptCode = accountDept || fallbackDept;
    if (!/^\d{2}$/.test(deptCode)) {
      res.status(400).json({ message: 'Department Head is required for your account.' });
      return;
    }

    const rootBatchIdRaw = req.body.root_batch_id;
    let rootBatchId = null;
    if (rootBatchIdRaw) {
      if (typeof rootBatchIdRaw !== 'string' || !UUID_REGEX.test(rootBatchIdRaw)) {
        res.status(400).json({ message: 'Invalid root batch identifier provided.' });
        return;
      }
      rootBatchId = rootBatchIdRaw;
    }

    const duplicateParams = [pdNumber];
    let duplicateQuery = `
      SELECT code, stage, department_code, root_batch_id, is_draft
        FROM combined_batch_archives
       WHERE REGEXP_REPLACE(COALESCE(pd_number, ''), '\\D', '', 'g') = $1
         AND COALESCE(is_draft, FALSE) = FALSE
         AND stage <> 'rejected'
    `;
    if (rootBatchId) {
      duplicateQuery += ' AND root_batch_id <> $2';
      duplicateParams.push(rootBatchId);
    }
    duplicateQuery += ' ORDER BY created_at DESC LIMIT 1';

    const { rows: duplicateRows } = await pool.query(duplicateQuery, duplicateParams);
    if (duplicateRows.length) {
      const conflict = duplicateRows[0];
      const conflictLabel = conflict.code ? formatBatchCode(conflict.code) : 'an existing batch';
      const deptLabel = conflict.department_code ? ` for department ${conflict.department_code}` : '';
      const stageLabel = conflict.stage ? ` (currently ${conflict.stage})` : '';
      res.status(409).json({
        message: `PD ${pdNumber} has already been used on ${conflictLabel}${deptLabel}${stageLabel}. Please load that batch instead of creating a new submission.`
      });
      return;
    }

    const now = new Date();
    const submittedIso = now.toISOString();
    const datePart = submittedIso.slice(0, 10).replace(/-/g, '');
    const prefix = `${deptCode}-${datePart}`;
    let sequence = 1;
    const { rows: existing } = await pool.query(
      'SELECT code FROM combined_batch_archives WHERE code LIKE $1 ORDER BY code DESC LIMIT 1',
      [`${prefix}%`]
    );
    if (existing.length) {
      const suffix = existing[0].code.slice(prefix.length);
      const parsed = parseInt(suffix, 10);
      if (!Number.isNaN(parsed)) sequence = parsed + 1;
    }

    const fileNameSuggested = req.body.suggested_file_name;
    const metadataInput = req.body.metadata;
    const metadata = (metadataInput && typeof metadataInput === 'object') ? { ...metadataInput } : {};
    const preparedByRaw = typeof metadata.prepared_by === 'string' ? metadata.prepared_by.trim() : '';
    const preparedBy = preparedByRaw || account.display_name || account.email;
    if (!preparedBy) {
      res.status(400).json({ message: 'Prepared by is required.' });
      return;
    }
    metadata.prepared_by = preparedBy;
    metadata.department_code = deptCode;
    metadata.pd_number = pdNumber;
    metadata.submitted_by_email = account.email;
    metadata.submitted_by_role = account.role;
    if (account.display_name) metadata.submitted_by_name = account.display_name;
    metadata.submitted_at = submittedIso;

    const payloadTransactions = Array.isArray(metadata?.payload?.transactions)
      ? metadata.payload.transactions
      : [];
    if (payloadTransactions.length) {
      const normalizedTransactions = payloadTransactions
        .map((tx) => {
          const txBsb = normalizeBsb(tx?.bsb);
          const txAccount = normalizeAccountNumber(tx?.account);
          if (!txBsb || !txAccount) return null;
          return {
            bsb: txBsb,
            account: txAccount,
            original: tx
          };
        })
        .filter(Boolean);
      if (normalizedTransactions.length) {
        const { rows: blacklistRows } = await pool.query(
          `SELECT bsb, account, label FROM blacklist_entries WHERE active = TRUE`
        );
        if (blacklistRows.length) {
          const blacklistSet = new Map(
            blacklistRows.map((row) => {
              const key = buildBlacklistKey(row.bsb, row.account);
              return [key, row];
            })
          );
          const blocked = normalizedTransactions.find((tx) => {
            const key = buildBlacklistKey(tx.bsb, tx.account);
            return key && blacklistSet.has(key);
          });
          if (blocked) {
            const key = buildBlacklistKey(blocked.bsb, blocked.account);
            const meta = key ? blacklistSet.get(key) : null;
            const labelText = meta?.label ? ` (${meta.label})` : '';
            res.status(400).json({
              message: `Transactions to ${blocked.bsb} / ${blocked.account}${labelText} are not permitted.`
            });
            return;
          }
        }
      }
    }

    const batchId = crypto.randomUUID();
    if (!rootBatchId) rootBatchId = batchId;
    let insertedRow = null;
    for (let attempt = 0; attempt < 5 && !insertedRow; attempt++) {
      const code = `${prefix}${String(sequence).padStart(2, '0')}`;
      const fileName = fileNameSuggested || `ABA_${code}.aba`;
      try {
        const { rows } = await pool.query(
          `INSERT INTO batch_archives (
             batch_id, code, root_batch_id, department_code, file_name, file_path, checksum,
             duplicate_report_path, transactions, file_data, pd_number, submitted_email,
             submitted_by, stage, stage_updated_at, is_draft
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'submitted', $14, FALSE)
           RETURNING batch_id, code, root_batch_id, file_name, created_at, department_code, stage, stage_updated_at, pd_number, submitted_email, submitted_by`,
          [
            batchId,
            code,
            rootBatchId,
            deptCode,
            fileName,
            `db://${code}`,
            req.body.checksum ?? null,
            null,
            metadata,
            fileData,
            pdNumber,
            account.email,
            account.id,
            submittedIso
          ]
        );
        insertedRow = rows[0];
      } catch (err) {
        if (err.code === '23505') {
          sequence += 1;
          continue;
        }
        throw err;
      }
    }
    if (!insertedRow) {
      res.status(500).json({ message: 'Unable to generate unique batch code.' });
      return;
    }

    const initialReviewComment = metadata.notes && metadata.notes.trim()
      ? metadata.notes.trim()
      : 'Batch submitted for review.';
    await pool.query(
      `INSERT INTO batch_reviews (batch_id, reviewer, status, comments, metadata, actor_id, stage)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        batchId,
        account.display_name || account.email,
        'submitted',
        initialReviewComment,
        { pd_number: pdNumber, department_code: deptCode },
        account.id,
        'submitted'
      ]
    );

    const savedBatch = { ...insertedRow, metadata };
    notifyReviewersOfNewBatch(savedBatch, metadata).catch((err) => {
      console.error('Failed to send reviewer notification', err);
    });
    res.status(201).json(savedBatch);
  }
);

app.patch(
  '/api/batches/:code/stage',
  requireAuth(REVIEW_ACCESS_ROLES),
  [
    param('code').isString().isLength({ min: 1, max: 64 }),
    body('stage').isIn(['approved', 'rejected']),
    body('comments').optional({ nullable: true }).isString().isLength({ max: 4000 }),
    body('notify').optional().isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const code = req.params.code;
    const targetStage = req.body.stage;
    const commentsRaw = typeof req.body.comments === 'string' ? req.body.comments.trim() : '';
  const actor = req.user;
  const notifySubmitter = req.body.notify !== false; // default true unless explicitly false

    const { rows } = await pool.query(
      `SELECT batch_id, code, root_batch_id, department_code, file_name, checksum, created_at, transactions,
        stage, stage_updated_at, pd_number, submitted_email, submitted_by, is_draft
         FROM batch_archives
        WHERE code = $1`,
      [code]
    );
    if (!rows.length) {
      res.status(404).json({ message: 'Batch not found.' });
      return;
    }
    const batch = rows[0];
    const metadata = (batch.transactions && typeof batch.transactions === 'object') ? batch.transactions : {};
    const currentStage = batch.stage;
    // Allow reviewers to revert approved batches back to rejected for corrections
    const baseTransitions = {
      submitted: ['approved', 'rejected'],
      rejected: ['approved'],
      approved: ['rejected']
    };
    const allowedNext = baseTransitions[currentStage] || [];
    const isOverride = actor?.role === 'admin' && currentStage !== 'submitted' && targetStage === 'approved';
    if (!allowedNext.includes(targetStage)) {
      res.status(400).json({ message: `Cannot move batch from ${currentStage} to ${targetStage}.` });
      return;
    }
    const stageUpdatedIso = new Date().toISOString();
    const { rows: updatedRows } = await pool.query(
      `UPDATE batch_archives
          SET stage = $1,
              stage_updated_at = $2
        WHERE code = $3
      RETURNING batch_id, code, root_batch_id, department_code, file_name, checksum, created_at, transactions,
                stage, stage_updated_at, pd_number, submitted_email, submitted_by, is_draft`,
      [targetStage, stageUpdatedIso, code]
    );
    const updated = updatedRows[0];

    await pool.query(
      `INSERT INTO batch_reviews (batch_id, reviewer, status, comments, metadata, actor_id, stage)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        updated.batch_id,
        actor.display_name || actor.email,
        targetStage,
        commentsRaw || null,
        {
          from_stage: currentStage,
          to_stage: targetStage,
          pd_number: updated.pd_number,
          department_code: updated.department_code,
          override_by_admin: isOverride === true,
          notify_submitter: notifySubmitter === true
        },
        actor.id,
        targetStage
      ]
    );

    if (targetStage === 'rejected' && notifySubmitter) {
      notifySubmitterOfRejection(updated, metadata, commentsRaw, actor).catch((err) => {
        console.error('Failed to notify submitter of rejection', err);
      });
    }

    res.json(updated);
  }
);

app.get('/api/batches/:code', requireAuth(REVIEW_ACCESS_ROLES), async (req, res) => {
  const { code } = req.params;
  const { rows } = await pool.query(
    `SELECT batch_id, code, root_batch_id, department_code, file_name, checksum, created_at, transactions,
            encode(file_data, 'base64') AS file_base64, stage, stage_updated_at, pd_number,
            submitted_email, submitted_by, is_draft, archived_at
       FROM combined_batch_archives
      WHERE code = $1
      ORDER BY archived_at NULLS FIRST, created_at DESC
      LIMIT 1`,
    [code]
  );
  if (!rows.length) {
    res.status(404).json({ message: 'Batch not found.' });
    return;
  }
  const record = rows[0];
  const response = { ...record };
  if (record.stage !== 'approved') {
    response.file_base64 = null;
    response.file_available = false;
  } else {
    response.file_available = true;
  }
  res.json(response);
});

app.patch(
  '/api/batches/:code/value-date',
  requireAuth(REVIEW_ACCESS_ROLES),
  [
    param('code').isString().trim(),
    body('proc').matches(/^\d{6}$/),
    body('aba_content').isString(),
    body('desc').optional({ nullable: true }).isString(),
    body('remitter').optional({ nullable: true }).isString()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const formattedCode = formatBatchCode(req.params.code);
    const { proc, desc, remitter, aba_content: abaContent } = req.body;
    let fileData;
    try {
      fileData = Buffer.from(abaContent, 'base64');
    } catch (err) {
      res.status(400).json({ message: 'Invalid ABA content.' });
      return;
    }
    try {
      const { rows } = await pool.query(
        `SELECT batch_id, code, root_batch_id, department_code, file_name, checksum, created_at, transactions,
                stage, stage_updated_at, pd_number, submitted_email, submitted_by, is_draft
           FROM batch_archives
          WHERE deleted_at IS NULL
            AND code = $1
          LIMIT 1`,
        [formattedCode]
      );
      if (!rows.length) {
        res.status(404).json({ message: 'Batch not found.' });
        return;
      }
      const record = rows[0];
      const stage = (record.stage || '').toLowerCase();
      if (!['submitted', 'approved'].includes(stage)) {
        res.status(400).json({ message: 'Value date adjustments are not allowed for this stage.' });
        return;
      }
      const metadata = (record.transactions && typeof record.transactions === 'object')
        ? { ...record.transactions }
        : {};
      if (!metadata.payload || !metadata.payload.header || !Array.isArray(metadata.payload.transactions)) {
        res.status(400).json({ message: 'Original payload unavailable. Cannot rebuild ABA automatically.' });
        return;
      }
      metadata.payload.header.proc = proc;
      if (typeof desc === 'string') metadata.payload.header.desc = desc;
      if (typeof remitter === 'string') metadata.payload.header.remitter = remitter;
      metadata.value_date_adjustment = {
        proc,
        adjusted_at: new Date().toISOString(),
        adjusted_by: req.user.display_name || req.user.email || `user-${req.user.id}`
      };
      const checksum = crypto.createHash('sha256').update(fileData).digest('hex');
      const { rows: updatedRows } = await pool.query(
        `UPDATE batch_archives
            SET file_data = $1,
                transactions = $2,
                checksum = $3
          WHERE code = $4
          RETURNING batch_id, code, root_batch_id, department_code, file_name, checksum, created_at, transactions,
                    encode(file_data, 'base64') AS file_base64, stage, stage_updated_at, pd_number,
                    submitted_email, submitted_by, is_draft`,
        [fileData, metadata, checksum, formattedCode]
      );
      if (!updatedRows.length) {
        res.status(500).json({ message: 'Failed to update batch value date.' });
        return;
      }
      const updated = updatedRows[0];

      const actorName = req.user.display_name || req.user.email || `user-${req.user.id}`;
      const commentParts = [`Value date set to ${proc}`];
      if (typeof desc === 'string') commentParts.push(`Desc: ${desc || 'blank'}`);
      if (typeof remitter === 'string') commentParts.push(`Remitter: ${remitter || 'blank'}`);
      const adjustmentMetadata = { action: 'value_date_adjustment', proc };
      if (typeof desc === 'string') adjustmentMetadata.desc = desc;
      if (typeof remitter === 'string') adjustmentMetadata.remitter = remitter;
      await pool.query(
        `INSERT INTO batch_reviews (batch_id, reviewer, status, comments, metadata, actor_id, stage)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          record.batch_id,
          actorName,
          record.stage || 'submitted',
          commentParts.join(' · '),
          adjustmentMetadata,
          req.user.id || null,
          record.stage || 'submitted'
        ]
      );

      const response = { ...updated };
      if (updated.stage !== 'approved') {
        response.file_base64 = null;
        response.file_available = false;
      } else {
        response.file_available = true;
      }
      res.json(response);
    } catch (err) {
      console.error('Failed to adjust value date', err);
      res.status(500).json({ message: 'Unable to adjust value date.' });
    }
  }
);

app.get('/api/my/batches', requireAuth(), async (req, res) => {
  const userId = req.user.id;
  const userEmail = lowerEmail(req.user.email);
  const limitParam = Number.parseInt(req.query.limit, 10);
  const limit = Number.isNaN(limitParam) ? 200 : Math.max(1, Math.min(limitParam, 500));
  try {
    const { rows } = await pool.query(
      `SELECT code, root_batch_id, department_code, file_name, created_at, stage, stage_updated_at,
              pd_number, submitted_email, submitted_by, is_draft
         FROM batch_archives
        WHERE deleted_at IS NULL
          AND (
                submitted_by = $1
             OR (submitted_by IS NULL AND submitted_email IS NOT NULL AND LOWER(submitted_email) = $2)
          )
        ORDER BY created_at DESC
        LIMIT $3`,
      [userId, userEmail, limit]
    );
    res.json(rows);
  } catch (err) {
    console.error('Failed to load owned batches', err);
    res.status(500).json({ message: 'Failed to load your batches.' });
  }
});

app.get('/api/my/batches/:code', requireAuth(), async (req, res) => {
  const rawCode = req.params.code;
  const formattedCode = formatBatchCode(rawCode);
  const userId = req.user.id;
  const userEmail = lowerEmail(req.user.email);
  try {
    const { rows } = await pool.query(
      `SELECT batch_id, code, root_batch_id, department_code, file_name, checksum, created_at, transactions,
              encode(file_data, 'base64') AS file_base64, stage, stage_updated_at, pd_number,
              submitted_email, submitted_by, is_draft
         FROM batch_archives
        WHERE deleted_at IS NULL
          AND code = $1
          AND (
                submitted_by = $2
             OR (submitted_by IS NULL AND submitted_email IS NOT NULL AND LOWER(submitted_email) = $3)
          )`,
      [formattedCode, userId, userEmail]
    );
    if (!rows.length) {
      res.status(404).json({ message: 'Batch not found.' });
      return;
    }
    const batch = rows[0];
    const history = await fetchBatchHistory(batch.root_batch_id);
    res.json({ ...batch, history });
  } catch (err) {
    console.error('Failed to load owned batch', err);
    res.status(500).json({ message: 'Failed to load batch details.' });
  }
});

app.delete(
  '/api/batches/:code',
  [requireAuth(['admin']), param('code').isString().isLength({ min: 1, max: 64 })],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { rowCount } = await pool.query('DELETE FROM batch_archives WHERE code = $1', [req.params.code]);
    if (!rowCount) {
      res.status(404).json({ message: 'Batch not found.' });
      return;
    }
    res.status(204).send();
  }
);

app.get('/api/archives', requireAuth(REVIEW_ACCESS_ROLES), async (req, res) => {
  const isAdmin = req.user?.role === 'admin';
  const scope = String(req.query.scope || '').toLowerCase();
  const wantAllArchives = scope === 'all';
  const limitParam = Number.parseInt(req.query.limit, 10);
  let limit = isAdmin ? ADMIN_ARCHIVE_LIMIT_DEFAULT : REVIEWER_ARCHIVE_LIMIT_DEFAULT;
  if (!wantAllArchives) {
    if (!Number.isNaN(limitParam)) {
      const upper = isAdmin ? ADMIN_ARCHIVE_LIMIT_MAX : REVIEWER_ARCHIVE_LIMIT_MAX;
      limit = Math.max(1, Math.min(limitParam, upper));
    } else if (!isAdmin && scope === 'recent') {
      limit = REVIEWER_ARCHIVE_LIMIT_DEFAULT;
    }
  }
  try {
    const rows = wantAllArchives ? await fetchAllArchives() : await fetchRecentArchives(limit);
    res.json(maskArchivesForRole(rows, isAdmin));
  } catch (err) {
    console.error('Failed to load archives', err);
    res.status(500).json({ message: 'Failed to load archives.' });
  }
});

app.get('/api/archives/recent', requireAuth(REVIEW_ACCESS_ROLES), async (req, res) => {
  try {
    const limitParam = Number.parseInt(req.query.limit, 10);
    const limit = Number.isNaN(limitParam)
      ? REVIEWER_ARCHIVE_LIMIT_DEFAULT
      : Math.max(1, Math.min(limitParam, REVIEWER_ARCHIVE_LIMIT_MAX));
    const rows = await fetchRecentArchives(limit);
    res.json(maskArchivesForRole(rows, req.user?.role === 'admin'));
  } catch (err) {
    console.error('Failed to load archives (recent)', err);
    res.status(500).json({ message: 'Failed to load archives.' });
  }
});

const PORT = Number(process.env.PORT || 4000);

function hashPassphrase(passphrase) {
  return crypto.createHash('sha256').update(passphrase).digest('hex');
}

app.get('/api/reviewer/passphrase', async (_req, res) => {
  const { rows } = await pool.query('SELECT updated_at FROM reviewer_settings WHERE id = TRUE');
  if (!rows.length) {
    res.json({ configured: false });
    return;
  }
  res.json({ configured: true, updated_at: rows[0].updated_at });
});

app.post(
  '/api/reviewer/passphrase',
  [body('passphrase').isString().isLength({ min: 4, max: 128 })],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const passphraseHash = hashPassphrase(req.body.passphrase);
    const { rows } = await pool.query(
      `INSERT INTO reviewer_settings (id, passphrase_hash, updated_at)
       VALUES (TRUE, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET passphrase_hash = EXCLUDED.passphrase_hash, updated_at = NOW()
       RETURNING updated_at`,
      [passphraseHash]
    );
    res.status(201).json({ configured: true, updated_at: rows[0].updated_at });
  }
);

app.post(
  '/api/reviewer/passphrase/verify',
  [body('passphrase').isString().isLength({ min: 1, max: 128 })],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { rows } = await pool.query('SELECT passphrase_hash FROM reviewer_settings WHERE id = TRUE');
    if (!rows.length || !rows[0].passphrase_hash) {
      res.status(404).json({ message: 'Reviewer passphrase not configured.' });
      return;
    }
    const incoming = hashPassphrase(req.body.passphrase);
    const stored = rows[0].passphrase_hash;
    if (incoming.length !== stored.length) {
      res.status(401).json({ valid: false, message: 'Invalid passphrase.' });
      return;
    }
    const valid = crypto.timingSafeEqual(Buffer.from(incoming, 'hex'), Buffer.from(stored, 'hex'));
    if (valid) res.json({ valid: true });
    else res.status(401).json({ valid: false, message: 'Invalid passphrase.' });
  }
);

app.get('/api/admin/testing-mode', requireAuth(['admin']), async (_req, res) => {
  try {
    const state = await refreshTestingModeSetting();
    res.json(state);
  } catch (err) {
    res.status(500).json({ message: 'Unable to load testing mode setting.' });
  }
});

app.post(
  '/api/admin/testing-mode',
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
        // Decrypt password
        try {
          smtpPass = await bcrypt.compare('verify', settings.smtp_pass_encrypted) 
            ? null 
            : settings.smtp_pass_encrypted;
        } catch {
          smtpPass = settings.smtp_pass_encrypted;
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

// Get current SMTP settings (password masked)
app.get('/api/admin/smtp-settings', requireAuth(['admin']), async (_req, res) => {
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
app.post(
  '/api/admin/smtp-settings',
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
      
      // Store password as-is (it's already transmitted over HTTPS)
      // In production, consider additional encryption
      const passEncrypted = smtp_pass || null;
      
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
app.post('/api/admin/smtp-settings/test', requireAuth(['admin']), async (req, res) => {
  try {
    if (!mailTransport) {
      res.status(400).json({ success: false, message: 'SMTP not configured.' });
      return;
    }
    
    // Verify connection
    await mailTransport.verify();
    
    // Send test email if recipient provided
    const testEmail = req.body.test_email || req.user?.email;
    if (testEmail) {
      await sendMail({
        to: testEmail,
        subject: 'ABA Stack - SMTP Test',
        text: `This is a test email from the ABA Stack application.\n\nSent at: ${new Date().toISOString()}\n\nIf you receive this, your SMTP settings are working correctly.`
      });
      res.json({ success: true, message: `Test email sent to ${testEmail}` });
    } else {
      res.json({ success: true, message: 'SMTP connection verified successfully.' });
    }
  } catch (err) {
    console.error('SMTP test failed:', err);
    res.status(400).json({ success: false, message: err.message || 'SMTP test failed.' });
  }
});

// ========== SFTP SYNC ENDPOINTS ==========

// Trigger a manual SFTP sync (admin only)
app.post('/api/saas/sync-trigger', requireAuth(['admin']), async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const requesterEmail = req.user?.email || 'unknown';
      const requesterName = req.user?.display_name || req.user?.email || 'unknown';
      const requesterId = req.user?.id || null;
      
      // Auto-cleanup: Delete sync records older than 30 days
      await client.query(`
        DELETE FROM sftp_sync_requests 
        WHERE requested_at < NOW() - INTERVAL '30 days'
      `);
      
      // Check if there's already a pending request in the last 5 minutes
      const recent = await client.query(`
        SELECT id FROM sftp_sync_requests 
        WHERE status IN ('pending', 'processing')
        AND requested_at > NOW() - INTERVAL '5 minutes'
        ORDER BY requested_at DESC 
        LIMIT 1
      `);
      
      if (recent.rows.length > 0) {
        return res.status(429).json({ 
          message: 'A sync request is already pending or processing from the last 5 minutes. Please wait before requesting another sync.' 
        });
      }
      
      // Insert new sync request
      const result = await client.query(`
        INSERT INTO sftp_sync_requests (requested_by, requester_email, requester_name, status, notes) 
        VALUES ($1, $2, $3, $4, $5) 
        RETURNING id, requested_at
      `, [
        requesterId, 
        requesterEmail,
        requesterName,
        SFTP_SYNC_METHOD === 'database' ? 'pending' : 'processing',
        req.body?.notes || 'Manual sync triggered from web interface'
      ]);
      
      const requestId = result.rows[0].id;
      
      // Handle different sync methods
      if (SFTP_SYNC_METHOD === 'direct') {
        // Call Windows web service directly
        try {
          console.log(`[SFTP Sync] Attempting direct sync to ${WINDOWS_SYNC_URL}`);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), SYNC_TIMEOUT);
          
          const windowsResponse = await fetch(WINDOWS_SYNC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              requestId, 
              requestedBy: requesterEmail,
              timestamp: new Date().toISOString()
            }),
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (!windowsResponse.ok) {
            const errorText = await windowsResponse.text().catch(() => 'No error details');
            throw new Error(`Windows service responded with status ${windowsResponse.status}: ${errorText}`);
          }
          
          const syncResult = await windowsResponse.json();
          console.log(`[SFTP Sync] Direct sync completed:`, syncResult);
          
          // Update database with success
          await client.query(`
            UPDATE sftp_sync_requests 
            SET status = 'completed', completed_at = NOW(), files_synced = $2
            WHERE id = $1
          `, [requestId, syncResult.filesCount || 0]);
          
          res.json({
            success: true,
            message: 'Sync completed successfully',
            requestId: requestId,
            filesCount: syncResult.filesCount || 0,
            method: 'direct'
          });
          
        } catch (syncError) {
          console.error(`[SFTP Sync] Direct sync failed:`, syncError);
          
          // Determine the specific error type
          let errorMessage = syncError.message;
          if (syncError.name === 'AbortError' || syncError.message.includes('aborted')) {
            errorMessage = `Sync request timed out after ${SYNC_TIMEOUT}ms. The Windows sync service may be unreachable at ${WINDOWS_SYNC_URL}`;
          } else if (syncError.message.includes('fetch failed') || syncError.message.includes('ECONNREFUSED') || syncError.message.includes('ENOTFOUND')) {
            errorMessage = `Cannot connect to Windows sync service at ${WINDOWS_SYNC_URL}. Please ensure the service is running and accessible.`;
          } else if (syncError.message.includes('ECONNRESET')) {
            errorMessage = `Connection to Windows sync service was reset. The service may have crashed or closed the connection.`;
          }
          
          // Update database with failure
          await client.query(`
            UPDATE sftp_sync_requests 
            SET status = 'failed', completed_at = NOW(), error_message = $2
            WHERE id = $1
          `, [requestId, errorMessage]);
          
          throw new Error(`Sync failed: ${errorMessage}`);
        }
        
      } else if (SFTP_SYNC_METHOD === 'file' && SYNC_TRIGGER_PATH) {
        // File-based trigger
        try {
          const fs = require('fs').promises;
          const path = require('path');
          
          const triggerData = {
            requestId,
            requestedBy: requesterEmail,
            requestedAt: new Date().toISOString()
          };
          
          await fs.writeFile(SYNC_TRIGGER_PATH, JSON.stringify(triggerData));
          
          // For file-based, we return immediately and let the scheduled script handle it
          res.json({
            success: true,
            message: 'Sync request submitted. The Windows service will process this shortly.',
            requestId: requestId,
            method: 'file'
          });
          
        } catch (fileError) {
          await client.query(`
            UPDATE sftp_sync_requests 
            SET status = 'failed', completed_at = NOW(), error_message = $2
            WHERE id = $1
          `, [requestId, `File trigger failed: ${fileError.message}`]);
          
          throw new Error(`Failed to create trigger file: ${fileError.message}`);
        }
        
      } else {
        // Database-only method (original approach)
        res.json({ 
          success: true, 
          message: 'Sync request submitted. The next scheduled sync (within 15 minutes) will process this request.',
          requestId: requestId,
          method: 'database',
          warning: 'This method requires waiting for the next scheduled sync cycle.'
        });
      }
      
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Failed to create sync request:', error);
    res.status(500).json({ 
      success: false,
      message: error.message || 'Failed to submit sync request.' 
    });
  }
});

// Get sync configuration info
app.get('/api/saas/config', requireAuth(), async (req, res) => {
  const config = {
    method: SFTP_SYNC_METHOD,
    immediateSync: SFTP_SYNC_METHOD !== 'database',
    description: {
      'direct': 'Immediate sync via Windows web service',
      'file': 'Immediate sync via file trigger',
      'database': 'Scheduled sync (up to 15 minute delay)'
    }[SFTP_SYNC_METHOD] || 'Unknown method',
    windowsSyncUrl: SFTP_SYNC_METHOD === 'direct' ? WINDOWS_SYNC_URL : null,
    syncTriggerPath: SFTP_SYNC_METHOD === 'file' ? SYNC_TRIGGER_PATH : null,
    syncTimeout: SYNC_TIMEOUT
  };
  
  console.log(`[SFTP Sync] Config requested:`, config);
  res.json(config);
});

// Get recent sync requests for status display
app.get('/api/saas/sync-history', requireAuth(), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const client = await pool.connect();
    try {
      // Auto-cleanup: Delete sync records older than 30 days
      await client.query(`
        DELETE FROM sftp_sync_requests 
        WHERE requested_at < NOW() - INTERVAL '30 days'
      `);
      
      const result = await client.query(`
        SELECT 
          id, 
          requested_at, 
          requester_email,
          requester_name,
          status, 
          completed_at, 
          error_message, 
          files_synced,
          notes
        FROM sftp_sync_requests 
        ORDER BY requested_at DESC 
        LIMIT $1
      `, [limit]);
      
      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Failed to fetch sync history:', error);
    res.status(500).json({ message: 'Failed to load sync history.' });
  }
});

// === AI Helper Chat ===
// Note: No auth required so users can get help even before logging in
app.post('/api/ai-helper/chat', async (req, res) => {
  if (!AI_HELPER_ENABLED || !aiClient) {
    return res.status(503).json({ message: 'AI Helper is not enabled' });
  }

  try {
    const { message, userRole, userName, conversationHistory } = req.body;
    if (!message) {
      return res.status(400).json({ message: 'Message is required' });
    }

    console.log('[AI Helper] Request body:', { message: message.substring(0, 50), userRole, userName });

    // Determine user level for context
    const role = userRole || 'user';
    const isAdmin = role === 'admin';
    const isBanking = role === 'banking' || isAdmin;
    const isReviewer = role === 'reviewer' || isAdmin;
    const levelText = isAdmin ? 'Level 4 Administrator' : (role === 'reviewer' ? 'Level 3 Reviewer' : (role === 'banking' ? 'Level 2 Banking' : 'Level 1 User'));

    console.log('[AI Helper] Computed context:', { role, levelText, isAdmin, isReviewer, isBanking });

    // Quick answers for common questions (bypass LLM for accuracy)
    const lowerMsg = message.toLowerCase().trim();
    console.log('[AI Helper v2] Received message:', message, '| Length:', lowerMsg.length);
    
    // Conversational acknowledgments only - let LLM handle all real questions
    const acknowledgments = ['thanks', 'thank you', 'cheers', 'ta', 'thx', 'appreciate'];
    const okPhrases = ['ok', 'okay', 'got it', 'cool', 'great', 'perfect', 'alright', 'nice', 'awesome', 'fantastic', 'lovely'];
    
    // Check if message is just an acknowledgment
    const hasAck = acknowledgments.some(ack => lowerMsg.includes(ack));
    const hasOk = okPhrases.some(ok => lowerMsg.includes(ok));
    const isQuestion = lowerMsg.includes('?') || lowerMsg.includes('how') || lowerMsg.includes('what') || lowerMsg.includes('where') || lowerMsg.includes('when') || lowerMsg.includes('why');
    
    console.log('[AI Helper] hasAck:', hasAck, '| hasOk:', hasOk, '| isQuestion:', isQuestion);
    
    // If it has acknowledgment words, is short, and is NOT a question, respond with welcome
    if ((hasAck || hasOk) && lowerMsg.length < 50 && !isQuestion) {
      console.log('[AI Helper] ✓ Acknowledgment confirmed, returning welcome message');
      return res.json({ reply: 'You\'re welcome! Let me know if you need anything else.' });
    }
    
    // Fast-path: Password change/reset guidance
    const isSignedIn = !!req.headers.authorization;
    const pwdTriggers = ['password', 'reset', 'change', 'forgot', 'forgotten'];
    const mentionsPassword = pwdTriggers.some(t => lowerMsg.includes(t));
    if (mentionsPassword) {
      let answer;
      const mentionsOtherUser = lowerMsg.includes('user') || lowerMsg.includes('someone') || lowerMsg.includes('other');
      if (mentionsOtherUser && isAdmin) {
        answer = 'Admin tab: User Accounts → Find user → Reset Password → Send link. For your own password use the top bar Change Password button.';
      } else if (isSignedIn && (lowerMsg.includes('change') || lowerMsg.includes('update'))) {
        answer = 'Top bar: Click Change Password (next to Sign Out) → Enter current password → Enter new password → Update Password.';
      } else if (lowerMsg.includes('forgot') || lowerMsg.includes('forgotten') || lowerMsg.includes('reset')) {
        answer = 'Sign in page: Click Forgot password? → Enter your email → Check inbox for link → Set new password.';
      } else {
        answer = isSignedIn
          ? 'Top bar: Click Change Password (next to Sign Out) → Enter current password → Enter new password → Update Password.'
          : 'Sign in page: Click Forgot password? → Enter your email → Check inbox for link → Set new password.';
      }
      // Trim to ~50 words
      const words = answer.split(/\s+/);
      if (words.length > 50) answer = words.slice(0, 50).join(' ');
      return res.json({ reply: answer });
    }

    // Fast-path: Export / Excel questions (override LLM to ensure precise workflow)
    const exportTriggers = ['export', 'excel', 'spreadsheet', 'csv', 'xlsx', 'xls'];
    const mentionsExport = exportTriggers.some(t => lowerMsg.includes(t));
    if (mentionsExport) {
      // Determine correct path based on role and ownership assumption
      let answer;
      if (isReviewer) {
        answer = 'Reviewer tab: Retrieve batch → Open in Reader → Load into Generator → Export Filtered CSV (opens in Excel; Save As .xlsx if needed). If you own it: My Batches → Open in Reader → Load → Export Filtered CSV.';
      } else {
        // Non-reviewer (user/banking) only can export their own via My Batches
        answer = 'My Batches: Open batch in Reader → Load into Generator → Export Filtered CSV (opens in Excel; Save As .xlsx if needed). For other user batches ask a reviewer/admin to export.';
      }
      // Enforce formatting rules (max 50 words, start with tab mention)
      // Ensure starts with tab location
      if (!answer.toLowerCase().startsWith('my batches') && !answer.toLowerCase().startsWith('reviewer tab')) {
        answer = (isReviewer ? 'Reviewer tab: ' : 'My Batches: ') + answer;
      }
      // Trim to ~50 words
      const words = answer.split(/\\s+/);
      if (words.length > 50) {
        answer = words.slice(0, 50).join(' ');
      }
      console.log('[AI Helper] ✓ Fast-path export answer');
      return res.json({ reply: answer });
    }

    // Fast-path: Manual copy to Excel guidance
    if (lowerMsg.includes('copy') && lowerMsg.includes('excel')) {
      let answer = 'Generator tab: Click in the table, press Ctrl+A then Ctrl+C, paste into Excel. Better: use Export Filtered CSV which opens directly in Excel, then Save As .xlsx if needed.';
      // Trim to ~50 words
      const words = answer.split(/\\s+/);
      if (words.length > 50) answer = words.slice(0, 50).join(' ');
      console.log('[AI Helper] ✓ Fast-path manual copy answer');
      return res.json({ reply: answer });
    }

    console.log('[AI Helper] Not an acknowledgment, passing to LLM');

    const systemPrompt = `You are a helpful assistant for the RON ABA Generator & Review System used by Nauru Treasury. Be conversational and friendly while staying concise.

CURRENT USER CONTEXT (THIS IS WHO YOU ARE TALKING TO RIGHT NOW):
- User: ${userName || 'Guest'}
- Role: ${levelText} (${role})
- Can access Banking tab: ${isBanking ? 'Yes' : 'No (Level 2+ required)'}
- Can access SaaS tab: ${isReviewer ? 'Yes' : 'No (Level 3+ required)'}
- Can access Reviewer tab: ${isReviewer ? 'Yes' : 'No (Level 3+ required)'}
- Can access Admin tab: ${isAdmin ? 'Yes' : 'No (Level 4 required)'}

IMPORTANT: When user asks "can I access X?" check THEIR role above. If they HAVE access (says "Yes"), tell them how to use it - do NOT tell them to contact admin!

CONVERSATION RULES:
1. Stay focused on the current topic - if user says "delete it" or "clear them", refer back to what they were just asking about
2. Don't switch topics unless the user explicitly asks about something different
3. Remember the conversation context and answer follow-up questions about the SAME topic

CRITICAL FORMATTING RULES - FOLLOW EXACTLY:
1. NO MARKDOWN: No asterisks, no bold, no italics, plain text only
2. Use Australian English: authorise, recognise, colour, centre (not -ize, -ize, color, center)
3. Be conversational: Use "you can" instead of robotic instructions
4. ALWAYS mention permission requirements clearly and consistently
5. If user asks about access, confirm what tabs THEY can see based on their role
3. Maximum 50 words total (strictly enforce)
4. Start with tab location in first 3 words
5. Use numbered lists (1. 2. 3. 4.) with NO sub-items, max 4 steps
6. Use dash bullets (-) with NO nesting
7. Each step ONE action only
8. NO headers, NO section titles, NO extra notes

SYSTEM KNOWLEDGE:

ROLES & PERMISSIONS:
- Level 1 (User/Submitter): Create and submit ABA batches, view own batches, use Reader
- Level 2 (Banking): All Level 1 access + Banking tab (CSV to BAI2, BAI2 File Check)
- Level 3 (Reviewer): All Level 2 access + Reviewer tab, SaaS sync, Archives (view/download approved files), can approve/reject batches
- Level 4 (Administrator): All access + Admin tab, can DELETE ANY batch from Archives (any status: Draft, Submitted, Rejected, Approved), manage users/presets/blacklist

TABS AVAILABLE:
- Generator: Build ABA files from credit transactions. Choose preset, add transactions, fix validations, submit (All users)
- My Batches: View YOUR batches (Draft, Submitted, Rejected, Approved). Can delete drafts, load rejected batches into Generator to fix and resubmit (All users)
- Reader: Open EXTERNAL ABA files from your computer to view details (header, transactions, duplicates, totals). Can load transactions into Generator to edit and submit as new batch (All users)
- Banking: Convert CSV to BAI2, validate BAI2 files. "BAI2 File Check" menu for troubleshooting bank statement files (Level 2+)
- SaaS: SFTP file sync - automatic every 15 minutes, manual "Sync Now" button, view sync history (Level 3+)
- Reviewer: Retrieve batches by code/PD, inspect details, approve or reject. Download ABA ONLY works after approving (Level 3+)
- Archives: Search ALL batches (any status). Level 4 Administrators can DELETE any batch regardless of status (Draft, Submitted, Rejected, Approved). Level 3 can view/download approved files only (Level 3+ view/download, Level 4 delete any)
- Admin: Manage user accounts, presets (CBA-RON etc), blacklist (blocked accounts) (Level 4 only)

KEY WORKFLOWS:

Creating & Submitting a Batch:
1. Generator tab → Choose header preset (CBA-RON, CBA-Agent, etc.) - presets auto-fill FI, APCA, balancing account
2. Add credit transactions: BSB (NNN-NNN format), Account (5-9 digits), Amount, Lodgement Ref, Account Title
3. Fix any warnings: blocked accounts (must remove or ask admin to unblock), missing lodgement refs, review duplicates
4. Click "Generate ABA File" → Opens submission modal showing totals, duplicates summary, validation checks
5. Enter PD number (6 digits, must be unique), preparer name, department (if not auto-filled), optional notes
6. Submit → Batch gets code (e.g. 12-2024030101), stored for reviewers, you get email if rejected/approved

Resubmitting Rejected Batch:
1. My Batches tab → Find rejected batch (shows reviewer comments)
2. Click "Load into Generator" → Credits loaded back into Generator
3. Fix issues mentioned in reviewer comments
4. Generate and submit again (links to original batch via root_batch_id)

Reviewing & Approving (Level 3+ Reviewer):
1. Reviewer tab → Enter batch code or PD number in Retrieve form
2. View shows: header, transactions, duplicates, control totals, bank preset, submitter details
3. Inspect transactions - check for blocked accounts, duplicates, missing refs, totals match
4. Make decision:
   - Approve: Unlocks Download ABA button, moves to approved, preserves file for download
   - Reject: Requires comment, sends back to submitter (triggers email), submitter can fix and resubmit
   - Note Only: Add internal comment without changing stage
5. Download ABA: Button active ONLY after approval - download to deliver to bank

Archives (Level 3+ view/download, Level 4 delete ANY status):
- Shows ALL batches regardless of status (Draft, Submitted, Rejected, Approved)
- Search by code or PD number
- Download ABA: Only for approved batches
- Delete: ONLY Level 4 Administrators can delete batches - CAN delete batches of ANY status (Draft, Submitted, Rejected, Approved)
- Copy: Copy batch code to clipboard

Banking & BAI2 (Level 2+):
- CSV to BAI2: Convert bank statement CSV to BAI2 format with sender/receiver IDs, account config
- BAI2 File Check: Upload BAI2 file downloaded from internet banking to check for errors and validate format

Admin Functions (Level 4 only):
- User Accounts: Create users/reviewers/admins, assign departments (2-digit FMIS code), toggle notifications, reset passwords
- Blacklist: Add/remove blocked BSB/Account pairs - blocked accounts prevent batch submission
- Presets: Manage header presets (FI, APCA, trace account, balancing account for debits)
- Archives: Full delete permission

VALIDATIONS & ERRORS:

Blocked Accounts:
- What: Closed bank accounts in admin blacklist - payments will be REJECTED by bank
- Error: "Blocked account detected" - cannot submit with blocked accounts
- Fix: Remove transaction from batch OR ask Level 4 admin to unblock in Admin tab → Blacklist (only if account should be allowed)

Missing Lodgement Reference:
- What: Empty lodgement ref field on transaction
- Error: Modal lists rows missing lodgement ref
- Fix: Fill in lodgement reference for all transactions before submitting

Duplicate PD Number:
- What: PD number already used in previous submitted batch
- Error: "PD has already been used" in submission modal
- Fix: Choose unique PD number (or contact admin if PD should be reused for special case)

Duplicate Transactions:
- What: Same BSB, Account, Amount, Lodgement Ref in multiple transactions
- Shown: Duplicate summary in submission modal, "dup" badge in Reader
- Action: Confirm duplicates are intended (e.g. repeated payroll) or remove/fix

Download Disabled in Reviewer:
- Reason: Batch not yet approved
- Fix: Approve batch first → Download button becomes active

Can't Edit Submitted Batch:
- Reason: Submitted batches are read-only
- Fix: Ask reviewer to reject batch → Load from My Batches into Generator → Fix and resubmit

COMMON SCENARIOS:

Q: "What does the Reader tab do?"
A: Reader tab lets you open ABA files stored on your computer to view their contents (header, transactions, duplicates, totals). You can then load those transactions into Generator to edit and submit as a new batch.

Q: "How do I know what bank account an ABA file charges to?"
A: Reader tab → Open ABA file → Check "Bank Account Preset" (e.g., CBA-RON) and "Account" (shows BSB and account number for balancing debit). Available to all users.

Q: "Why can't I download ABA in Reviewer tab?"
A: Download button only active for approved batches. Approve batch first, then Download becomes available.

Q: "How do I export a batch to Excel?"
A: ${isReviewer ? 'If YOU own the batch: My Batches → Open in Reader → Load into Generator → Export Filtered CSV. If you are reviewing another batch: Reviewer tab → Retrieve → Open in Reader → Load into Generator → Export Filtered CSV.' : 'If you created the batch: My Batches → Open in Reader → Load into Generator → Export Filtered CSV. For other user batches ask a reviewer/admin (Level 3+) to open via Reviewer tab and export.'}

Q: "Can Excel open the CSV I export?"
A: Yes. Export Filtered CSV opens directly in Excel. After opening, choose Save As and pick Excel Workbook (.xlsx) if you need native Excel format.

Q: "Can I delete batches from Archives?"
A: ${isAdmin ? 'Yes, Level 4 admins can delete ANY batch from Archives regardless of status (Draft, Submitted, Rejected, Approved). Search for batch → Select → Delete.' : 'Only Level 4 administrators can delete from Archives. Level 3 can view and download.'}

Q: "How do I clear/delete archive batches?"
A: ${isAdmin ? 'Archives tab → Search for batch → Select → Click Delete button. You can delete batches of any status (Draft, Submitted, Rejected, Approved).' : 'Only Level 4 administrators can delete from Archives. Contact your administrator if needed.'}

Q: "Can I delete unapproved batches?"
A: ${isAdmin ? 'Yes, Level 4 admins can delete batches of ANY status including unapproved (Draft, Submitted, Rejected). Archives tab → Search → Select → Delete.' : 'Only Level 4 administrators can delete batches. Contact your administrator.'}

Q: "How do I reuse an existing batch to submit a new ABA file?"
A: My Batches tab → Find the batch you want to reuse → Click "Open in Reader" → Click "Load into Generator" → Make changes if needed → Submit as new batch.

Q: "How do I sync SaaS folders?"
A: ${isReviewer ? 'SaaS tab → Click "Sync Now" button for manual sync. Automatic sync runs every 15 minutes. View recent sync history below.' : 'SaaS sync requires Level 3+ access. Contact your administrator.'}

Q: "How do I check/troubleshoot BAI2 file?"
A: ${isBanking ? 'Banking tab → BAI2 File Check menu → Upload your BAI2 file → System checks for errors and validates format.' : 'BAI2 File Check requires Level 2+ access (Banking role). Contact your administrator.'}

Q: "Can I create users?"
A: ${isAdmin ? 'Admin tab → User Management → Add New User → Fill details, assign role (user/banking/reviewer/admin), set department.' : 'Only Level 4 administrators can create users. Contact your administrator.'}

Q: "How do I unblock an account?"
A: ${isAdmin ? 'Admin tab → Blacklist → Find blocked account → Click Remove/Unblock.' : 'Only Level 4 administrators can unblock accounts. Contact your administrator with BSB and account number.'}

EMAIL NOTIFICATIONS:
- Rejected batch: Submitter receives email with reviewer comments
- Approved batch: May receive email if enabled by reviewer/admin
- Password reset: Email sent with reset link
- Support: fmis@finance.gov.nr

FORMATTING RULES:
1. Write in NATURAL PARAGRAPHS like normal conversation - NO bullet points, NO lists unless steps are required
2. NO MARKDOWN: Plain text only, no asterisks, no bold, no italics
3. Australian English: authorise (not authorize), recognise (not recognize), colour, centre
4. Maximum 50 words per response
5. Start with tab location in first 3 words when directing to features
6. Only use numbered lists (1. 2. 3.) for sequential steps, max 4 steps
7. Stay conversational and friendly`;

    let modelName;
    if (AI_PROVIDER === 'ollama') {
      modelName = OLLAMA_MODEL;
    } else if (AI_PROVIDER === 'github') {
      modelName = GITHUB_MODEL;
    } else {
      modelName = 'gpt-3.5-turbo'; // OpenAI default
    }
    
    console.log(`[AI Helper] Model: ${modelName}, Provider: ${AI_PROVIDER}, Message: "${message.substring(0, 50)}..."`);
    
    // Build messages array with conversation history
    const messages = [{ role: 'system', content: systemPrompt }];
    
    // Add conversation history if provided (limit to last 6 messages to stay within token limits)
    if (conversationHistory && Array.isArray(conversationHistory)) {
      const recentHistory = conversationHistory.slice(-6);
      messages.push(...recentHistory);
    }
    
    // Add current user message
    messages.push({ role: 'user', content: message });
    
    console.log(`[AI Helper] Conversation context: ${messages.length} messages (including system prompt)`);
    
    const completion = await aiClient.chat.completions.create({
      model: modelName,
      messages: messages,
      temperature: 0.1,
      max_tokens: 120
    });

    console.log('[AI Helper] Completion object keys:', Object.keys(completion));
    console.log('[AI Helper] Choices:', completion.choices?.length, 'choices');
    console.log('[AI Helper] First choice:', JSON.stringify(completion.choices?.[0]));

    // Cloud models may return reasoning instead of content
    const choice = completion.choices[0];
    let reply = choice?.message?.content || choice?.message?.reasoning || 'Sorry, I could not generate a response.';
    console.log(`[AI Helper] Response length: ${reply.length} chars, content: "${reply.substring(0, 100)}..."`);
    
    // Aggressive formatting cleanup
    reply = reply
      .replace(/\\*\\*([^*]+)\\*\\*/g, '$1')  // Remove bold **text**
      .replace(/\\*([^*]+)\\*/g, '$1')      // Remove italic *text*
      .replace(/^#{1,6}\\s+/gm, '')        // Remove markdown headers
      .replace(/^[-•]\\s+/gm, '')          // Remove bullet points (- or •)
      .replace(/\\n\\n+/g, ' ')             // Replace multiple newlines with space for paragraph flow
      .replace(/\\n{3,}/g, '\\n\\n')         // Collapse multiple newlines
      .replace(/^[-*]\\s+/gm, '- ')        // Normalise bullet points
      .trim();
    
    res.json({ reply });

  } catch (error) {
    console.error('[AI Helper] Error details:', {
      message: error.message,
      code: error.code,
      type: error.type,
      stack: error.stack?.split('\\n')[0]
    });
    res.status(500).json({ message: 'Failed to get AI response', error: error.message });
  }
});

initSchema()
  .then(async () => {
    try {
      await bootstrapDefaultAdmin();
    } catch (err) {
      console.error('Failed to bootstrap default admin', err);
    }
    try {
      await refreshTestingModeSetting();
    } catch (err) {
      console.error('Failed to initialize testing mode state', err);
    }
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`RON ABA backend listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server', err);
    process.exit(1);
  });

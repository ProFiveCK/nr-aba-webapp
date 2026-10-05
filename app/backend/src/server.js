import express from 'express';
import cors from 'cors';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import { body, param, query } from 'express-validator';
import { handleValidation } from './middleware/validation.js';
import { pool, initSchema } from './db.js';
import dotenv from 'dotenv';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import OpenAI from 'openai';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { setTestingMode } from './services/notificationService.js';
import { runDueLeaveAccruals } from './services/leaveAccrual.js';
import { LOCK_KEYS, withAdvisoryLock } from './lib/advisoryLock.js';
import { amendValueDate, parseAbaFile } from './lib/abaFile.js';
import { ServiceError } from './lib/serviceError.js';
import { findPdConflict } from './lib/pdNumber.js';
import {
  buildCookieParser,
  buildTokenPayload,
  clearAuthCookie,
  createSession,
  csrfGuard,
  generateTempPassword,
  hashPassphrase,
  invalidateSession,
  isLegacyPassphraseHash,
  legacyHashPassphrase,
  loadCapabilities,
  lookupSession,
  parsePermissions,
  requireAuth,
  resolveAllowedBankPresets,
  reviewerAllowedPresets,
  reviewerSummary,
  setAuthCookie,
  setCapabilities,
} from './services/authService.js';
import { recordAudit } from './services/auditService.js';
import {
  buildBlacklistKey,
  decodeBase64File,
  formatBatchCode,
  lowerEmail,
  normalizeAccountNumber,
  normalizeAccountNumber as normalizeSupplierAccount,
  normalizeBsb,
  normalizeBsb as normalizeSupplierBsb,
} from './utils/helpers.js';
import {
  enableAsyncErrors,
  errorHandler,
  installProcessGuards,
  notFoundHandler,
} from './middleware/errors.js';
import {
  GoogleSignInResult,
  googleSignInEnabled,
  resolveGoogleIdentity,
} from './services/googleAuthService.js';
import { clearLoginAttempts, isAccountLocked, recordLoginAttempt } from './services/loginAttempts.js';
import {
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
} from './services/mailService.js';
import {
  ACCOUNT_ROLES,
  ACCOUNT_STATUSES,
  ADMIN_ARCHIVE_LIMIT_DEFAULT,
  AUTH_LOCKOUT_WINDOW_MS,
  AUTH_MAX_FAILED_ATTEMPTS,
  PASSWORD_MIN_LENGTH,
  ALL_CAPABILITIES,
  BANK_PRESET_KEYS,
  BATCH_WORKFLOW_TYPES,
  SIGNUP_APPS,
  SIGNUP_APP_IDS,
  capabilitiesForApps,
  CAPABILITY_CATALOGUE,
  ROLE_CAPABILITIES,
  BSB_REGEX,
  COOKIE_NAME,
  DEFAULT_BANK_PRESETS,
  EXCEL_MIME_TYPES,
  FRONTEND_BASE_URL,
  GOOGLE_CLIENT_ID,
  JWT_SECRET,
  PASS_HASH_ROUNDS,
  PAYROLL_ACCESS_ROLES,
  PAYROLL_MAX_FILE_BYTES,
  PAYROLL_PYTHON_BIN,
  REPLY_TO,
  REVIEW_ACCESS_ROLES,
  REVIEWER_ARCHIVE_LIMIT_DEFAULT,
  SESSION_MINUTES,
  SIGNUP_ROLES,
  SMTP_FROM,
  SMTP_HOST,
  SMTP_PASS,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  TEMP_PASSWORD_LENGTH,
  UUID_REGEX,
  WORKFLOW_GUIDE_TEXT,
  isProd,
  workflowStageTransitions,
} from './config.js';

dotenv.config();

// The in-process accrual scheduler, on unless a deployment drives it from cron.
const ACCRUAL_SCHEDULER_ENABLED = (process.env.ACCRUAL_SCHEDULER || 'on').toLowerCase() !== 'off';

// Express 4 drops a rejected promise from an async handler on the floor: the
// request hangs and nothing is logged. `enableAsyncErrors()` routes those to
// the error handler at the bottom of the middleware stack instead.
//
// It works by patching the route-registration methods, so it has to run before
// any route is registered. The routes in this file are registered further down,
// but a router registers its own while its module is evaluated — which for a
// static `import` is before this line. The routers are therefore loaded
// here, after the patch. Add new routers to this block, not to the imports
// above.
enableAsyncErrors();
installProcessGuards();

const [
  { default: forexTTRouter },
  { default: healthRouter },
  { default: publicHealthRouter },
  { default: hrRouter },
  { default: authRouter },
  { default: adminRouter },
] = await Promise.all([
  import('./routes/forexTT.js'),
  import('./routes/health.js'),
  import('./routes/public-health.js'),
  import('./routes/hr.js'),
  import('./routes/auth.js'),
  import('./routes/admin.js'),
]);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');
const PAYROLL_SCRIPT_PATH = process.env.PAYROLL_SCRIPT_PATH || path.join(REPO_ROOT, 'scripts', 'reformat_payroll.py');

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
// SFTP Sync Configuration
const SFTP_SYNC_METHOD = process.env.SFTP_SYNC_METHOD || 'database'; // 'direct', 'file', or 'database'
// Default to host.docker.internal for Docker containers (Windows/Mac), fallback to localhost for Linux native
const WINDOWS_SYNC_URL = process.env.WINDOWS_SYNC_URL || 'http://host.docker.internal:8088/sync-trigger';
const SYNC_TRIGGER_PATH = process.env.SYNC_TRIGGER_PATH || null; // For file-based approach
const SYNC_TIMEOUT = Number(process.env.SYNC_TIMEOUT || 30000); // 30 seconds

// File handling: ABA files are uploaded as base64 JSON payloads; FOREX TT uses multipart.
// SSRF protection for the Windows sync service. The URL is env-configured (admin-gated endpoint),
// but we validate the resolved host against an allowlist before issuing any request to prevent
// the server being used to reach internal metadata/loopback endpoints.
// Allowed hosts come from SYNC_ALLOWED_HOSTS (comma-separated). Defaults to the sync host itself.
const SYNC_ALLOWED_HOSTS = String(process.env.SYNC_ALLOWED_HOSTS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// Private/loopback IPv4 ranges and cloud metadata endpoints we always block.
const BLOCKED_IP_PATTERNS = [
  /^127\./,                        // loopback
  /^10\./,                         // private
  /^192\.168\./,                   // private
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // private
  /^169\.254\./,                   // link-local / metadata (AWS/GCP/Azure)
  /^0\./,                          // 0.0.0.0/8
];

function isBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  // IPv6 loopback and metadata
  if (host === '::1' || host === '::' || host === '[::1]' || host === 'metadata.google.internal') return true;
  // Allowlist takes precedence if configured
  if (SYNC_ALLOWED_HOSTS.length && SYNC_ALLOWED_HOSTS.includes(host)) return false;
  // Block RFC1918 / loopback / metadata by default
  if (BLOCKED_IP_PATTERNS.some((re) => re.test(host))) return true;
  // host.docker.internal is a Docker alias to the host — allow it only when explicitly allowlisted
  if (host === 'host.docker.internal') return SYNC_ALLOWED_HOSTS.includes(host) ? false : true;
  return false;
}

async function safeFetchSyncUrl(url, init) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('WINDOWS_SYNC_URL is not a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('WINDOWS_SYNC_URL must use http or https.');
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`WINDOWS_SYNC_URL host "${parsed.hostname}" is blocked by SSRF protection. Add it to SYNC_ALLOWED_HOSTS if it is legitimate.`);
  }
  return fetch(url, init);
}

const app = express();

// Trust the nginx reverse proxy so X-Forwarded-For is used safely by express-rate-limit
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
}));

// CORS: restrict to configured frontend origin
const corsOrigin = FRONTEND_BASE_URL;
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(buildCookieParser());

// Allow larger payloads for ABA uploads (base64 inflates size by ~33%)
app.use(express.json({ limit: '10mb' }));
app.use(csrfGuard(corsOrigin));

// Rate limiting: general API
// Skip /api/auth/* so authentication endpoints are governed only by the
// per-account authLimiter. This prevents a busy shared office IP from
// blocking staff login/signon/password-reset requests.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please try again later.' },
  skip: (req) => req.path.startsWith('/auth/'),
});
app.use('/api', generalLimiter);

// Rate limiting: authentication endpoints, twice over.
// Per account: a brute-force attempt on one account cannot lock out everyone
// behind the same office gateway. Per address: one address cannot spray a
// common password across many accounts, which the per-account limit never
// sees. The address limit is generous because staff share a NAT.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: true,
  message: { message: 'Too many authentication attempts for this account. Please try again later.' },
  skipSuccessfulRequests: true, // successful logins reset the in-memory attempt budget
  keyGenerator: (req) => {
    const email = String(req.body?.email || '').toLowerCase().trim();
    return email ? `email:${email}` : `ip:${ipKeyGenerator(req.ip)}`;
  },
});
const authIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many sign-in attempts from your network. Please try again later.' },
  skipSuccessfulRequests: true,
});
for (const route of ['login', 'google', 'signup', 'forgot-password', 'reset-password']) {
  app.use(`/api/auth/${route}`, authIpLimiter, authLimiter);
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.use('/api/forex-tt', forexTTRouter);
app.use('/api/public-health', publicHealthRouter);
app.use('/api/hr', hrRouter);
app.use('/api', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api', adminRouter);

app.post(
  '/api/payroll/reformat',
  requireAuth(PAYROLL_ACCESS_ROLES),
  [
    body('file_name').isString().trim().isLength({ min: 1, max: 255 }),
    body('file_data').isString().trim().notEmpty(),
    body('mime_type').optional({ nullable: true }).isString().isLength({ min: 1, max: 255 })
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;

    const fileName = sanitizePayrollFileName(req.body.file_name);
    const mimeType = req.body.mime_type || null;
    const extension = path.extname(fileName).toLowerCase();

    if (!['.xlsx', '.xls'].includes(extension)) {
      res.status(400).json({ message: 'Unsupported file type. Upload an Excel workbook (.xls or .xlsx).' });
      return;
    }

    if (mimeType && !EXCEL_MIME_TYPES.has(mimeType)) {
      res.status(400).json({ message: 'Unsupported file type. Upload an Excel workbook.' });
      return;
    }

    let inputBuffer;
    try {
      inputBuffer = decodeBase64File(req.body.file_data);
    } catch (_err) {
      res.status(400).json({ message: 'Invalid file upload payload.' });
      return;
    }

    if (!inputBuffer.length) {
      res.status(400).json({ message: 'Please upload a non-empty Excel file.' });
      return;
    }

    if (inputBuffer.length > PAYROLL_MAX_FILE_BYTES) {
      res.status(400).json({ message: 'The uploaded file is too large. Maximum size is 10 MB.' });
      return;
    }

    // Validate file magic bytes — do not trust the client-supplied extension/MIME alone.
    // .xlsx/.xlsb/.xlsm are ZIP-based (PK\x03\x04); .xls is OLE2 (D0 CF 11 E0 A1 B1 1A E1).
    const magic = inputBuffer.subarray(0, 8);
    const isZip = magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x03 && magic[3] === 0x04;
    const isOle =
      magic[0] === 0xd0 && magic[1] === 0xcf && magic[2] === 0x11 && magic[3] === 0xe0 &&
      magic[4] === 0xa1 && magic[5] === 0xb1 && magic[6] === 0x1a && magic[7] === 0xe1;
    if (extension === '.xlsx' && !isZip) {
      res.status(400).json({ message: 'File content does not match a .xlsx workbook (expected ZIP container).' });
      return;
    }
    if (extension === '.xls' && !isOle && !isZip) {
      res.status(400).json({ message: 'File content does not match a .xls workbook (expected OLE2 or ZIP container).' });
      return;
    }
    if (!isZip && !isOle) {
      res.status(400).json({ message: 'Unrecognized file format. Upload a valid Excel workbook.' });
      return;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'payroll-reformat-'));
    const inputPath = path.join(tempDir, fileName);
    const outputPath = path.join(tempDir, buildPayrollOutputName(fileName));

    try {
      await fs.writeFile(inputPath, inputBuffer);
      await runPayrollScript(inputPath, outputPath);

      let outputBuffer;
      try {
        outputBuffer = await fs.readFile(outputPath);
      } catch (_err) {
        res.status(500).json({ message: 'Payroll processing did not produce an output file.' });
        return;
      }

      res.json({
        file_name: path.basename(outputPath),
        mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        file_data: outputBuffer.toString('base64')
      });
    } catch (err) {
      console.error('Payroll reformat failed', err);
      res.status(500).json({
        message: err instanceof Error && err.message
          ? err.message
          : 'Payroll processing failed.'
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
);

function sanitizePayrollFileName(name) {
  return path.basename(String(name).trim() || 'payroll.xlsx');
}

function buildPayrollOutputName(fileName) {
  const ext = path.extname(fileName) || '.xlsx';
  const stem = path.basename(fileName, ext);
  return `${stem} - Reformatted.xlsx`;
}

async function runPayrollScript(inputPath, outputPath) {
  try {
    await fs.access(PAYROLL_SCRIPT_PATH);
  } catch (_err) {
    throw new Error('Payroll script is not available on the server.');
  }

  await new Promise((resolve, reject) => {
    const child = spawn(
      PAYROLL_PYTHON_BIN,
      [PAYROLL_SCRIPT_PATH, '--input', inputPath, '--output', outputPath],
      { cwd: REPO_ROOT }
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      reject(new Error(`Unable to start payroll processor: ${err.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
      reject(new Error(details || `Payroll processor exited with code ${code}.`));
    });
  });
}

// True when the payload transactions (what reviewers are shown) and the ABA
// file's credit lines (what the bank pays) are the same payments, in any order.
function sameCredits(payloadTransactions, fileCredits) {
  const key = (bsb, account, cents) => `${buildBlacklistKey(bsb, account)}|${cents}`;
  const fromPayload = payloadTransactions
    .map((tx) => key(tx?.bsb, tx?.account, Math.round(Number.parseFloat(String(tx?.amount)) * 100)))
    .sort();
  const fromFile = fileCredits.map((c) => key(c.bsb, c.account, c.cents)).sort();
  return fromPayload.length === fromFile.length && fromPayload.every((k, i) => k === fromFile[i]);
}

// The first credit line paying a blacklisted account or BSB, with its entry.
async function findBlacklistedCredit(fileCredits) {
  const { rows } = await pool.query(
    'SELECT bsb, account, all_accounts, label FROM blacklist_entries WHERE active = TRUE'
  );
  for (const credit of fileCredits) {
    const entry = rows.find((row) => (row.all_accounts
      ? normalizeBsb(row.bsb) === normalizeBsb(credit.bsb)
      : buildBlacklistKey(row.bsb, row.account) === buildBlacklistKey(credit.bsb, credit.account)));
    if (entry) return { credit, entry };
  }
  return null;
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

async function fetchArchivesPage({ includeHistory = false, limit, offset = 0, search = '' }) {
  const requested = Number.isFinite(limit) ? limit : REVIEWER_ARCHIVE_LIMIT_DEFAULT;
  const clampedLimit = Math.max(1, Math.min(requested, ADMIN_ARCHIVE_LIMIT_MAX));
  const clampedOffset = Math.max(0, Number.isFinite(offset) ? offset : 0);
  const trimmedSearch = String(search || '').trim();
  const params = [clampedLimit, clampedOffset];
  const where = ['deleted_at IS NULL'];
  if (!includeHistory) {
    where.push('from_history = FALSE');
  }
  if (trimmedSearch) {
    params.push(`%${trimmedSearch.toLowerCase()}%`);
    const searchParam = `$${params.length}`;
    where.push(`
      LOWER(CONCAT_WS(' ',
        code,
        pd_number,
        department_code,
        submitted_email,
        stage,
        transactions->>'prepared_by'
      )) LIKE ${searchParam}
    `);
  }
  const whereSql = where.join(' AND ');
  const countWhereSql = trimmedSearch ? whereSql.replace(/\$3/g, '$1') : whereSql;
  const countParams = trimmedSearch ? [params[2]] : [];
  const baseFrom = `FROM combined_batch_archives WHERE ${whereSql}`;
  const [{ rows }, countResult] = await Promise.all([
    pool.query(
      `SELECT code, root_batch_id, department_code, file_name, checksum, transactions, created_at,
              stage, stage_updated_at, pd_number, submitted_email, submitted_by, is_draft,
              archived_at, from_history
         ${baseFrom}
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2`,
      params
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM combined_batch_archives WHERE ${countWhereSql}`, countParams)
  ]);
  const total = Number(countResult.rows[0]?.total || 0);
  return {
    items: rows,
    total,
    limit: clampedLimit,
    offset: clampedOffset,
    hasMore: clampedOffset + rows.length < total,
  };
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

// Creates the first administrator on a fresh install, from DEFAULT_ADMIN_*.
// Only while there is no active administrator at all, so deleting or renaming
// the account later never brings it back, and never with a guessable password.
async function bootstrapDefaultAdmin() {
  const email = lowerEmail(process.env.DEFAULT_ADMIN_EMAIL);
  const password = process.env.DEFAULT_ADMIN_PASSWORD;
  if (!email || !password) return;

  const { rows: admins } = await pool.query(
    "SELECT 1 FROM reviewers WHERE role = 'admin' AND status = 'active' LIMIT 1"
  );
  if (admins.length) return;

  const weak = ['change_me_on_first_login', 'Admin123!'].includes(password) || password.length < PASSWORD_MIN_LENGTH;
  if (weak) {
    console.error(`No administrator exists, and DEFAULT_ADMIN_PASSWORD is a known default or shorter than ${PASSWORD_MIN_LENGTH} characters, so none was created. Set a strong one in .env.prod and restart.`);
    return;
  }

  const displayName = process.env.DEFAULT_ADMIN_NAME || 'Admin';
  const hash = await bcrypt.hash(password, PASS_HASH_ROUNDS);
  await pool.query(
    `INSERT INTO reviewers (email, display_name, role, status, password_hash, must_change_password, department_code, notify_on_submission)
     VALUES ($1, $2, 'admin', 'active', $3, TRUE, NULL, FALSE)
     ON CONFLICT (email) DO UPDATE
       SET role = 'admin', status = 'active', password_hash = EXCLUDED.password_hash,
           must_change_password = TRUE, updated_at = NOW()`,
    [email, displayName, hash]
  );
  console.log(`No active administrator existed; set up ${email} as administrator. Sign in and change the password, then remove DEFAULT_ADMIN_PASSWORD from .env.prod.`);
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
    // Explicit allowlist prevents mass assignment of columns like id/created_at.
    const patch = {};
    const allowedFields = ['name', 'description', 'currency', 'amount_limit', 'per_account_daily_limit', 'active'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        patch[field] = req.body[field];
      }
    }
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
    // Explicit allowlist prevents mass assignment of columns like id/created_at.
    const patch = {};
    const allowedFields = ['alias', 'notes', 'active'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        patch[field] = req.body[field];
      }
    }
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
    `SELECT bsb, account, all_accounts, label FROM blacklist_entries
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
    body('account').custom((value, { req }) => {
      if (req.body.all_accounts === true) return true;
      if (/^\d{5,16}$/.test(String(value ?? ''))) return true;
      throw new Error('Account number must be 5-16 digits.');
    }),
    body('all_accounts').optional({ nullable: true }).isBoolean(),
    body('label').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body('notes').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('active').optional({ nullable: true }).isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const bsb = normalizeBsb(req.body.bsb);
    const allAccounts = !!req.body.all_accounts;
    const account = allAccounts ? null : normalizeAccountNumber(req.body.account);
    const label = req.body.label ? String(req.body.label).trim() : null;
    const notes = req.body.notes ? String(req.body.notes).trim() : null;
    const active = req.body.active === undefined ? true : !!req.body.active;
    if (!bsb || (!allAccounts && !account)) {
      res.status(400).json({ message: 'Provide a valid BSB and account number, or block all accounts at a BSB.' });
      return;
    }
    try {
      const query = allAccounts
        ? `INSERT INTO blacklist_entries (bsb, account, all_accounts, label, notes, active)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (bsb) WHERE all_accounts = TRUE
           DO UPDATE SET label = EXCLUDED.label, notes = EXCLUDED.notes, active = EXCLUDED.active, updated_at = NOW()
           RETURNING *`
        : `INSERT INTO blacklist_entries (bsb, account, all_accounts, label, notes, active)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (bsb, account)
           DO UPDATE SET all_accounts = EXCLUDED.all_accounts, label = EXCLUDED.label, notes = EXCLUDED.notes, active = EXCLUDED.active, updated_at = NOW()
           RETURNING *`;
      const { rows } = await pool.query(
        query,
        [bsb, account, allAccounts, label, notes, active]
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
    body('all_accounts').optional().isBoolean(),
    body('label').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body('notes').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('active').optional({ nullable: true }).isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const id = Number(req.params.id);
    // Explicit allowlist prevents mass assignment of columns like id/created_at.
    const patch = {};
    const allowedFields = ['bsb', 'account', 'all_accounts', 'label', 'notes', 'active'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        patch[field] = req.body[field];
      }
    }
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
    if (patch.all_accounts !== undefined) {
      patch.all_accounts = !!patch.all_accounts;
      if (patch.all_accounts) patch.account = null;
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

// ===== Suppliers =====
const SUPPLIER_MANAGE_ROLES = ['banking', 'reviewer', 'admin'];
const SUPPLIER_STATUS_VALUES = ['blocked', 'enabled', 'removed'];

function supplierNeedsCbaBankAccount(row) {
  return row.status !== 'enabled';
}

function mapSupplierRow(row) {
  return {
    ...row,
    need_cba_bank_account: supplierNeedsCbaBankAccount(row),
  };
}

app.get('/api/suppliers', requireAuth(), async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const conditions = [];
    const values = [];

    if (search) {
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
      conditions.push(`(supplier_id ILIKE $${values.length - 2} OR description ILIKE $${values.length - 1} OR email ILIKE $${values.length})`);
    }

    if (SUPPLIER_STATUS_VALUES.includes(status)) {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countValues = values.slice();
    const countQuery = `SELECT COUNT(*)::int AS total FROM suppliers ${whereClause}`;
    const dataQuery = `
      SELECT id, supplier_id, description, email, bsb, account, account_name, need_cba_bank_account, status, notes, created_at, updated_at
      FROM suppliers
      ${whereClause}
      ORDER BY description ASC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `;

    const dataValues = [...values, limit, offset];
    const [countResult, dataResult] = await Promise.all([
      pool.query(countQuery, countValues),
      pool.query(dataQuery, dataValues),
    ]);

    res.json({
      items: (dataResult.rows || []).map(mapSupplierRow),
      total: countResult.rows[0]?.total || 0,
      limit,
      offset,
      hasMore: offset + dataResult.rows.length < (countResult.rows[0]?.total || 0),
    });
  } catch (err) {
    console.error('Failed to load suppliers', err);
    res.status(500).json({ message: 'Unable to load suppliers.' });
  }
});

app.get('/api/suppliers/:id', [requireAuth(), param('id').isInt({ gt: 0 })], async (req, res) => {
  if (!handleValidation(req, res)) return;
  const id = Number(req.params.id);
  try {
    const { rows } = await pool.query(
      `SELECT id, supplier_id, description, email, bsb, account, account_name, need_cba_bank_account, status, notes, created_at, updated_at
       FROM suppliers WHERE id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ message: 'Supplier not found.' });
      return;
    }
    res.json(mapSupplierRow(rows[0]));
  } catch (err) {
    console.error('Failed to load supplier', err);
    res.status(500).json({ message: 'Unable to load supplier.' });
  }
});

app.patch(
  '/api/suppliers/:id',
  [
    requireAuth(SUPPLIER_MANAGE_ROLES),
    param('id').isInt({ gt: 0 }),
    body('status').optional().isIn(SUPPLIER_STATUS_VALUES),
    body('notes').optional().isString().isLength({ max: 1000 }),
    body('need_cba_bank_account').optional().isBoolean(),
    body('bsb').optional().isString().trim().isLength({ min: 6, max: 7 }),
    body('account').optional().isString().trim().isLength({ min: 5, max: 16 }),
    body('account_name').optional().isString().trim().isLength({ min: 1, max: 200 }),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const id = Number(req.params.id);
    const updates = {};
    const allowedFields = ['status', 'notes', 'need_cba_bank_account', 'account_name'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (req.body.bsb !== undefined) {
      const normalized = normalizeSupplierBsb(req.body.bsb);
      if (!normalized) {
        res.status(400).json({ message: 'BSB must be 6 digits (e.g. 062-000).' });
        return;
      }
      updates.bsb = normalized;
    }
    if (req.body.account !== undefined) {
      const normalized = normalizeSupplierAccount(req.body.account);
      if (!normalized || normalized.length < 5 || normalized.length > 16) {
        res.status(400).json({ message: 'Account number must be 5-16 digits.' });
        return;
      }
      updates.account = normalized;
    }

    if (!Object.keys(updates).length) {
      res.status(400).json({ message: 'No fields provided to update.' });
      return;
    }

    // When a supplier is enabled we treat the CBA bank account requirement as resolved.
    if (updates.status === 'enabled') {
      updates.need_cba_bank_account = false;
    } else if (updates.status === 'blocked') {
      updates.need_cba_bank_account = true;
    }

    updates.updated_at = new Date().toISOString();
    const fields = Object.keys(updates).map((key, index) => `${key} = $${index + 2}`);
    const values = [id, ...Object.values(updates)];

    try {
      const { rows } = await pool.query(
        `UPDATE suppliers SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
        values
      );
      if (!rows.length) {
        res.status(404).json({ message: 'Supplier not found.' });
        return;
      }
      res.json(mapSupplierRow(rows[0]));
    } catch (err) {
      console.error('Failed to update supplier', err);
      res.status(500).json({ message: 'Unable to update supplier.' });
    }
  }
);

// ===== Reviews =====
// Review entries are written only by the routes that act on a batch, with the
// signed-in user as the reviewer; there is deliberately no endpoint to post one.
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
    const conflict = await findPdConflict(pool, digitsOnly, UUID_REGEX.test(rootBatchIdRaw || '') ? rootBatchIdRaw : null);
    if (conflict) {
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
    body('suggested_file_name').optional({ nullable: true }).isString(),
    body('dept_code').optional({ nullable: true }).matches(/^\d{2}$/),
    body('workflow_type').optional({ nullable: true }).isIn(BATCH_WORKFLOW_TYPES)
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const account = req.user;
    const workflowType = req.body.workflow_type || 'aba';
    const pdNumber = String(req.body.pd_number || '').trim();
    if (!pdNumber) {
      res.status(400).json({ message: 'PD number is required.' });
      return;
    }
    // The stored bytes are what the bank pays, so they are checked here, not
    // only in the browser: the file must add up, its payees must not be
    // blacklisted, and it must match the transactions reviewers are shown.
    const fileData = Buffer.from(req.body.aba_content, 'base64');
    const abaFile = parseAbaFile(fileData);
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

    const conflict = await findPdConflict(pool, pdNumber, rootBatchId);
    if (conflict) {
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
      : null;
    if (payloadTransactions && !sameCredits(payloadTransactions, abaFile.credits)) {
      res.status(400).json({
        message: 'The transactions in this submission do not match its ABA file. Generate the file again and resubmit.'
      });
      return;
    }
    const blocked = await findBlacklistedCredit(abaFile.credits);
    if (blocked) {
      const labelText = blocked.entry.label ? ` (${blocked.entry.label})` : '';
      res.status(400).json({
        message: `Transactions to ${blocked.credit.bsb}${blocked.entry.all_accounts ? '' : ` / ${blocked.credit.account}`}${labelText} are not permitted.`
      });
      return;
    }
    const checksum = crypto.createHash('sha256').update(fileData).digest('hex');

    const batchId = crypto.randomUUID();
    if (!rootBatchId) rootBatchId = batchId;
    // All workflows land in 'submitted'. Departmental ABA stays there unless a
    // reviewer rejects it; public health batches require explicit approval.
    const initialStage = 'submitted';
    let insertedRow = null;
    for (let attempt = 0; attempt < 5 && !insertedRow; attempt++) {
      const code = `${prefix}${String(sequence).padStart(2, '0')}`;
      const fileName = fileNameSuggested || `ABA_${code}.aba`;
      try {
        const { rows } = await pool.query(
          `INSERT INTO batch_archives (
             batch_id, code, root_batch_id, department_code, file_name, file_path, checksum,
             duplicate_report_path, transactions, workflow_type, file_data, pd_number, submitted_email,
             submitted_by, stage, stage_updated_at, is_draft
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, FALSE)
           RETURNING batch_id, code, root_batch_id, file_name, created_at, department_code, workflow_type, stage, stage_updated_at, pd_number, submitted_email, submitted_by`,
          [
            batchId,
            code,
            rootBatchId,
            deptCode,
            fileName,
            `db://${code}`,
            checksum,
            null,
            metadata,
            workflowType,
            fileData,
            pdNumber,
            account.email,
            account.id,
            initialStage,
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
      : (initialStage === 'approved' ? 'Batch filed to repository.' : 'Batch submitted for review.');
    await pool.query(
      `INSERT INTO batch_reviews (batch_id, reviewer, status, comments, metadata, actor_id, stage)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        batchId,
        account.display_name || account.email,
        initialStage,
        initialReviewComment,
        { pd_number: pdNumber, department_code: deptCode, workflow_type: workflowType },
        account.id,
        initialStage
      ]
    );

    const savedBatch = { ...insertedRow, metadata };
    // Only public health pay runs notify reviewers on submission. Departmental
    // ABA batches stay 'submitted' without a reviewer email; reviewers reject
    // them from the Repository when needed.
    if (workflowType === 'public_health') {
      notifyPublicHealthReviewers(savedBatch, metadata).catch((err) => {
        console.error('Failed to send public health reviewer notification', err);
      });
    }
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
        workflow_type, stage, stage_updated_at, pd_number, submitted_email, submitted_by, is_draft
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
    // Departmental ABA has no approval step (submitted -> rejected only);
    // public health keeps the full approve/reject gate.
    const baseTransitions = workflowStageTransitions(batch.workflow_type);
    const allowedNext = baseTransitions[currentStage] || [];
    const isOverride = batch.workflow_type === 'public_health'
      && actor?.role === 'admin'
      && currentStage !== 'submitted'
      && targetStage === 'approved';
    if (!allowedNext.includes(targetStage)) {
      res.status(400).json({ message: `Cannot move batch from ${currentStage} to ${targetStage}.` });
      return;
    }
    const isSubmitter = batch.submitted_by
      ? batch.submitted_by === actor.id
      : Boolean(batch.submitted_email) && lowerEmail(batch.submitted_email) === lowerEmail(actor.email);
    if (targetStage === 'approved' && isSubmitter) {
      res.status(403).json({ message: 'You cannot approve a batch you submitted. Another reviewer must approve it.' });
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
    if (targetStage === 'approved') {
      notifySubmitterOfApproval(updated, metadata, commentsRaw, actor).catch((err) => {
        console.error('Failed to notify submitter of approval', err);
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
            submitted_email, submitted_by, is_draft, archived_at, workflow_type
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
  // Repository semantics: submitted and approved batches are both retrievable.
  if (record.stage === 'approved' || record.stage === 'submitted') {
    response.file_available = true;
  } else {
    response.file_base64 = null;
    response.file_available = false;
  }
  res.json(response);
});

app.patch(
  '/api/batches/:code/value-date',
  requireAuth(REVIEW_ACCESS_ROLES),
  [
    param('code').isString().trim(),
    body('proc').matches(/^\d{6}$/),
    body('desc').optional({ nullable: true }).isString(),
    body('remitter').optional({ nullable: true }).isString()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const formattedCode = formatBatchCode(req.params.code);
    // Any aba_content the client sends is ignored: the stored file is amended
    // here, so a reviewer can change the date but never the payments.
    const { proc, desc, remitter } = req.body;
    try {
      const { rows } = await pool.query(
        `SELECT batch_id, code, root_batch_id, department_code, file_name, checksum, created_at, transactions,
                stage, stage_updated_at, pd_number, submitted_email, submitted_by, is_draft, file_data
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
      const fileData = amendValueDate(record.file_data, { proc, desc, remitter });
      metadata.payload = { ...metadata.payload, header: { ...metadata.payload.header, proc } };
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
      if (updated.stage === 'approved' || updated.stage === 'submitted') {
        response.file_available = true;
      } else {
        response.file_base64 = null;
        response.file_available = false;
      }
      res.json(response);
    } catch (err) {
      if (err instanceof ServiceError) throw err;
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
  const wantsMeta = req.query.meta === '1' || req.query.meta === 'true';
  const limitParam = Number.parseInt(req.query.limit, 10);
  const offsetParam = Number.parseInt(req.query.offset, 10);
  const search = typeof req.query.search === 'string' ? req.query.search : '';
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
    if (wantsMeta) {
      const pageLimit = Number.isNaN(limitParam)
        ? limit
        : Math.max(1, Math.min(limitParam, isAdmin ? ADMIN_ARCHIVE_LIMIT_MAX : REVIEWER_ARCHIVE_LIMIT_MAX));
      const page = await fetchArchivesPage({
        includeHistory: wantAllArchives,
        limit: pageLimit,
        offset: Number.isNaN(offsetParam) ? 0 : offsetParam,
        search,
      });
      res.json({
        ...page,
        items: maskArchivesForRole(page.items, isAdmin),
      });
      return;
    }
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
  [requireAuth(['admin']), body('passphrase').isString().isLength({ min: 4, max: 128 })],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const passphraseHash = await hashPassphrase(req.body.passphrase);
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

const passphraseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many passphrase attempts. Please try again later.' },
});

app.post(
  '/api/reviewer/passphrase/verify',
  [passphraseLimiter, body('passphrase').isString().isLength({ min: 1, max: 128 })],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { rows } = await pool.query('SELECT passphrase_hash FROM reviewer_settings WHERE id = TRUE');
    if (!rows.length || !rows[0].passphrase_hash) {
      res.status(404).json({ message: 'Reviewer passphrase not configured.' });
      return;
    }
    const incoming = req.body.passphrase;
    const stored = rows[0].passphrase_hash;
    let valid = false;
    if (isLegacyPassphraseHash(stored)) {
      // Legacy SHA-256 path — compare in constant time, then offer no upgrade hook here.
      const incomingHash = legacyHashPassphrase(incoming);
      if (incomingHash.length === stored.length) {
        valid = crypto.timingSafeEqual(Buffer.from(incomingHash, 'hex'), Buffer.from(stored, 'hex'));
      }
    } else {
      valid = await bcrypt.compare(incoming, stored);
    }
    if (valid) res.json({ valid: true });
    else res.status(401).json({ valid: false, message: 'Invalid passphrase.' });
  }
);

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
          
          const windowsResponse = await safeFetchSyncUrl(WINDOWS_SYNC_URL, {
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
app.post('/api/ai-helper/chat', requireAuth(), async (req, res) => {
  if (!AI_HELPER_ENABLED || !aiClient) {
    return res.status(503).json({ message: 'AI Helper is not enabled' });
  }

  try {
    const { message, conversationHistory } = req.body;
    if (!message) {
      return res.status(400).json({ message: 'Message is required' });
    }

    // Use the authenticated user's role rather than trusting a client-supplied value.
    const role = req.user?.role || 'user';
    const userName = req.user?.display_name || req.user?.email || 'User';
    console.log('[AI Helper] Request body:', { message: message.substring(0, 50), userRole: role, userName });
    // Determine user level for context
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

    const systemPrompt = `You are a helpful assistant for the RON ABA Generator & Review System used by Naoero Treasury. Be conversational and friendly while staying concise.

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
- Banking: Convert CSV to BAI2, validate BAI2 files, convert WBC Fiji and NY USD statements to FMIS import format. "BAI2 File Check" menu for troubleshooting bank statement files (Level 2+)
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
- WBC Fiji Generator: Convert Westpac Fiji CSV statements to TechnologyOne FMIS import format
- NY Statement Generator: Convert New York USD bank statement CSV files to TechnologyOne FMIS import format (users must export from Numbers/Apple to CSV first)

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

// ===== Error handling =====
// Mounted last so every route above has had its chance: an unmatched /api path
// answers JSON rather than Express's HTML page, and anything that threw or
// rejected lands in one place with a reference the user can quote.
app.use(notFoundHandler);
app.use(errorHandler);

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
    // Override env-based mailTransport with DB settings if they exist.
    try {
      const smtpSettings = await reloadMailTransport();
      if (smtpSettings) {
        console.log(`SMTP transport loaded from DB: ${smtpSettings.smtp_host}:${smtpSettings.smtp_port}`);
      }
    } catch (err) {
      console.error('Failed to load SMTP settings from DB:', err.message);
    }
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`RON ABA backend listening on port ${PORT}`);
    });

    // Fortnightly leave accrual. Runs any due periods on startup (catching up
    // after downtime) and then checks hourly.
    //
    // The advisory lock means only one container does the work when the API is
    // scaled out — the rest decline quietly rather than racing and failing on
    // the period_end constraint. Set ACCRUAL_SCHEDULER=off to run it from cron
    // instead (`npm run accrual -- --due`); the two are interchangeable and
    // equally idempotent.
    if (ACCRUAL_SCHEDULER_ENABLED) {
      const runScheduledAccruals = async () => {
        try {
          const { acquired, result } = await withAdvisoryLock(
            pool, LOCK_KEYS.LEAVE_ACCRUAL, () => runDueLeaveAccruals(pool)
          );
          if (!acquired) return;
          for (const periodEnd of result.ran) {
            console.log(`[accrual-scheduler] Ran leave accrual for period ending ${periodEnd}`);
          }
        } catch (err) {
          console.error('[accrual-scheduler] Failed to run due leave accruals', err);
        }
      };
      runScheduledAccruals();
      setInterval(runScheduledAccruals, 60 * 60 * 1000).unref();
    } else {
      console.log('[accrual-scheduler] Disabled (ACCRUAL_SCHEDULER=off) - run it from cron.');
    }
  })
  .catch((err) => {
    console.error('Failed to start server', err);
    process.exit(1);
  });

import dotenv from 'dotenv';

dotenv.config();

export const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}

export const SESSION_MINUTES = Number(process.env.REVIEWER_SESSION_MINUTES || 480);
export const PASS_HASH_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
export const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'http://localhost:8080';
export const TEMP_PASSWORD_LENGTH = Number(process.env.REVIEWER_TEMP_PASSWORD_LENGTH || 12);
export const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
export const SMTP_HOST = process.env.SMTP_HOST;
export const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
export const SMTP_USER = process.env.SMTP_USER;
export const SMTP_PASS = process.env.SMTP_PASS;
export const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'no-reply@example.com';
export const REPLY_TO = process.env.REPLY_TO_EMAIL;

export const ACCOUNT_ROLES = ['user', 'banking', 'reviewer', 'admin', 'payroll'];
export const REVIEW_ACCESS_ROLES = ['reviewer', 'admin'];
export const ACCOUNT_STATUSES = ['active', 'inactive'];
export const BSB_REGEX = /^[0-9]{3}-[0-9]{3}$/;
export const BANK_PRESET_KEYS = [
  'CBA-RON', 'CBA-Agent', 'CBA-DFAT', 'CBA-NSUDP', 'CBA-NZAID', 'CBA-DEV.FUND',
  'CBA-Seabed.Account', 'CBA-Tank Farm'
];
export const DEFAULT_BANK_PRESETS = ['CBA-RON'];
export const ADMIN_ARCHIVE_LIMIT_DEFAULT = 100;
export const REVIEWER_ARCHIVE_LIMIT_DEFAULT = 50;
export const PAYROLL_ACCESS_ROLES = ['payroll', 'admin'];
export const PAYROLL_PYTHON_BIN = process.env.PAYROLL_PYTHON_BIN || process.env.PYTHON_BIN || 'python3';
export const PAYROLL_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const AUTH_LOCKOUT_WINDOW_MS = Number(process.env.AUTH_LOCKOUT_WINDOW_MS || 15 * 60 * 1000);
export const AUTH_MAX_FAILED_ATTEMPTS = Number(process.env.AUTH_MAX_FAILED_ATTEMPTS || 5);
export const EXCEL_MIME_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream'
]);

export const ADMIN_ARCHIVE_LIMIT_MAX = 500;
export const REVIEWER_ARCHIVE_LIMIT_MAX = 100;
export const BLACKLIST_IMPORT_LIMIT = 1000;
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const COOKIE_NAME = 'auth_token';
export const isProd = process.env.NODE_ENV === 'production' || FRONTEND_BASE_URL.startsWith('https://');

// SFTP sync
export const SFTP_SYNC_METHOD = process.env.SFTP_SYNC_METHOD || 'database';
export const WINDOWS_SYNC_URL = process.env.WINDOWS_SYNC_URL || 'http://host.docker.internal:8088/sync-trigger';
export const SYNC_TRIGGER_PATH = process.env.SYNC_TRIGGER_PATH || null;
export const SYNC_TIMEOUT = Number(process.env.SYNC_TIMEOUT || 30000);
export const SYNC_ALLOWED_HOSTS = String(process.env.SYNC_ALLOWED_HOSTS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// AI Helper
export const AI_HELPER_ENABLED = process.env.AI_HELPER_ENABLED === 'true';
export const AI_PROVIDER = process.env.AI_PROVIDER || 'ollama';
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://host.docker.internal:11434';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama2';
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
export const GITHUB_MODEL = process.env.GITHUB_MODEL || 'gpt-4o-mini';

export const WORKFLOW_GUIDE_TEXT = `Workflow Guide:\n\n1. Level 1 users prepare an ABA file in the Generator, enter the PD#, add notes, and click Commit.\n2. Reviewers are notified by email, open the Reviewer tab, and approve or reject the batch.\n3. If rejected, the submitter fixes their copy (upload via Reader → Load) and resubmits.\n4. Once approved, reviewers/admins can download the ABA from the archive; admins can delete batches when finished.`;

// File upload limits
export const FOREX_TT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FOREX_TT_ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
]);
export const FOREX_TT_ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg']);

// Permissions
export const PERMISSIONS = {
  SUBMIT_ABA: 'submit_aba',
  REVIEW_ABA: 'review_aba',
  NOTIFY_ABA_SUBMISSIONS: 'notify_aba_submissions',
  SUBMIT_FOREX_TT: 'submit_forex_tt',
  REVIEW_FOREX_TT: 'review_forex_tt',
  NOTIFY_FOREX_TT_SUBMISSIONS: 'notify_forex_tt_submissions',
  ADMIN: 'admin',
};

// FOREX TT state machine
export const FOREX_TT_STATUSES = [
  'draft', 'submitted', 'claimed', 'processing', 'needs_changes', 'approved', 'cancelled'
];

/**
 * Application Constants
 * Centralized constants to replace magic numbers and strings throughout the codebase
 */

// API Configuration
export const API_BASE = '/api';

// Authentication
export const AUTH_STORAGE_KEY = 'aba-reviewer-auth-v1';

// Transaction Codes
export const TRANSACTION_CODES = {
  CREDIT: {
    '50': '50',
    '51': '51',
    '52': '52',
    '53': '53', // Default credit code
    '54': '54',
    '55': '55',
    '56': '56',
    '57': '57'
  },
  BALANCING: '13',
  DEFAULT_CREDIT: '53'
};

export const CREDIT_TXN_CODES = ['50', '51', '52', '53', '54', '55', '56', '57'];
export const CREDIT_CODE_SET = new Set(CREDIT_TXN_CODES);

// Batch Stages
export const BATCH_STAGES = {
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PENDING: 'pending'
};

// Batch Stage Metadata
export const STAGE_META = {
  submitted: { label: 'Submitted', classes: 'bg-blue-100 text-blue-800' },
  approved: { label: 'Approved', classes: 'bg-green-100 text-green-800' },
  rejected: { label: 'Rejected', classes: 'bg-red-100 text-red-800' },
  pending: { label: 'Pending', classes: 'bg-yellow-100 text-yellow-800' }
};

// Batch Stage Transitions
export const STAGE_TRANSITIONS = {
  submitted: { approve: true, reject: true },
  rejected: { approve: true, reject: false },
  approved: { approve: false, reject: false } // Admins can override
};

// User Roles
export const USER_ROLES = {
  USER: 'user',
  BANKING: 'banking',
  REVIEWER: 'reviewer',
  ADMIN: 'admin'
};

// Role hierarchy order (for permission checking)
export const ROLE_ORDER = {
  user: 1,
  banking: 2,
  reviewer: 3,
  admin: 4
};

// Role display labels
export const ROLE_LABELS = {
  user: 'Level 1 User',
  banking: 'Level 2 Banking',
  reviewer: 'Level 3 Reviewer',
  admin: 'Level 4 Administrator'
};

export const REVIEW_ACCESS_ROLES = [USER_ROLES.REVIEWER, USER_ROLES.ADMIN];

// Admin Sections
export const ADMIN_SECTIONS = ['signups', 'accounts', 'blacklist', 'archives', 'testing'];

// Banking Sections
export const BANKING_SECTIONS = ['converter', 'checker'];

// ABA File Format Constants
export const ABA_FORMAT = {
  RECORD_TYPE: {
    HEADER: '0',
    DETAIL: '1',
    CONTROL: '7'
  },
  FIELD_LENGTHS: {
    BSB: 7,
    ACCOUNT: 9,
    AMOUNT: 10,
    ACCOUNT_TITLE: 32,
    LODGEMENT_REF: 18,
    TRACE_BSB: 7,
    TRACE_ACCOUNT: 9,
    REMITTER: 16,
    WITHHOLDING: 8
  },
  LINE_LENGTH: 120
};

// Common Header Values
export const COMMON_HEADER = {
  fi: 'CBA',
  reel: '1',
  user: 'Nauru Government',
  apca: '301500',
  desc: 'WAGES',
  proc: '',
  remitter: 'RON Government'
};

// Header Presets for Bank Accounts
export const HEADER_PRESETS = {
  "CBA-RON": {
    ...COMMON_HEADER,
    trace_bsb: "064-000",
    trace_acct: "16744795",
    balance_required: true,
    balance_txn_code: "13",
    balance_bsb: "064-000",
    balance_acct: "16744795",
    balance_title: "Treasury OPA - CBA"
  },
  "CBA-Agent": {
    ...COMMON_HEADER,
    trace_bsb: "064-036",
    trace_acct: "10192093",
    balance_required: true,
    balance_txn_code: "13",
    balance_bsb: "064-036",
    balance_acct: "10192093",
    balance_title: "Agent Operating Account"
  },
  "CBA-DFAT": {
    ...COMMON_HEADER,
    trace_bsb: "064-000",
    trace_acct: "16745106",
    balance_required: true,
    balance_txn_code: "13",
    balance_bsb: "064-000",
    balance_acct: "16745106",
    balance_title: "RON DFAT Account"
  },
  "CBA-NSUDP": {
    ...COMMON_HEADER,
    trace_bsb: "064-000",
    trace_acct: "16745165",
    balance_required: true,
    balance_txn_code: "13",
    balance_bsb: "064-000",
    balance_acct: "16745165",
    balance_title: "RON NSUDP Account"
  },
  "CBA-NZAID": {
    ...COMMON_HEADER,
    trace_bsb: "064-000",
    trace_acct: "16745149",
    balance_required: true,
    balance_txn_code: "13",
    balance_bsb: "064-000",
    balance_acct: "16745149",
    balance_title: "RON NZAid Account"
  },
  "CBA-DEV.FUND": {
    ...COMMON_HEADER,
    trace_bsb: "064-000",
    trace_acct: "16745157",
    balance_required: true,
    balance_txn_code: "13",
    balance_bsb: "064-000",
    balance_acct: "16745157",
    balance_title: "RON DEV.Fund Account"
  },
  "CBA-Seabed.Account": {
    ...COMMON_HEADER,
    trace_bsb: "064-000",
    trace_acct: "16746109",
    balance_required: true,
    balance_txn_code: "13",
    balance_bsb: "064-000",
    balance_acct: "16746109",
    balance_title: "RON SMADG Account"
  },
  "CBA-Tank Farm": {
    ...COMMON_HEADER,
    trace_bsb: "064-000",
    trace_acct: "16746088",
    balance_required: true,
    balance_txn_code: "13",
    balance_bsb: "064-000",
    balance_acct: "16746088",
    balance_title: "RON Tank Farm A/C"
  }
};

// Header field names
export const HEADER_FIELDS = ['fi', 'reel', 'user', 'apca', 'desc', 'proc', 'trace_bsb', 'trace_acct', 'remitter'];
export const BALANCE_FIELDS = ['balance_required', 'balance_txn_code', 'balance_bsb', 'balance_acct', 'balance_title'];

// Default Values
export const DEFAULTS = {
  LIMIT: {
    ADMIN_ARCHIVE: 100,
    REVIEWER_ARCHIVE: 30,
    MAX_ADMIN_ARCHIVE: 500,
    MAX_REVIEWER_ARCHIVE: 50
  },
  BLACKLIST_IMPORT_LIMIT: 1000
};

// Export BLACKLIST_IMPORT_LIMIT directly for convenience
export const BLACKLIST_IMPORT_LIMIT = 1000;


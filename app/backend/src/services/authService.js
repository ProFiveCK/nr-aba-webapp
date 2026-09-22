import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import {
  JWT_SECRET,
  SESSION_MINUTES,
  PASS_HASH_ROUNDS,
  COOKIE_NAME,
  isProd,
  ACCOUNT_ROLES,
  BANK_PRESET_KEYS,
  TEMP_PASSWORD_LENGTH,
  DEFAULT_BANK_PRESETS,
  ROLE_CAPABILITIES,
  ALL_CAPABILITIES,
} from '../config.js';
import { lowerEmail } from '../utils/helpers.js';

export function setAuthCookie(res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/', httpOnly: true, secure: isProd, sameSite: 'lax' });
}

export function csrfGuard(corsOrigin) {
  const allowedOrigins = String(corsOrigin || '').split(',').map((s) => s.trim()).filter(Boolean);
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return next();
    }
    res.status(403).json({ message: 'Cross-origin request blocked.' });
  };
}

export function buildCookieParser() {
  return (req, _res, next) => {
    req.cookies = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      for (const pair of cookieHeader.split(';')) {
        const idx = pair.indexOf('=');
        if (idx > 0) {
          const key = pair.slice(0, idx).trim();
          const val = pair.slice(idx + 1).trim();
          if (key) req.cookies[key] = decodeURIComponent(val);
        }
      }
    }
    next();
  };
}

export function generateTempPassword(length = TEMP_PASSWORD_LENGTH) {
  const bytes = crypto.randomBytes(Math.ceil(length * 0.75));
  return bytes.toString('base64url').slice(0, length);
}

export async function hashPassphrase(passphrase) {
  return bcrypt.hash(passphrase, PASS_HASH_ROUNDS);
}

export function isLegacyPassphraseHash(hash) {
  return typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash);
}

export function legacyHashPassphrase(passphrase) {
  return crypto.createHash('sha256').update(passphrase).digest('hex');
}

export async function createSession(reviewerId) {
  const tokenId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_MINUTES * 60 * 1000);
  await pool.query(
    `INSERT INTO reviewer_sessions (reviewer_id, token_id, expires_at)
     VALUES ($1, $2, $3)`,
    [reviewerId, tokenId, expiresAt.toISOString()]
  );
  return { tokenId, expiresAt };
}

export async function invalidateSession(tokenId) {
  if (!tokenId) return;
  await pool.query('DELETE FROM reviewer_sessions WHERE token_id = $1', [tokenId]);
}

export async function lookupSession(tokenId) {
  if (!tokenId) return null;
  const { rows } = await pool.query(
    `SELECT r.id, r.email, r.display_name, r.role, r.status, r.must_change_password, r.last_login_at,
            r.created_at, r.updated_at, r.department_code, r.division_code, r.notify_on_submission,
            r.permissions, s.expires_at
       FROM reviewer_sessions s
       JOIN reviewers r ON r.id = s.reviewer_id
      WHERE s.token_id = $1`,
    [tokenId]
  );
  if (!rows.length) return null;
  return rows[0];
}

export function buildTokenPayload(reviewer, tokenId, expiresAt) {
  return jwt.sign(
    {
      sub: reviewer.id,
      email: reviewer.email,
      role: reviewer.role,
      tokenId,
    },
    JWT_SECRET,
    { expiresIn: `${SESSION_MINUTES}m` }
  );
}

export async function resolveAllowedBankPresets(departmentCode, divisionCode) {
  if (!departmentCode) return DEFAULT_BANK_PRESETS;
  const dept = String(departmentCode).trim();
  const div = String(divisionCode ?? '00').trim() || '00';
  const { rows } = await pool.query(
    'SELECT allowed_bank_presets FROM department_profiles WHERE department_code = $1 AND division_code = $2',
    [dept, div]
  );
  if (rows.length) {
    const presets = (rows[0].allowed_bank_presets || []).filter((k) => BANK_PRESET_KEYS.includes(k));
    if (presets.length) return presets;
  }
  return DEFAULT_BANK_PRESETS;
}

export async function reviewerAllowedPresets(reviewerId) {
  const { rows } = await pool.query(
    'SELECT department_code, division_code FROM reviewers WHERE id = $1',
    [reviewerId]
  );
  if (!rows.length) return DEFAULT_BANK_PRESETS;
  return resolveAllowedBankPresets(rows[0].department_code, rows[0].division_code);
}

export function parsePermissions(permissionsValue) {
  if (!permissionsValue) return {};
  if (typeof permissionsValue === 'object') return permissionsValue;
  try {
    return JSON.parse(permissionsValue);
  } catch {
    return {};
  }
}

export function hasPermission(permissions, permission) {
  const p = parsePermissions(permissions);
  return p[permission] === true;
}

export async function loadCapabilities(reviewerId) {
  const { rows } = await pool.query(
    'SELECT capability FROM reviewer_capabilities WHERE reviewer_id = $1',
    [reviewerId]
  );
  return rows.map((r) => r.capability);
}

/**
 * Replaces a reviewer's grants with exactly `capabilities`, in one transaction
 * so a failure cannot leave someone with a half-applied set of permissions.
 */
export async function setCapabilities(reviewerId, capabilities, grantedBy = null) {
  const wanted = [...new Set(capabilities.filter((c) => ALL_CAPABILITIES.includes(c)))];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM reviewer_capabilities WHERE reviewer_id = $1 AND NOT (capability = ANY($2::text[]))',
      [reviewerId, wanted]
    );
    for (const capability of wanted) {
      await client.query(
        `INSERT INTO reviewer_capabilities (reviewer_id, capability, granted_by)
         VALUES ($1, $2, $3) ON CONFLICT (reviewer_id, capability) DO NOTHING`,
        [reviewerId, capability, grantedBy]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return wanted;
}

export function reviewerSummary(row, allowedBankPresets = DEFAULT_BANK_PRESETS, capabilities = []) {
  const permissions = parsePermissions(row.permissions);
  // Granted capabilities. Explicit JSONB overrides above still win, so an
  // administrator can revoke something a grant would otherwise allow.
  for (const capability of capabilities) {
    permissions[capability] ??= true;
  }
  // Defaults based on legacy role model for backward compatibility
  if (['reviewer', 'admin'].includes(row.role)) {
    permissions.review_aba ??= true;
    permissions.notify_aba_submissions ??= row.notify_on_submission !== false;
    // FOREX TT defaults for reviewers/admins
    permissions.review_forex_tt ??= true;
    permissions.notify_forex_tt_submissions ??= row.notify_on_submission !== false;
  }
  if (row.status === 'active') {
    // All active users may submit ABA batches and FOREX TT requests
    permissions.submit_aba ??= true;
    permissions.submit_forex_tt ??= true;
  }
  if (row.role === 'admin') {
    permissions.admin ??= true;
  }
  // Role floor: retained during the migration to capabilities so an account can
  // never end up with less access than its legacy role implied. Capabilities are
  // additive on top of this; remove once every account is granted explicitly.
  for (const capability of ROLE_CAPABILITIES[row.role] ?? []) {
    permissions[capability] ??= true;
  }
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
    division_code: row.division_code || '00',
    notify_on_submission: row.notify_on_submission !== false,
    allowed_bank_presets: Array.from(new Set(allowedBankPresets)),
    // Explicit grants, as distinct from `permissions` which also folds in the
    // role floor. The admin UI needs to show what was actually granted.
    capabilities: [...capabilities],
    permissions,
  };
}

export function requireAuth(roles = []) {
  const allowedRoles = Array.isArray(roles) && roles.length ? roles : null;
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      const cookieToken = req.cookies?.[COOKIE_NAME];
      const token = cookieToken || (header.startsWith('Bearer ') ? header.slice(7) : '');
      const requestPath = req.originalUrl || req.path;
      const requestIp = req.ip;
      if (!token) {
        console.warn(`[auth] no token for ${req.method} ${requestPath} from ${requestIp}`);
        res.status(401).json({ message: 'Authentication required.' });
        return;
      }
      let payload;
      try {
        payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      } catch (err) {
        console.warn(`[auth] invalid/expired token for ${req.method} ${requestPath} from ${requestIp}: ${err.message}`);
        res.status(401).json({ message: 'Invalid or expired token.' });
        return;
      }
      const session = await lookupSession(payload.tokenId);
      if (!session) {
        console.warn(`[auth] session not found for ${req.method} ${requestPath} from ${requestIp}, tokenId ${payload.tokenId}`);
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
      const [allowedPresets, capabilities] = await Promise.all([
        reviewerAllowedPresets(session.id),
        loadCapabilities(session.id),
      ]);
      const permissions = reviewerSummary(session, allowedPresets, capabilities).permissions;
      req.user = {
        id: session.id,
        email: session.email,
        display_name: session.display_name,
        role: session.role,
        must_change_password: session.must_change_password ?? false,
        tokenId: payload.tokenId,
        session_expires_at: session.expires_at,
        department_code: session.department_code || null,
        division_code: session.division_code || '00',
        notify_on_submission: session.notify_on_submission !== false,
        allowed_bank_presets: allowedPresets,
        permissions,
      };
      next();
    } catch (err) {
      console.error('Authentication error', err);
      res.status(500).json({ message: 'Authentication failed.' });
    }
  };
}

/**
 * Authenticates, then requires ANY ONE of the given capabilities.
 *
 * Composes with requireAuth's own middleware rather than awaiting it: when
 * requireAuth rejects it answers the request itself and never invokes the
 * callback, so there is nothing further to do here.
 */
export function requirePermission(...permissions) {
  const required = permissions.flat();
  const authenticate = requireAuth();
  return (req, res, next) => {
    authenticate(req, res, (err) => {
      if (err) return next(err);
      const granted = req.user?.permissions ?? {};
      if (required.some((permission) => granted[permission] === true)) return next();
      console.warn(`[auth] missing capability (${required.join(' or ')}) for ${req.method} ${req.originalUrl || req.path}`);
      res.status(403).json({ message: 'Forbidden.' });
    });
  };
}

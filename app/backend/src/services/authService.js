import crypto from 'crypto';
import { withTransaction } from '../lib/transaction.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import {
  JWT_SECRET,
  SESSION_MINUTES,
  PASS_HASH_ROUNDS,
  COOKIE_NAME,
  isProd,
  BANK_PRESET_KEYS,
  TEMP_PASSWORD_LENGTH,
  DEFAULT_BANK_PRESETS,
  ALL_CAPABILITIES,
  PERMISSIONS,
  PREFERENCE_KEYS,
  LEAVE_ONLY_CAPABILITIES,
  isLeaveOnlyKey,
} from '../config.js';
import { ServiceError } from '../lib/serviceError.js';
import { activeScopeSql, approverHolderSql } from './hrAccess.js';
import { employeeApiLimiter } from '../middleware/employeeApiLimit.js';

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
            r.permissions, r.account_type, r.onboarding_state, r.login_alias, s.expires_at, e.id AS employee_id, e.status AS employee_status
       FROM reviewer_sessions s
       JOIN reviewers r ON r.id = s.reviewer_id
       LEFT JOIN hr_employees e ON e.reviewer_id = r.id
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

const unitKey = (departmentCode, divisionCode) =>
  `${String(departmentCode).trim()}/${String(divisionCode ?? '00').trim() || '00'}`;

/** Allowed bank presets for several units in one query, one entry per input, in order. */
export async function allowedPresetsForUnits(units) {
  const wanted = [...new Set(units.filter((u) => u.department_code).map((u) => unitKey(u.department_code, u.division_code)))];
  const { rows } = wanted.length ? await pool.query(
    `SELECT department_code, division_code, allowed_bank_presets FROM department_profiles
      WHERE department_code || '/' || division_code = ANY($1::text[])`, [wanted]) : { rows: [] };
  const byUnit = new Map(rows.map((r) => [unitKey(r.department_code, r.division_code), r.allowed_bank_presets]));
  return units.map((u) => {
    if (!u.department_code) return DEFAULT_BANK_PRESETS;
    const presets = (byUnit.get(unitKey(u.department_code, u.division_code)) || []).filter((k) => BANK_PRESET_KEYS.includes(k));
    return presets.length ? presets : DEFAULT_BANK_PRESETS;
  });
}

export async function resolveAllowedBankPresets(departmentCode, divisionCode) {
  return (await allowedPresetsForUnits([{ department_code: departmentCode, division_code: divisionCode }]))[0];
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

/**
 * Each account's capabilities in one query, one list per id, in order: its
 * ticks, plus the Leave rights worked out from Leave settings (HR officer from
 * an active assignment, approver from a nomination). Either also opens the
 * Leave app.
 */
export async function loadCapabilitiesFor(reviewerIds) {
  if (!reviewerIds.length) return [];
  const { rows } = await pool.query(
    `SELECT reviewer_id, capability FROM reviewer_capabilities WHERE reviewer_id = ANY($1::uuid[]) AND capability = ANY($2::text[])
     UNION SELECT s.reviewer_id, '${PERMISSIONS.HR_OFFICER}' FROM hr_access_scopes s WHERE s.reviewer_id = ANY($1::uuid[]) AND ${activeScopeSql()}
     UNION SELECT r.id, '${PERMISSIONS.HR_LEAVE_APPROVE}' FROM reviewers r WHERE r.id = ANY($1::uuid[]) AND ${approverHolderSql('r.id')}`,
    // Only ticks the account page offers count, so approver and HR officer
    // can come from Leave settings alone.
    [reviewerIds, ALL_CAPABILITIES]
  );
  const byId = new Map(reviewerIds.map((id) => [id, new Set()]));
  for (const row of rows) byId.get(row.reviewer_id)?.add(row.capability);
  for (const held of byId.values()) {
    if (held.has(PERMISSIONS.HR_OFFICER) || held.has(PERMISSIONS.HR_LEAVE_APPROVE)) held.add(PERMISSIONS.HR_ACCESS);
  }
  return reviewerIds.map((id) => [...byId.get(id)]);
}

export async function loadCapabilities(reviewerId) {
  return (await loadCapabilitiesFor([reviewerId]))[0];
}

/**
 * Replaces a reviewer's grants with exactly `capabilities`, in one transaction
 * so a failure cannot leave someone with a half-applied set of permissions.
 */
export async function setCapabilities(reviewerId, capabilities, grantedBy = null, existingClient = null) {
  const wanted = [...new Set(capabilities.filter((c) => ALL_CAPABILITIES.includes(c)))];
  // With a client the caller owns the transaction (so this joins it); without one it makes its own.
  const apply = async (client) => {
    const { rows: [account] } = await client.query('SELECT account_type FROM reviewers WHERE id = $1', [reviewerId]);
    const refused = account?.account_type === 'employee' ? wanted.filter((c) => !LEAVE_ONLY_CAPABILITIES.includes(c)) : [];
    if (refused.length) {
      throw new ServiceError(400, `A leave-only account can hold Leave access only, not central HR administration or other apps (${refused.join(', ')}).`);
    }
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
  };
  if (existingClient) await apply(existingClient);
  else await withTransaction(pool, apply);
  return wanted;
}

export function reviewerSummary(row, allowedBankPresets = DEFAULT_BANK_PRESETS, capabilities = []) {
  // Access is exactly the capabilities granted to the account (its own rows in
  // reviewer_capabilities plus those from its active HR scopes), which is what
  // the account page shows and edits. Nothing else adds or removes any:
  //
  // - The reviewers.permissions column used to grant (`true`) or deny
  //   (`false`) any key, unseen by the account page, and kept doing so after a
  //   role change. It now holds notification preferences only.
  // - Roles used to add access at request time (review for reviewers, submit
  //   for every active account, everything for administrators), so unticking
  //   those boxes did nothing. Those grants were written down per account by
  //   retireHiddenPermissions in db.js and are ordinary ticks from then on.
  //
  // Administrators cannot narrow themselves out of repairing access: the
  // account page is gated by the Administrator role, not by a capability.
  const permissions = {};
  for (const capability of capabilities) {
    if (capability !== PERMISSIONS.ADMIN) permissions[capability] = true;
  }
  if (row.account_type === 'employee') {
    // Writes refuse anything else; requireAuth also fences these accounts into Leave.
    for (const key of Object.keys(permissions)) {
      if (!isLeaveOnlyKey(key)) delete permissions[key];
    }
  } else {
    const stored = parsePermissions(row.permissions);
    for (const key of PREFERENCE_KEYS) {
      if (typeof stored[key] === 'boolean') permissions[key] = stored[key];
    }
    if (['reviewer', 'admin'].includes(row.role)) {
      permissions.notify_aba_submissions ??= row.notify_on_submission !== false;
      permissions.notify_forex_tt_submissions ??= row.notify_on_submission !== false;
    }
    // Full administration is the Administrator role, nothing else, so the
    // account page (role-gated) and capability checks name the same people.
    if (row.role === 'admin') permissions[PERMISSIONS.ADMIN] = true;
  }
  return {
    id: row.id,
    email: row.email || '',
    login_alias: row.login_alias || null,
    display_name: row.display_name,
    role: row.role,
    account_type: row.account_type || 'staff',
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

// All a session that still has to change its password may reach.
const PASSWORD_CHANGE_PATHS = new Set([
  '/api/auth/me', '/api/auth/change-password', '/api/auth/logout', '/api/auth/refresh',
]);

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
      if (session.account_type === 'employee' && (session.employee_status !== 'active' || session.onboarding_state !== 'ready')) {
        res.status(403).json({ message: 'An active, verified employee link is required. Contact HR.' });
        return;
      }
      const now = new Date();
      const expiry = new Date(session.expires_at);
      if (expiry <= now) {
        await invalidateSession(payload.tokenId);
        res.status(401).json({ message: 'Session expired.' });
        return;
      }
      // A temporary or bootstrap password is known to someone else, so until
      // it is replaced the session can do nothing but replace it.
      if (session.must_change_password && !PASSWORD_CHANGE_PATHS.has(req.originalUrl.split('?')[0])) {
        res.status(403).json({ message: 'Change your password to continue.', code: 'PASSWORD_CHANGE_REQUIRED' });
        return;
      }
      // Legacy finance routes also use role/any-login gates. A Leave-only
      // identity must not inherit access through any of those older gates.
      const path = requestPath.split('?')[0];
      if (session.account_type === 'employee' && path !== '/api/hr' && !path.startsWith('/api/hr/') && !PASSWORD_CHANGE_PATHS.has(path)) {
        res.status(403).json({ message: 'This account has employee Leave access only.' });
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
        email: session.email || '',
        login_alias: session.login_alias || null,
        display_name: session.display_name,
        role: session.role,
        account_type: session.account_type,
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
      if (required.some((permission) => granted[permission] === true)) {
        const path = (req.originalUrl || '').split('?')[0];
        if (path === '/api/hr' || path.startsWith('/api/hr/')) return employeeApiLimiter(req, res, next);
        return next();
      }
      console.warn(`[auth] missing capability (${required.join(' or ')}) for ${req.method} ${req.originalUrl || req.path}`);
      res.status(403).json({ message: 'Forbidden.' });
    });
  };
}

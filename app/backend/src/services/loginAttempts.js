import { pool } from '../db.js';
import { AUTH_LOCKOUT_WINDOW_MS, AUTH_MAX_FAILED_ATTEMPTS } from '../config.js';
import { lowerEmail } from '../utils/helpers.js';

async function recordLoginAttempt(email, ip, successful) {
  const normalizedEmail = lowerEmail(email);
  if (!normalizedEmail) return;
  const windowStart = new Date(Date.now() - AUTH_LOCKOUT_WINDOW_MS).toISOString();
  await pool.query(
    `DELETE FROM login_attempts WHERE email = $1 AND attempted_at < $2`,
    [normalizedEmail, windowStart]
  );
  await pool.query(
    `INSERT INTO login_attempts (email, ip, successful, attempted_at)
     VALUES ($1, $2, $3, NOW())`,
    [normalizedEmail, ip || null, successful]
  );
}

async function isAccountLocked(email) {
  const normalizedEmail = lowerEmail(email);
  if (!normalizedEmail) return false;
  const windowStart = new Date(Date.now() - AUTH_LOCKOUT_WINDOW_MS).toISOString();
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS failed
       FROM login_attempts
      WHERE email = $1
        AND successful = FALSE
        AND attempted_at >= $2`,
    [normalizedEmail, windowStart]
  );
  return rows[0].failed >= AUTH_MAX_FAILED_ATTEMPTS;
}

async function clearLoginAttempts(email) {
  const normalizedEmail = lowerEmail(email);
  if (!normalizedEmail) return;
  await pool.query('DELETE FROM login_attempts WHERE email = $1', [normalizedEmail]);
}

export { clearLoginAttempts, isAccountLocked, recordLoginAttempt };

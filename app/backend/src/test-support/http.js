/**
 * Runs real route modules over HTTP for the integration tests, wired the way
 * server.js wires them: JSON body, cookie parser, async-error forwarding and
 * the same error handler. Rate limiters and CORS stay out; they are
 * server.js's job and would only make the tests order-dependent.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import { enableAsyncErrors, errorHandler, notFoundHandler } from '../middleware/errors.js';

/**
 * Starts an app with the given routers mounted, e.g. { '/api': batchesRouter }.
 * Import the routers with `await import()` after calling this module's
 * `prepareRoutes()`, so their handlers are registered with errors forwarded.
 */
export function prepareRoutes() {
  enableAsyncErrors();
}

export async function startApp(mounts) {
  const { buildCookieParser } = await import('../services/authService.js');
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(buildCookieParser());
  for (const [path, router] of Object.entries(mounts)) app.use(path, router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  /** fetch with JSON in and out; `token` signs the request in. */
  async function call(method, path, { token, body, headers = {} } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: response.status, json, headers: response.headers };
  }

  return { call, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** A password generated per run, so no credential-shaped literal is committed. */
export const testPassword = () => crypto.randomBytes(12).toString('hex');

/**
 * Creates (or replaces) an account and signs it in. Returns the row, its
 * password and a session token. Cheap bcrypt rounds: these are fixtures.
 */
export async function createAccount(pool, email, { role = 'user', status = 'active', departmentCode = null, password = testPassword() } = {}) {
  const auth = await import('../services/authService.js');
  await pool.query('DELETE FROM reviewers WHERE email = $1', [email]);
  const { rows: [reviewer] } = await pool.query(
    `INSERT INTO reviewers (email, display_name, role, status, password_hash, must_change_password, department_code)
     VALUES ($1, $1, $2, $3, $4, FALSE, $5) RETURNING *`,
    [email, role, status, await bcrypt.hash(password, 4), departmentCode]
  );
  const { tokenId, expiresAt } = await auth.createSession(reviewer.id);
  return { reviewer, password, token: auth.buildTokenPayload(reviewer, tokenId, expiresAt) };
}

/** The newest audit entry for an action, optionally for one entity. */
export async function lastAudit(pool, action, entityId = null) {
  const { rows } = await pool.query(
    `SELECT * FROM audit_log WHERE action = $1 AND ($2::text IS NULL OR entity_id = $2)
      ORDER BY id DESC LIMIT 1`,
    [action, entityId]
  );
  return rows[0] || null;
}

/**
 * The forced password change is enforced by the server, not only by the
 * browser's modal: until a temporary password is replaced, the session can
 * reach nothing but the endpoints that replace it.
 */
import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import { connectTestDatabase, skipWithoutDatabase } from '../test-support/database.js';

// `connectTestDatabase` hands back the pool db.js holds as a module
// singleton, so it is opened once for the whole file and closed once at the
// end. Closing it per describe left every later block with a dead pool.
let pool;

before(async () => { pool = await connectTestDatabase(); });
after(async () => { await pool?.end(); });

describe('forced password change', { skip: skipWithoutDatabase }, () => {
  let server;
  let base;
  let auth;

  before(async () => {
    auth = await import('./authService.js');
    const express = (await import('express')).default;
    const app = express();
    app.get('/api/batches', auth.requireAuth(), (_req, res) => res.json({ ok: true }));
    app.get('/api/auth/me', auth.requireAuth(), (_req, res) => res.json({ ok: true }));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { server?.close(); });

  async function login(email, mustChange) {
    await pool.query('DELETE FROM reviewers WHERE email = $1', [email]);
    const { rows: [reviewer] } = await pool.query(
      `INSERT INTO reviewers (email, display_name, role, password_hash, status, must_change_password)
       VALUES ($1, $1, 'admin', 'x', 'active', $2) RETURNING *`, [email, mustChange]
    );
    const { tokenId, expiresAt } = await auth.createSession(reviewer.id);
    return auth.buildTokenPayload(reviewer, tokenId, expiresAt);
  }
  const get = (path, token) => fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });

  test('a session with a temporary password can only reach the password endpoints', async () => {
    const token = await login('must-change@test', true);
    const blocked = await get('/api/batches', token);
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).code, 'PASSWORD_CHANGE_REQUIRED');
    assert.equal((await get('/api/auth/me', token)).status, 200);
  });

  test('a normal session is not affected', async () => {
    const token = await login('changed@test', false);
    assert.equal((await get('/api/batches', token)).status, 200);
  });
});

/**
 * Signing in with Google settles a pending temporary password, which is what
 * made the gate above a trap: it let someone in and then demanded a password
 * they had never been given, because changing one requires the current one.
 */
describe('a temporary password retired by Google sign-in', { skip: skipWithoutDatabase }, () => {
  let google;
  let bcrypt;

  before(async () => {
    google = await import('./googleAuthService.js');
    bcrypt = (await import('bcryptjs')).default;
  });

  /** An account holding a temporary password an administrator set and shared. */
  async function accountWithTemporaryPassword(email, { mustChange = true } = {}) {
    await pool.query('DELETE FROM reviewers WHERE email = $1', [email]);
    const hash = await bcrypt.hash('Temp-Password-1', 10);
    const { rows: [reviewer] } = await pool.query(
      `INSERT INTO reviewers (email, display_name, role, password_hash, status, must_change_password)
       VALUES ($1, $1, 'user', $2, 'active', $3) RETURNING *`,
      [email, hash, mustChange]
    );
    return reviewer;
  }
  const stored = async (id) => (await pool.query(
    'SELECT password_hash, must_change_password FROM reviewers WHERE id = $1', [id]
  )).rows[0];

  test('clears the flag, so the session is no longer refused everything', async () => {
    const reviewer = await accountWithTemporaryPassword('google-stuck@test');

    assert.equal(await google.retireTemporaryPassword(reviewer), true);
    assert.equal((await stored(reviewer.id)).must_change_password, false);
  });

  // Clearing the flag alone would leave a password a second person knows
  // working on an account that no longer asks anyone to change it.
  test('and retires the shared password rather than leaving it live', async () => {
    const reviewer = await accountWithTemporaryPassword('google-retire@test');
    await google.retireTemporaryPassword(reviewer);

    const after = await stored(reviewer.id);
    assert.equal(await bcrypt.compare('Temp-Password-1', after.password_hash), false,
      'the password the administrator shared no longer opens the account');
    assert.match(after.password_hash, /^google-only:/, 'and says why it cannot');
  });

  // bcrypt must reject the sentinel rather than throw on it, or every later
  // sign-in attempt for this account becomes a 500.
  test('leaves the account answering a wrong password, not erroring', async () => {
    const reviewer = await accountWithTemporaryPassword('google-login@test');
    await google.retireTemporaryPassword(reviewer);
    const { password_hash: retired } = await stored(reviewer.id);

    for (const attempt of ['', 'Temp-Password-1', retired]) {
      assert.equal(await bcrypt.compare(attempt, retired), false);
    }
  });

  // A password somebody chose themselves is not a shared secret, and while
  // Google is not yet the only way in it stays as a fallback.
  test('leaves a password the user chose alone', async () => {
    const reviewer = await accountWithTemporaryPassword('google-own-pw@test', { mustChange: false });

    assert.equal(await google.retireTemporaryPassword(reviewer), false);
    const after = await stored(reviewer.id);
    assert.equal(await bcrypt.compare('Temp-Password-1', after.password_hash), true,
      'their own password still signs them in');
  });
});

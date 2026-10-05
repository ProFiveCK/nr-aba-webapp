/**
 * The forced password change is enforced by the server, not only by the
 * browser's modal: until a temporary password is replaced, the session can
 * reach nothing but the endpoints that replace it.
 */
import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import { connectTestDatabase, skipWithoutDatabase } from '../test-support/database.js';

describe('forced password change', { skip: skipWithoutDatabase }, () => {
  let pool;
  let server;
  let base;
  let auth;

  before(async () => {
    pool = await connectTestDatabase();
    auth = await import('./authService.js');
    const express = (await import('express')).default;
    const app = express();
    app.get('/api/batches', auth.requireAuth(), (_req, res) => res.json({ ok: true }));
    app.get('/api/auth/me', auth.requireAuth(), (_req, res) => res.json({ ok: true }));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server?.close();
    await pool?.end();
  });

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

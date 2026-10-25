/**
 * The sign-in routes over HTTP, against a real Postgres: what a caller can
 * learn from a failed login, what a session cookie looks like, what changing
 * or resetting a password does to existing sessions, and what is audited.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import test, { after, before, describe } from 'node:test';
import { connectTestDatabase, skipWithoutDatabase } from '../test-support/database.js';
import { createAccount, lastAudit, prepareRoutes, startApp, testPassword } from '../test-support/http.js';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

describe('auth routes', { skip: skipWithoutDatabase }, () => {
  let pool;
  let app;

  before(async () => {
    pool = await connectTestDatabase();
    prepareRoutes();
    const { default: authRouter } = await import('./auth.js');
    app = await startApp({ '/api/auth': authRouter });
  });
  after(async () => {
    await app?.close();
    await pool?.end();
  });

  const login = (email, password) => app.call('POST', '/api/auth/login', { body: { email, password } });
  const clearLockout = (email) => pool.query("DELETE FROM login_attempts WHERE email = $1 OR email IN (SELECT 'account:' || id FROM reviewers WHERE email=$1)", [email]);

  test('an unknown account and a wrong password get the same answer, and both are audited', async () => {
    const { reviewer } = await createAccount(pool, 'auth-known@example.test');
    const unknown = await login('auth-nobody@example.test', testPassword());
    const wrong = await login('auth-known@example.test', testPassword());
    assert.deepEqual([unknown.status, unknown.json], [401, { message: 'Invalid credentials.' }]);
    assert.deepEqual([wrong.status, wrong.json], [unknown.status, unknown.json]);

    const failure = await lastAudit(pool, 'login.failure', reviewer.id);
    assert.equal(failure, null, 'a failed login is not attributed to the account it tried');
    const { rows } = await pool.query(
      "SELECT actor_email, metadata FROM audit_log WHERE action = 'login.failure' AND actor_email IN ('auth-nobody@example.test', 'auth-known@example.test') ORDER BY id DESC LIMIT 2"
    );
    assert.deepEqual(rows.map((r) => r.metadata.reason).sort(), ['unknown_account', 'wrong_password']);
    await clearLockout('auth-known@example.test');
  });

  test('an inactive account returns the same generic denial even with its former password', async () => {
    const { password } = await createAccount(pool, 'auth-inactive@example.test', { status: 'inactive' });
    assert.equal((await login('auth-inactive@example.test', testPassword())).status, 401);
    const right = await login('auth-inactive@example.test', password);
    assert.deepEqual([right.status, right.json.message], [401, 'Invalid credentials.']);
    // The caller learns nothing, but the audit log records that the account was inactive.
    const { rows: [last] } = await pool.query(
      "SELECT metadata FROM audit_log WHERE action = 'login.failure' AND actor_email = 'auth-inactive@example.test' ORDER BY id DESC LIMIT 1");
    assert.equal(last.metadata.reason, 'inactive');
    await clearLockout('auth-inactive@example.test');
  });

  test('a successful login sets an httpOnly session cookie and is audited', async () => {
    const { reviewer, password } = await createAccount(pool, 'auth-ok@example.test');
    const res = await login('auth-ok@example.test', password);
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie') || '';
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.equal((await lastAudit(pool, 'login.success', reviewer.id)).actor_id, reviewer.id);
  });

  test('changing a password needs 12 characters, ends every other session, and is audited', async () => {
    const { reviewer, password, token } = await createAccount(pool, 'auth-change@example.test');
    const short = await app.call('POST', '/api/auth/change-password', {
      token, body: { current_password: password, new_password: 'short1' },
    });
    assert.equal(short.status, 422);
    assert.match(short.json.message, /at least 12 characters/);

    const changed = await app.call('POST', '/api/auth/change-password', {
      token, body: { current_password: password, new_password: testPassword() },
    });
    assert.equal(changed.status, 200);
    assert.equal((await app.call('GET', '/api/auth/me', { token })).status, 401, 'the old session is gone');
    assert.equal((await app.call('GET', '/api/auth/me', { token: changed.json.token })).status, 200);
    assert.ok(await lastAudit(pool, 'password.change', reviewer.id));
  });

  test('reset tokens are stored hashed: the emailed token works, the stored value does not', async () => {
    const { reviewer, token: session } = await createAccount(pool, 'auth-reset@example.test');
    const raw = crypto.randomBytes(32).toString('hex');
    const store = () => pool.query(
      `INSERT INTO password_reset_tokens (reviewer_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')
       ON CONFLICT (reviewer_id) DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at`,
      [reviewer.id, sha256(raw)]
    );
    await store();
    const withStored = await app.call('POST', '/api/auth/reset-password', { body: { token: sha256(raw), new_password: testPassword() } });
    assert.equal(withStored.status, 400);

    const withRaw = await app.call('POST', '/api/auth/reset-password', { body: { token: raw, new_password: testPassword() } });
    assert.equal(withRaw.status, 200);
    assert.equal((await app.call('GET', '/api/auth/me', { token: session })).status, 401, 'sessions end on reset');
    assert.ok(await lastAudit(pool, 'password.reset', reviewer.id));
    const again = await app.call('POST', '/api/auth/reset-password', { body: { token: raw, new_password: testPassword() } });
    assert.equal(again.status, 400, 'a reset token works once');
  });

  const storeResetToken = (reviewerId, raw) => pool.query(
    `INSERT INTO password_reset_tokens (reviewer_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')
     ON CONFLICT (reviewer_id) DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at`,
    [reviewerId, sha256(raw)]
  );

  test('a reset token used by two requests at once works for exactly one', async () => {
    const { reviewer } = await createAccount(pool, 'auth-reset-race@example.test');
    const raw = crypto.randomBytes(32).toString('hex');
    await storeResetToken(reviewer.id, raw);
    const passwords = [testPassword(), testPassword(), testPassword()];
    const results = await Promise.all(passwords.map((new_password) =>
      app.call('POST', '/api/auth/reset-password', { body: { token: raw, new_password } })));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400, 400]);
    const winner = passwords[results.findIndex((r) => r.status === 200)];
    const { rows: [row] } = await pool.query('SELECT password_hash FROM reviewers WHERE id = $1', [reviewer.id]);
    assert.ok(await bcrypt.compare(winner, row.password_hash), 'the password is the winner\'s, not whichever request finished last');
  });

  test('a reset that cannot finish changes nothing and the token stays usable', async () => {
    const { reviewer, password } = await createAccount(pool, 'auth-reset-atomic@example.test');
    const raw = crypto.randomBytes(32).toString('hex');
    await storeResetToken(reviewer.id, raw);
    await pool.query(`CREATE OR REPLACE FUNCTION auth_test_refuse() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'refused by test'; END; $$ LANGUAGE plpgsql`);
    await pool.query('CREATE TRIGGER auth_test_refuse BEFORE DELETE ON reviewer_sessions FOR EACH ROW EXECUTE FUNCTION auth_test_refuse()');
    try {
      const res = await app.call('POST', '/api/auth/reset-password', { body: { token: raw, new_password: testPassword() } });
      assert.equal(res.status, 500);
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS auth_test_refuse ON reviewer_sessions');
    }
    const { rows: [row] } = await pool.query('SELECT password_hash FROM reviewers WHERE id = $1', [reviewer.id]);
    assert.ok(await bcrypt.compare(password, row.password_hash), 'the old password still works');
    const retry = await app.call('POST', '/api/auth/reset-password', { body: { token: raw, new_password: testPassword() } });
    assert.equal(retry.status, 200, 'the same token can be used again once the fault is gone');
  });

  test('asking for a reset stores only a hash of the emailed token', async () => {
    const { reviewer } = await createAccount(pool, 'auth-forgot@example.test');
    const res = await app.call('POST', '/api/auth/forgot-password', { body: { email: 'auth-forgot@example.test' } });
    assert.equal(res.status, 200);
    const { rows: [row] } = await pool.query('SELECT token FROM password_reset_tokens WHERE reviewer_id = $1', [reviewer.id]);
    assert.match(row.token, /^[0-9a-f]{64}$/);
    const useStored = await app.call('POST', '/api/auth/reset-password', { body: { token: row.token, new_password: testPassword() } });
    assert.equal(useStored.status, 400);
    assert.ok(await lastAudit(pool, 'password.reset_requested', reviewer.id));
  });

  test('logging out ends the session and is audited', async () => {
    const { reviewer, token } = await createAccount(pool, 'auth-logout@example.test');
    assert.equal((await app.call('POST', '/api/auth/logout', { token })).status, 204);
    assert.equal((await app.call('GET', '/api/auth/me', { token })).status, 401);
    assert.ok(await lastAudit(pool, 'logout', reviewer.id));
  });
});

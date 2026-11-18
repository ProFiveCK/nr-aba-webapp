/**
 * Sign-up requests reach the administrators only once the person proves the
 * address is theirs, approval is all-or-nothing, and two administrators cannot
 * delete each other at the same moment and leave none.
 */
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import test, { after, before, describe } from 'node:test';
import { connectTestDatabase, skipWithoutDatabase } from '../test-support/database.js';
import { createAccount, lastAudit, prepareRoutes, startApp, testPassword } from '../test-support/http.js';

describe('sign-up confirmation and account removal', { skip: skipWithoutDatabase }, () => {
  let pool;
  let app;
  let admin;
  const unique = (label) => `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

  before(async () => {
    pool = await connectTestDatabase();
    prepareRoutes();
    const { default: adminRouter } = await import('./admin.js');
    const { default: authRouter } = await import('./auth.js');
    app = await startApp({ '/api': adminRouter, '/api/auth': authRouter });
    admin = await createAccount(pool, unique('signup-admin'), { role: 'admin' });
  });
  after(async () => {
    await app?.close();
    await pool?.end();
  });

  const signup = (email, extra = {}) => app.call('POST', '/api/auth/signup', {
    body: { email, name: 'Signup Person', password: testPassword(), department_code: '12', ...extra },
  });
  const verify = (token) => app.call('POST', '/api/auth/verify-signup', { body: { token } });
  const requestFor = async (email) => (await pool.query('SELECT * FROM signup_requests WHERE email = $1', [email])).rows[0];
  /** The emailed token is random; the test replaces its stored hash with one it knows. */
  const knownToken = async (email) => {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query('UPDATE signup_requests SET verification_token_hash = $2 WHERE email = $1', [email, sha256(token)]);
    return token;
  };
  const listed = async (email) => (await app.call('GET', '/api/admin/signup-requests', { token: admin.token })).json
    .some((row) => row.email === email);
  const approve = (id, body = {}) => app.call('POST', `/api/admin/signup-requests/${id}/approve`, { token: admin.token, body });

  test('a request stays hidden and cannot be approved until the address is confirmed, and a link works once', async () => {
    const email = unique('confirm');
    const submitted = await signup(email);
    assert.equal(submitted.status, 201);
    assert.match(submitted.json.message, /Check your email/);

    const request = await requestFor(email);
    assert.equal(request.email_verified_at, null);
    assert.match(request.verification_token_hash, /^[a-f0-9]{64}$/, 'only a hash of the token is stored');
    assert.ok(request.verification_expires_at > new Date(), 'the link has an expiry');
    assert.equal(await listed(email), false, 'administrators do not see an unconfirmed request');
    assert.equal((await approve(request.id)).status, 409, 'nor can they approve one');

    const token = await knownToken(email);
    const confirmed = await verify(token);
    assert.equal(confirmed.status, 200);
    const after = await requestFor(email);
    assert.notEqual(after.email_verified_at, null);
    assert.equal(after.verification_token_hash, null, 'the token is spent');
    assert.ok(await lastAudit(pool, 'signup.email_verified', request.id));
    assert.equal(await listed(email), true);

    assert.equal((await verify(token)).status, 400, 'a link works once');
    assert.equal((await verify('not-a-token')).status, 400);
    assert.equal((await signup(email)).status, 409, 'a confirmed request still blocks a second one, as before');

    const approved = await approve(request.id);
    assert.equal(approved.status, 200);
    const { rows: [account] } = await pool.query('SELECT id FROM reviewers WHERE email = $1', [email]);
    assert.ok(account);
  });

  test('an expired link fails, and filling the form in again issues a new link and needs a new confirmation', async () => {
    const email = unique('expired');
    assert.equal((await signup(email)).status, 201);
    const stale = await knownToken(email);
    await pool.query("UPDATE signup_requests SET verification_expires_at = NOW() - INTERVAL '1 minute' WHERE email = $1", [email]);
    assert.equal((await verify(stale)).status, 400);

    // Straight away, a second submission sends nothing new, so the form cannot flood a mailbox.
    const before = await requestFor(email);
    assert.equal((await signup(email, { name: 'Someone Else' })).status, 200);
    assert.equal((await requestFor(email)).name, before.name);

    await pool.query("UPDATE signup_requests SET created_at = NOW() - INTERVAL '10 minutes' WHERE email = $1", [email]);
    assert.equal((await signup(email, { name: 'The Real Owner' })).status, 200);
    const replaced = await requestFor(email);
    assert.equal(replaced.name, 'The Real Owner', 'an unconfirmed request can be replaced by whoever owns the address');
    assert.notEqual(replaced.verification_token_hash, before.verification_token_hash, 'with a new link');
    assert.ok(replaced.verification_expires_at > new Date());
    assert.equal((await verify(stale)).status, 400, 'the old link no longer works');
    assert.equal((await verify(await knownToken(email))).status, 200);

    // A rejected request sent again has to be confirmed again.
    await app.call('POST', `/api/admin/signup-requests/${replaced.id}/reject`, { token: admin.token, body: {} });
    assert.equal((await signup(email)).status, 200);
    assert.equal((await requestFor(email)).email_verified_at, null);
    assert.equal(await listed(email), false);
  });

  test('approval is all-or-nothing, and a request cannot be approved twice', async () => {
    const email = unique('atomic');
    await signup(email, { requested_apps: [] });
    await verify(await knownToken(email));
    const request = await requestFor(email);

    // Fail the last write of the approval: nothing before it may survive.
    await pool.query(`CREATE OR REPLACE FUNCTION test_fail_signup_update() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated failure'; END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER test_fail_signup_update BEFORE UPDATE ON signup_requests
      FOR EACH ROW WHEN (NEW.status = 'approved') EXECUTE FUNCTION test_fail_signup_update()`);
    try {
      assert.equal((await approve(request.id, { role: 'reviewer' })).status, 500);
    } finally {
      await pool.query('DROP TRIGGER test_fail_signup_update ON signup_requests');
      await pool.query('DROP FUNCTION test_fail_signup_update()');
    }
    assert.equal((await pool.query('SELECT 1 FROM reviewers WHERE email = $1', [email])).rowCount, 0, 'no account without its access');
    assert.equal((await requestFor(email)).status, 'pending');

    const results = await Promise.all([approve(request.id, { role: 'reviewer' }), approve(request.id, { role: 'reviewer' })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    const { rows: [account] } = await pool.query('SELECT id FROM reviewers WHERE email = $1', [email]);
    const { rows } = await pool.query('SELECT capability FROM reviewer_capabilities WHERE reviewer_id = $1', [account.id]);
    assert.ok(rows.some((row) => row.capability === 'review_forex_tt'), 'the access was saved with the account');
  });

  test('requests made before confirmation existed stay visible to administrators', async () => {
    const email = unique('legacy');
    await pool.query(`ALTER TABLE signup_requests DROP COLUMN email_verified_at,
      DROP COLUMN verification_token_hash, DROP COLUMN verification_expires_at`);
    await pool.query(`INSERT INTO signup_requests (email, name, password_hash) VALUES ($1, 'Legacy Person', 'x')`, [email]);
    const { initSchema } = await import('../db.js');
    await initSchema();
    assert.notEqual((await requestFor(email)).email_verified_at, null);
    assert.equal(await listed(email), true);

    // Only when the column is first added: a later unconfirmed request stays unconfirmed.
    const fresh = unique('after-upgrade');
    await signup(fresh);
    await initSchema();
    assert.equal((await requestFor(fresh)).email_verified_at, null);
  });

  test('a new account created without a role is an ordinary user', async () => {
    const created = await app.call('POST', '/api/reviewers', { token: admin.token, body: { email: unique('no-role'), department_code: '12' } });
    assert.equal(created.status, 201);
    assert.equal(created.json.reviewer.role, 'user');
  });

  test('two administrators deleting each other at once leave one, and inactive administrators do not count', async () => {
    const first = await createAccount(pool, unique('del-a'), { role: 'admin' });
    const second = await createAccount(pool, unique('del-b'), { role: 'admin' });
    const dormant = await createAccount(pool, unique('del-dormant'), { role: 'admin', status: 'inactive' });
    // Only these two are active administrators while the test runs.
    const { rows: others } = await pool.query(
      "UPDATE reviewers SET status = 'inactive' WHERE role = 'admin' AND status = 'active' AND id <> ALL($1::uuid[]) RETURNING id",
      [[first.reviewer.id, second.reviewer.id]]);
    try {
      const results = await Promise.all([
        app.call('DELETE', `/api/reviewers/${second.reviewer.id}`, { token: first.token }),
        app.call('DELETE', `/api/reviewers/${first.reviewer.id}`, { token: second.token }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [204, 400]);
      const { rows: [left] } = await pool.query(
        "SELECT count(*)::int AS n FROM reviewers WHERE role = 'admin' AND status = 'active' AND id = ANY($1::uuid[])",
        [[first.reviewer.id, second.reviewer.id]]);
      assert.equal(left.n, 1);

      const survivor = results[0].status === 204 ? first : second;
      assert.equal((await app.call('DELETE', `/api/reviewers/${dormant.reviewer.id}`, { token: survivor.token })).status, 204,
        'an inactive administrator can be removed');
    } finally {
      await pool.query("UPDATE reviewers SET status = 'active' WHERE id = ANY($1::uuid[])", [others.map((row) => row.id)]);
    }
  });
});

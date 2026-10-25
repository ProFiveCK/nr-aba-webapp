/**
 * Changing the email an account signs in with, over HTTP against a real
 * Postgres. The address is a login ID that is copied and matched in several
 * places, so a change must move all of them together and end anything that was
 * delivered to the old mailbox.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, describe } from 'node:test';
import { connectTestDatabase, createEmployee, skipWithoutDatabase } from '../test-support/database.js';
import { createAccount, lastAudit, prepareRoutes, startApp } from '../test-support/http.js';

const reason = 'Staff member changed their work email address.';

describe('account administration routes', { skip: skipWithoutDatabase }, () => {
  let pool;
  let app;
  let admin;
  const unique = (label) => `${label}-${randomUUID().slice(0, 8)}@example.test`;

  before(async () => {
    pool = await connectTestDatabase();
    prepareRoutes();
    const { default: adminRouter } = await import('./admin.js');
    const { default: authRouter } = await import('./auth.js');
    app = await startApp({ '/api': adminRouter, '/api/auth': authRouter });
    admin = await createAccount(pool, unique('admin'), { role: 'admin' });
  });
  after(async () => {
    await app?.close();
    await pool?.end();
  });

  const change = (id, email, body = {}) =>
    app.call('POST', `/api/reviewers/${id}/email`, { token: admin.token, body: { email, reason, ...body } });
  const login = (email, password) => app.call('POST', '/api/auth/login', { body: { email, password } });

  test('the login moves, and everything tied to the old address ends', async () => {
    const oldEmail = unique('old');
    const newEmail = unique('new').toUpperCase();
    const person = await createAccount(pool, oldEmail);
    const id = person.reviewer.id;

    const employee = await createEmployee(pool, { name: 'Email Change Employee' });
    await pool.query('UPDATE hr_employees SET reviewer_id = $2, email = $3 WHERE id = $1', [employee.id, id, oldEmail]);
    await pool.query(`INSERT INTO password_reset_tokens (reviewer_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`, [id, randomUUID()]);
    await pool.query(
      `INSERT INTO hr_account_tokens (reviewer_id, employee_id, payroll_id, purpose, token_hash, expires_at, handover, reason)
       VALUES ($1, $2, 'P-1', 'recovery', $3, NOW() + INTERVAL '1 day', 'in_person', $4)`, [id, employee.id, randomUUID(), reason]);
    await pool.query(
      `INSERT INTO reviewer_identities (reviewer_id, provider, provider_subject, email) VALUES ($1, 'google', $2, $3)`,
      [id, randomUUID(), oldEmail]);
    // A batch from before submissions were tied to an account id: matched only by address.
    await pool.query(
      `INSERT INTO batch_archives (batch_id, root_batch_id, file_name, file_path, code, submitted_email) VALUES ($1, $1, 'legacy.aba', 'x', $2, $3)`,
      [randomUUID(), `LEGACY-${randomUUID().slice(0, 8)}`, oldEmail]);

    const res = await change(id, newEmail);
    assert.equal(res.status, 200);
    assert.deepEqual([res.json.email, res.json.previous_email], [newEmail.toLowerCase(), oldEmail]);

    assert.equal((await login(newEmail.toLowerCase(), person.password)).status, 200, 'the new address signs in, any case');
    assert.equal((await login(oldEmail, person.password)).status, 401, 'the old address no longer does');
    assert.equal((await app.call('GET', '/api/auth/me', { token: person.token })).status, 401, 'old sessions end');

    const count = async (sql) => (await pool.query(sql, [id])).rows[0].n;
    assert.equal(await count('SELECT count(*)::int AS n FROM password_reset_tokens WHERE reviewer_id = $1'), 0);
    assert.equal(await count('SELECT count(*)::int AS n FROM hr_account_tokens WHERE reviewer_id = $1 AND revoked_at IS NULL'), 0);
    assert.equal(await count('SELECT count(*)::int AS n FROM reviewer_identities WHERE reviewer_id = $1'), 0, 'the Google link must be re-made on the new address');
    assert.equal(await count('SELECT count(*)::int AS n FROM batch_archives WHERE submitted_by = $1'), 1, 'legacy batches stay with this person');
    assert.equal((await pool.query('SELECT email FROM hr_employees WHERE id = $1', [employee.id])).rows[0].email, newEmail.toLowerCase(),
      'the employee contact follows the login');

    const audit = await lastAudit(pool, 'reviewer.email_changed', id);
    assert.deepEqual([audit.before.email, audit.after.email, audit.actor_id], [oldEmail, newEmail.toLowerCase(), admin.reviewer.id]);
  });

  test('an address another account, a login ID or a pending sign-up uses is refused; so is nonsense', async () => {
    const person = await createAccount(pool, unique('person'));
    const other = await createAccount(pool, unique('other'));
    const id = person.reviewer.id;

    assert.equal((await change(id, other.reviewer.email.toUpperCase())).status, 409, 'case-insensitive clash');
    const pendingEmail = unique('pending');
    await pool.query(`INSERT INTO signup_requests (email, name, password_hash) VALUES ($1, 'Pending Person', 'x')`, [pendingEmail]);
    assert.equal((await change(id, pendingEmail)).status, 409, 'a pending sign-up request holds the address');
    assert.equal((await change(id, person.reviewer.email)).status, 400, 'no change to make');
    assert.equal((await change(id, 'not-an-email')).status, 422);
    assert.equal((await change(id, unique('fine'), { reason: 'short' })).status, 422);
    assert.equal((await change(randomUUID(), unique('ghost'))).status, 404);
    assert.equal((await pool.query('SELECT email FROM reviewers WHERE id = $1', [id])).rows[0].email, person.reviewer.email,
      'nothing changed');
  });

  test('two accounts racing for one address: exactly one gets it', async () => {
    const a = await createAccount(pool, unique('race-a'));
    const b = await createAccount(pool, unique('race-b'));
    const wanted = unique('wanted');
    const results = await Promise.all([change(a.reviewer.id, wanted), change(b.reviewer.id, wanted)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM reviewers WHERE lower(email) = $1', [wanted])).rows[0].n, 1);
  });

  test('only an administrator can change an email', async () => {
    const reviewer = await createAccount(pool, unique('reviewer'), { role: 'reviewer' });
    const target = await createAccount(pool, unique('target'));
    const res = await app.call('POST', `/api/reviewers/${target.reviewer.id}/email`, {
      token: reviewer.token, body: { email: unique('x'), reason },
    });
    assert.equal(res.status, 403);
  });

  const edit = (caller, id, body) => app.call('PUT', `/api/reviewers/${id}`, { token: caller.token, body });

  test('the last active administrator cannot be demoted or deactivated; with a second one it can', async () => {
    const sole = await createAccount(pool, unique('sole-admin'), { role: 'admin' });
    const others = (await pool.query("SELECT id FROM reviewers WHERE role = 'admin' AND status = 'active' AND id <> $1", [sole.reviewer.id])).rows.map((r) => r.id);
    await pool.query("UPDATE reviewers SET status = 'inactive' WHERE id = ANY($1::uuid[])", [others]);
    try {
      const demote = await edit(sole, sole.reviewer.id, { role: 'reviewer', department_code: '12' });
      assert.equal(demote.status, 400);
      assert.match(demote.json.message, /At least one admin/);
      assert.equal((await edit(sole, sole.reviewer.id, { status: 'inactive' })).status, 400);
      assert.equal((await pool.query('SELECT role, status FROM reviewers WHERE id = $1', [sole.reviewer.id])).rows[0].role, 'admin');

      await createAccount(pool, unique('second-admin'), { role: 'admin' });
      assert.equal((await edit(sole, sole.reviewer.id, { role: 'reviewer' })).status, 200, 'allowed once another administrator exists');
    } finally {
      await pool.query("UPDATE reviewers SET status = 'active' WHERE id = ANY($1::uuid[])", [others]);
    }
  });

  test('saving permissions merges into what is stored instead of replacing it', async () => {
    const admin = await createAccount(pool, unique('perm-admin'), { role: 'admin' });
    const person = await createAccount(pool, unique('perm-person'), { role: 'reviewer' });
    await pool.query(`UPDATE reviewers SET permissions = '{"hr_leave_approve": false, "keep_me": true}'::jsonb WHERE id = $1`, [person.reviewer.id]);
    const res = await edit(admin, person.reviewer.id, { permissions: { notify_forex_tt_submissions: true } });
    assert.equal(res.status, 200);
    const { rows: [row] } = await pool.query('SELECT permissions FROM reviewers WHERE id = $1', [person.reviewer.id]);
    assert.deepEqual(row.permissions, { hr_leave_approve: false, keep_me: true, notify_forex_tt_submissions: true },
      'an explicit denial and unrelated keys survive');
  });

  test('profile and capabilities save together, and capability changes are audited with before and after', async () => {
    const admin = await createAccount(pool, unique('cap-admin'), { role: 'admin' });
    const person = await createAccount(pool, unique('cap-person'), { role: 'user', departmentCode: '12', capabilities: ['hr_access'] });
    const id = person.reviewer.id;

    const ok = await edit(admin, id, { display_name: 'Renamed Person', capabilities: ['hr_access', 'hr_leave_apply'] });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.reviewer.explicit_capabilities, ['hr_access', 'hr_leave_apply']);
    const audit = await lastAudit(pool, 'reviewer.capabilities.set', id);
    assert.deepEqual([audit.before.capabilities, audit.after.capabilities], [['hr_access'], ['hr_access', 'hr_leave_apply']]);

    // If the capability write fails, the name change must not stay behind.
    await pool.query(`CREATE OR REPLACE FUNCTION admin_test_refuse() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'refused by test'; END; $$ LANGUAGE plpgsql`);
    await pool.query('CREATE TRIGGER admin_test_refuse BEFORE INSERT ON reviewer_capabilities FOR EACH ROW EXECUTE FUNCTION admin_test_refuse()');
    try {
      const failed = await edit(admin, id, { display_name: 'Should Not Stick', capabilities: ['hr_access', 'hr_leave_apply', 'hr_report_read'] });
      assert.equal(failed.status, 500);
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS admin_test_refuse ON reviewer_capabilities');
    }
    assert.equal((await pool.query('SELECT display_name FROM reviewers WHERE id = $1', [id])).rows[0].display_name, 'Renamed Person');
    const list = await app.call('GET', '/api/reviewers', { token: admin.token });
    assert.deepEqual(list.json.find((r) => r.id === id).explicit_capabilities, ['hr_access', 'hr_leave_apply'],
      'the list reports what was actually granted, apart from anything derived');
  });
});

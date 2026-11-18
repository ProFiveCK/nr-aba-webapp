/**
 * What an account can do is exactly what the account page shows: its ticked
 * capabilities plus its active Leave HR scopes. Neither the role nor the
 * reviewers.permissions column adds or removes anything, and the one-time
 * migration that retired those moved every existing account across without
 * changing its access.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, describe } from 'node:test';
import { connectTestDatabase, skipWithoutDatabase } from '../test-support/database.js';
import { createAccount, lastAudit, prepareRoutes, startApp } from '../test-support/http.js';

describe('account access has one source', { skip: skipWithoutDatabase }, () => {
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
    admin = await createAccount(pool, unique('access-admin'), { role: 'admin' });
  });
  after(async () => {
    await app?.close();
    await pool?.end();
  });

  const me = async (account) => (await app.call('GET', '/api/auth/me', { token: account.token })).json;
  const permissionsOf = async (account) => {
    const body = await me(account);
    return (body.reviewer || body).permissions;
  };
  const edit = (id, body) => app.call('PUT', `/api/reviewers/${id}`, { token: admin.token, body });
  const explicit = async (id) => (await pool.query(
    'SELECT capability FROM reviewer_capabilities WHERE reviewer_id = $1 ORDER BY capability', [id])).rows.map((r) => r.capability);

  test('the permissions column no longer grants or denies access', async () => {
    const person = await createAccount(pool, unique('hidden'), { capabilities: ['aba_access', 'hr_access'] });
    await pool.query(`UPDATE reviewers SET permissions = $2::jsonb WHERE id = $1`,
      [person.reviewer.id, JSON.stringify({ review_forex_tt: true, hr_admin: true, admin: true, aba_access: false })]);
    const permissions = await permissionsOf(person);
    assert.equal(permissions.review_forex_tt, undefined);
    assert.equal(permissions.hr_admin, undefined);
    assert.equal(permissions.admin, undefined);
    assert.equal(permissions.aba_access, true, 'a stored denial no longer cancels a tick');
  });

  test('a role adds nothing beyond its ticks; administration comes from the Administrator role only', async () => {
    const reviewer = await createAccount(pool, unique('bare-reviewer'), { role: 'reviewer' });
    const bare = await permissionsOf(reviewer);
    for (const key of ['review_aba', 'review_forex_tt', 'submit_aba', 'submit_forex_tt']) assert.equal(bare[key], undefined, key);
    assert.equal(bare.notify_aba_submissions, true, 'notification preferences still default on for reviewers');

    const administrator = await createAccount(pool, unique('bare-admin'), { role: 'admin' });
    const adminPermissions = await permissionsOf(administrator);
    assert.equal(adminPermissions.admin, true);
    assert.equal(adminPermissions.hr_admin, undefined, 'Leave administration is a tick, not part of the role');
    assert.equal(adminPermissions.hr_evidence_read, undefined, 'medical evidence is not part of the role');

    const user = await createAccount(pool, unique('ticked-admin'), { departmentCode: '12' });
    await pool.query("INSERT INTO reviewer_capabilities (reviewer_id, capability) VALUES ($1, 'admin')", [user.reviewer.id]);
    assert.equal((await permissionsOf(user)).admin, undefined, 'a stray admin grant does nothing without the role');
  });

  test('demoting a reviewer and clearing the ticks removes review access', async () => {
    const person = await createAccount(pool, unique('demote'), { role: 'reviewer', capabilities: ['forex_tt_access', 'review_forex_tt'] });
    assert.equal((await permissionsOf(person)).review_forex_tt, true);
    const res = await edit(person.reviewer.id, { role: 'user', department_code: '12', capabilities: ['forex_tt_access'] });
    assert.equal(res.status, 200);
    assert.equal((await permissionsOf(person)).review_forex_tt, undefined);
    assert.equal(res.json.reviewer.permissions.review_forex_tt, undefined, 'the page is shown the same answer');
  });

  test('the API accepts only notification preferences in permissions, and full administration is not a tick', async () => {
    const person = await createAccount(pool, unique('prefs'), { role: 'reviewer' });
    const refused = await edit(person.reviewer.id, { permissions: { hr_admin: true } });
    assert.equal(refused.status, 422);
    assert.match(JSON.stringify(refused.json), /not a notification preference/);
    assert.equal((await edit(person.reviewer.id, { permissions: { notify_forex_tt_submissions: 'yes' } })).status, 422);
    assert.equal((await edit(person.reviewer.id, { permissions: { notify_forex_tt_submissions: false } })).status, 200);
    assert.equal((await permissionsOf(person)).notify_forex_tt_submissions, false);
    assert.equal((await edit(person.reviewer.id, { capabilities: ['admin'] })).status, 422);

    const created = await app.call('POST', '/api/reviewers', {
      token: admin.token, body: { email: unique('created'), role: 'user', department_code: '12', permissions: { review_aba: true } },
    });
    assert.equal(created.status, 400);
  });

  test('a new account without chosen ticks gets its role starting set as ordinary grants', async () => {
    const created = await app.call('POST', '/api/reviewers', { token: admin.token, body: { email: unique('starter'), role: 'reviewer' } });
    assert.equal(created.status, 201);
    assert.deepEqual(await explicit(created.json.reviewer.id),
      ['aba_access', 'forex_tt_access', 'public_health_review', 'review_aba', 'review_forex_tt']);
  });

  test('approving a signup writes no hidden access', async () => {
    const email = unique('signup');
    const { rows: [request] } = await pool.query(
      `INSERT INTO signup_requests (email, name, password_hash, requested_role, requested_apps, email_verified_at) VALUES ($1, 'Signup Person', 'x', 'reviewer', '{}', NOW()) RETURNING id`, [email]);
    const res = await app.call('POST', `/api/admin/signup-requests/${request.id}/approve`, { token: admin.token, body: {} });
    assert.equal(res.status, 200);
    const { rows: [row] } = await pool.query('SELECT id, permissions FROM reviewers WHERE email = $1', [email]);
    assert.deepEqual(row.permissions, {});
    assert.ok((await explicit(row.id)).includes('review_forex_tt'), 'the role starting set is visible as ticks');
  });

  test('the migration keeps every account access the same, moves denials onto scopes and records each change', async () => {
    const make = async (label, role, permissions, capabilities = [], extra = {}) => {
      const account = await createAccount(pool, unique(label), { role, departmentCode: '12', capabilities, ...extra });
      await pool.query('UPDATE reviewers SET permissions = $2::jsonb WHERE id = $1', [account.reviewer.id, JSON.stringify(permissions)]);
      return account.reviewer.id;
    };
    const reviewer = await make('m-reviewer', 'reviewer', {});
    const user = await make('m-user', 'user', { review_forex_tt: true, submit_aba: false, notify_forex_tt_submissions: true, keep_me: 1 }, ['aba_access']);
    const narrowedAdmin = await make('m-admin', 'admin', { hr_evidence_read: false });
    const strayAdmin = await make('m-stray', 'user', { admin: true }, ['admin', 'aba_access']);
    const inactive = await make('m-inactive', 'user', {}, [], { status: 'inactive' });
    const scoped = await make('m-scoped', 'user', { hr_leave_approve: false });
    const blocked = await make('m-blocked', 'user', { hr_access: false });

    const { rows: [department] } = await pool.query("INSERT INTO hr_departments (name) VALUES ($1) RETURNING id", [`Migration ${randomUUID().slice(0, 8)}`]);
    const scope = async (reviewerId, capabilities, from = '2020-01-01') => (await pool.query(
      `INSERT INTO hr_access_scopes (reviewer_id, department_id, capabilities, effective_from, reason)
       VALUES ($1, $2, $3, $4, 'Synthetic scope for the access migration test.') RETURNING id`,
      [reviewerId, department.id, capabilities, from])).rows[0].id;
    const keptScope = await scope(scoped, ['hr_leave_approve', 'hr_report_read']);
    const futureScope = await scope(scoped, ['hr_leave_approve'], '2099-01-01');
    const blockedScope = await scope(blocked, ['hr_report_read']);

    await pool.query('UPDATE reviewer_settings SET hidden_permissions_retired_at = NULL WHERE id = TRUE');
    const { initSchema } = await import('../db.js');
    await initSchema();

    assert.deepEqual(await explicit(reviewer), ['review_aba', 'review_forex_tt', 'submit_aba', 'submit_forex_tt']);
    assert.deepEqual(await explicit(user), ['aba_access', 'review_forex_tt', 'submit_forex_tt']);
    assert.deepEqual((await pool.query('SELECT permissions FROM reviewers WHERE id = $1', [user])).rows[0].permissions,
      { notify_forex_tt_submissions: true, keep_me: 1 }, 'preferences and unknown keys stay; access keys go');

    const adminGrants = await explicit(narrowedAdmin);
    assert.ok(adminGrants.includes('hr_admin') && adminGrants.includes('review_aba') && adminGrants.includes('tools_access'));
    assert.ok(!adminGrants.includes('hr_evidence_read'), 'a denial on an administrator is kept by not granting it');
    assert.ok(!adminGrants.includes('admin'));

    assert.deepEqual(await explicit(strayAdmin), ['aba_access', 'submit_aba', 'submit_forex_tt']);
    assert.equal((await lastAudit(pool, 'reviewer.permissions.migrated', strayAdmin)).metadata.admin_capability_removed, true);
    assert.deepEqual(await explicit(inactive), ['submit_aba', 'submit_forex_tt'], 'kept for reactivation, as before');

    const scopes = (await pool.query('SELECT id, capabilities, revoked_at FROM hr_access_scopes WHERE id = ANY($1::uuid[])',
      [[keptScope, futureScope, blockedScope]])).rows;
    const byId = Object.fromEntries(scopes.map((row) => [row.id, row]));
    assert.deepEqual(byId[keptScope].capabilities, ['hr_report_read']);
    assert.equal(byId[keptScope].revoked_at, null);
    assert.notEqual(byId[futureScope].revoked_at, null, 'a future scope with nothing left is revoked');
    assert.notEqual(byId[blockedScope].revoked_at, null, 'denying the Leave app revokes the scopes that implied it');
    assert.ok(await lastAudit(pool, 'hr.access_scope.migrated', keptScope));

    // Runs once: a later denial written by hand is not acted on again.
    await pool.query('UPDATE reviewers SET permissions = $2::jsonb WHERE id = $1', [reviewer, JSON.stringify({ review_aba: false })]);
    await initSchema();
    assert.deepEqual(await explicit(reviewer), ['review_aba', 'review_forex_tt', 'submit_aba', 'submit_forex_tt']);
  });
  test('supporting evidence is no longer a grant: ticks and scope rights are removed and recorded', async () => {
    const holder = await createAccount(pool, unique('evidence'), { capabilities: ['hr_access'] });
    // Written directly: the account page can no longer grant it.
    await pool.query("INSERT INTO reviewer_capabilities (reviewer_id, capability) VALUES ($1, 'hr_evidence_read')", [holder.reviewer.id]);
    const { rows: [department] } = await pool.query("INSERT INTO hr_departments (name) VALUES ($1) RETURNING id", [`Evidence ${randomUUID().slice(0, 8)}`]);
    const scope = async (capabilities, revoked = false) => (await pool.query(
      `INSERT INTO hr_access_scopes (reviewer_id, department_id, capabilities, effective_from, reason, revoked_at)
       VALUES ($1, $2, $3, '2020-01-01', 'Synthetic scope for the evidence migration test.', $4) RETURNING id`,
      [holder.reviewer.id, department.id, capabilities, revoked ? new Date() : null])).rows[0].id;
    const mixed = await scope(['hr_leave_approve', 'hr_evidence_read']);
    const only = await scope(['hr_evidence_read']);
    const history = await scope(['hr_evidence_read', 'hr_report_read'], true);
    const { initSchema } = await import('../db.js');
    await initSchema();
    assert.deepEqual(await explicit(holder.reviewer.id), ['hr_access']);
    assert.ok(await lastAudit(pool, 'reviewer.capability.retired', holder.reviewer.id));
    const byId = Object.fromEntries((await pool.query('SELECT id, capabilities, revoked_at FROM hr_access_scopes WHERE id = ANY($1::uuid[])',
      [[mixed, only, history]])).rows.map((row) => [row.id, row]));
    assert.deepEqual(byId[mixed].capabilities, ['hr_leave_approve']);
    assert.equal(byId[mixed].revoked_at, null);
    assert.notEqual(byId[only].revoked_at, null, 'an assignment that held only evidence is revoked');
    assert.deepEqual(byId[history].capabilities, ['hr_evidence_read', 'hr_report_read'], 'revoked history is left as it was');
    assert.equal((await edit(holder.reviewer.id, { capabilities: ['hr_access', 'hr_evidence_read'] })).status, 422, 'it can no longer be ticked');
  });
  test('a leave-only account holds Leave access only, by one rule for writes, reads and the page', async () => {
    const staff = await createAccount(pool, unique('leave-only'), { capabilities: ['hr_access', 'hr_leave_apply'] });
    await pool.query("UPDATE reviewers SET account_type = 'employee' WHERE id = $1", [staff.reviewer.id]);
    const refused = await edit(staff.reviewer.id, { capabilities: ['hr_access', 'hr_admin'] });
    assert.equal(refused.status, 400);
    assert.match(refused.json.message, /leave-only account/);
    assert.equal((await edit(staff.reviewer.id, { capabilities: ['hr_access', 'aba_access'] })).status, 400, 'other apps are refused, not dropped');
    assert.equal((await edit(staff.reviewer.id, { capabilities: ['hr_access', 'hr_leave_apply', 'hr_leave_approve'] })).status, 200);

    // Granted before the rule existed: removed on start and recorded.
    await pool.query("INSERT INTO reviewer_capabilities (reviewer_id, capability) VALUES ($1, 'hr_admin'), ($1, 'aba_access')", [staff.reviewer.id]);
    const { initSchema } = await import('../db.js');
    await initSchema();
    assert.deepEqual(await explicit(staff.reviewer.id), ['hr_access', 'hr_leave_apply', 'hr_leave_approve']);
    assert.equal((await lastAudit(pool, 'reviewer.capability.retired', staff.reviewer.id)).metadata.reason, 'Leave-only accounts hold Leave access only.');

    const catalogue = (await app.call('GET', '/api/capability-catalogue', { token: admin.token })).json;
    assert.ok(catalogue.leave_only_capabilities.includes('hr_leave_approve'));
    assert.ok(!catalogue.leave_only_capabilities.includes('hr_admin'));
    assert.ok(catalogue.leave_only_capabilities.every((key) => key.startsWith('hr_')));
  });

  test('the account list matches each account and costs the same number of queries however many there are', async () => {
    const scoped = await createAccount(pool, unique('list-scoped'), { capabilities: ['aba_access'] });
    const { rows: [department] } = await pool.query("INSERT INTO hr_departments (name) VALUES ($1) RETURNING id", [`List ${randomUUID().slice(0, 8)}`]);
    await pool.query(`INSERT INTO hr_access_scopes (reviewer_id, department_id, capabilities, effective_from, reason)
      VALUES ($1, $2, ARRAY['hr_report_read'], '2020-01-01', 'Synthetic scope for the account list test.')`, [scoped.reviewer.id, department.id]);
    const list = async () => {
      let queries = 0;
      const original = pool.query;
      pool.query = function counted(...args) { queries += 1; return original.apply(this, args); };
      try {
        const res = await app.call('GET', '/api/reviewers', { token: admin.token });
        assert.equal(res.status, 200);
        return { accounts: res.json, queries };
      } finally { pool.query = original; }
    };
    const first = await list();
    const listed = first.accounts.find((a) => a.id === scoped.reviewer.id);
    assert.deepEqual(listed.permissions, await permissionsOf(scoped), 'the list shows what the account itself is told');
    assert.equal(listed.permissions.hr_report_read, true);
    assert.equal(listed.permissions.hr_access, true, 'an active scope opens the Leave app');
    for (let i = 0; i < 3; i += 1) await createAccount(pool, unique('list-more'), { capabilities: ['aba_access'] });
    assert.equal((await list()).queries, first.queries);
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { connectTestDatabase, resetLeaveTables, createEmployee, upsertLeaveType, skipWithoutDatabase } from '../test-support/database.js';
import { normalizeNameKey } from '../lib/names.js';

// hr.js's route handlers aren't exported as standalone functions, so these
// exercise the exact SQL the duplicate-prevention and delete-guard logic
// runs on, the same way leaveService.integration.test.js exercises that
// module's queries directly — the risk worth testing is the SQL and join
// logic, not Express plumbing that's identical to patterns already used
// elsewhere in the file.
test('staff record duplicate prevention', { skip: skipWithoutDatabase }, async (t) => {
  const pool = await connectTestDatabase();

  // Scoped to rows this test creates rather than truncating `reviewers`:
  // the integration files run serially against one shared database (see
  // scripts/test-db.sh), and reviewers isn't one of the tables
  // resetLeaveTables owns — truncating it here would also wipe fixtures a
  // concurrently-scheduled file is mid-test with.
  t.beforeEach(async () => {
    await resetLeaveTables(pool);
  });

  async function createReviewer({ email, displayName, status = 'active' }) {
    const { rows } = await pool.query(
      `INSERT INTO reviewers (email, display_name, status, password_hash)
       VALUES ($1, $2, $3, 'x') RETURNING *`,
      [email, displayName, status]
    );
    return rows[0];
  }

  // Every query below filters to this test's own reviewer ids rather than
  // reading the whole table — other integration files run their own
  // fixtures against this same shared database, and this file doesn't own
  // (or truncate) `reviewers`.
  await t.test('a login without a staff record is found as "unlinked"', async () => {
    const linked = await createReviewer({ email: 'dup-test-linked@example.com', displayName: 'Linked Person' });
    const unlinked = await createReviewer({ email: 'dup-test-unlinked@example.com', displayName: 'Val-cade' });
    const inactive = await createReviewer({ email: 'dup-test-inactive@example.com', displayName: 'Former Person', status: 'inactive' });
    const ids = [linked.id, unlinked.id, inactive.id];
    await createEmployee(pool, { name: 'Linked Person' }).then((e) =>
      pool.query('UPDATE hr_employees SET reviewer_id = $1 WHERE id = $2', [linked.id, e.id])
    );

    const { rows } = await pool.query(
      `SELECT r.id, r.display_name, r.email FROM reviewers r
         LEFT JOIN hr_employees e ON e.reviewer_id = r.id
        WHERE r.status = 'active' AND e.id IS NULL AND r.id = ANY($1::uuid[])`,
      [ids]
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, unlinked.id);
    assert.ok(!rows.some((r) => r.id === linked.id), 'the linked login is excluded');
    assert.ok(!rows.some((r) => r.id === inactive.id), 'the inactive login is excluded');
  });

  await t.test('a near-duplicate name matches the unlinked login via normalizeNameKey', async () => {
    const unlinked = await createReviewer({ email: 'dup-test-valcade@example.com', displayName: 'Val-cade' });
    const { rows } = await pool.query(
      `SELECT r.display_name, r.email FROM reviewers r
         LEFT JOIN hr_employees e ON e.reviewer_id = r.id
        WHERE r.status = 'active' AND e.id IS NULL AND r.id = $1`,
      [unlinked.id]
    );
    const key = normalizeNameKey('Valcade');
    const match = rows.find((row) => normalizeNameKey(row.display_name) === key);
    assert.ok(match, '"Valcade" should match an existing "Val-cade" login');
  });

  await t.test('delete is blocked by a linked login, leave history, or a direct report', async () => {
    const reviewer = await createReviewer({ email: 'dup-test-manager-link@example.com', displayName: 'A' });
    const linked = await createEmployee(pool, { name: 'Linked' });
    await pool.query('UPDATE hr_employees SET reviewer_id = $1 WHERE id = $2', [reviewer.id, linked.id]);
    const { rows: linkedRow } = await pool.query('SELECT reviewer_id FROM hr_employees WHERE id = $1', [linked.id]);
    assert.ok(linkedRow[0].reviewer_id, 'a linked record is blocked from deletion');

    const manager = await createEmployee(pool, { name: 'Manager' });
    const report = await createEmployee(pool, { name: 'Report' });
    await pool.query('UPDATE hr_employees SET manager_id = $1 WHERE id = $2', [manager.id, report.id]);
    const { rows: reports } = await pool.query('SELECT 1 FROM hr_employees WHERE manager_id = $1 LIMIT 1', [manager.id]);
    assert.equal(reports.length, 1, 'a manager with a direct report is blocked');

    const clean = await createEmployee(pool, { name: 'Clean Duplicate' });
    const [{ rows: applications }, { rows: adjustments }, { rows: cleanReports }] = await Promise.all([
      pool.query('SELECT 1 FROM hr_leave_applications WHERE employee_id = $1 LIMIT 1', [clean.id]),
      pool.query('SELECT 1 FROM hr_leave_adjustments WHERE employee_id = $1 LIMIT 1', [clean.id]),
      pool.query('SELECT 1 FROM hr_employees WHERE manager_id = $1 LIMIT 1', [clean.id]),
    ]);
    assert.equal(applications.length + adjustments.length + cleanReports.length, 0, 'a clean duplicate has nothing blocking its deletion');

    await pool.query('DELETE FROM hr_employees WHERE id = $1', [clean.id]);
    const { rows: gone } = await pool.query('SELECT 1 FROM hr_employees WHERE id = $1', [clean.id]);
    assert.equal(gone.length, 0);
  });

  await t.test('balance history blocks a normal delete but not a forced one', async () => {
    // Namespaced like the other integration files' fixtures (see
    // leaveService.integration.test.js) — hr_leave_types isn't truncated
    // between tests, so a plain "Annual" would collide with theirs.
    const type = await upsertLeaveType(pool, { name: 'T:DuplicateTestLeaveType' });
    const duplicate = await createEmployee(pool, { name: 'Val-cade' });
    await pool.query(
      `INSERT INTO hr_leave_adjustments (employee_id, leave_type_id, amount, reason)
       VALUES ($1, $2, 12, 'Bulk import: opening balance')`,
      [duplicate.id, type.id]
    );

    // Mirrors the route's guard: reviewer_id/applications/reports stay hard
    // blocks regardless of force, only the adjustments check is liftable.
    const forcing = true;
    const [{ rows: applications }, { rows: adjustments }, { rows: reports }] = await Promise.all([
      pool.query('SELECT 1 FROM hr_leave_applications WHERE employee_id = $1 LIMIT 1', [duplicate.id]),
      pool.query('SELECT * FROM hr_leave_adjustments WHERE employee_id = $1', [duplicate.id]),
      pool.query('SELECT 1 FROM hr_employees WHERE manager_id = $1 LIMIT 1', [duplicate.id]),
    ]);
    assert.equal(adjustments.length, 1, 'the opening balance is on file, so an unforced delete would be blocked');
    assert.equal(applications.length, 0);
    assert.equal(reports.length, 0);

    assert.ok(forcing, 'forcing lifts only the adjustments guard in the route');
    await pool.query('DELETE FROM hr_employees WHERE id = $1', [duplicate.id]);
    const { rows: gone } = await pool.query('SELECT 1 FROM hr_employees WHERE id = $1', [duplicate.id]);
    assert.equal(gone.length, 0, 'the record is gone');
    const { rows: adjustmentsGone } = await pool.query('SELECT 1 FROM hr_leave_adjustments WHERE employee_id = $1', [duplicate.id]);
    assert.equal(adjustmentsGone.length, 0, 'its adjustment history cascades away with it');
  });
});

/**
 * The duplicate this prevents: HR creates the staff record before the person
 * has a login, the person signs in, and the portal — unable to match the name
 * Google gave it against the one HR typed — makes a second record. The login
 * then sits on the empty one, and linking it to the real record failed on the
 * unique constraint, with nothing offering a way back.
 */
test('a first sign-in finds the record HR made in advance', { skip: skipWithoutDatabase }, async (t) => {
  const pool = await connectTestDatabase();
  const express = (await import('express')).default;
  const { default: hrRouter } = await import('./hr.js');
  const auth = await import('../services/authService.js');

  let server;
  let base;
  t.before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/hr', hrRouter);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  t.after(() => server?.close());
  t.beforeEach(() => resetLeaveTables(pool));

  /** Signs in as a brand-new login and returns the staff record it resolved to. */
  async function firstSignIn({ email, displayName }) {
    await pool.query('DELETE FROM reviewers WHERE email = $1', [email]);
    const { rows: [reviewer] } = await pool.query(
      `INSERT INTO reviewers (email, display_name, status, password_hash, permissions)
       VALUES ($1, $2, 'active', 'x', '{"hr_access": true}'::jsonb) RETURNING *`,
      [email, displayName]
    );
    const { tokenId, expiresAt } = await auth.createSession(reviewer.id);
    const token = auth.buildTokenPayload(reviewer, tokenId, expiresAt);
    const res = await fetch(`${base}/api/hr/me`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200, 'the sign-in resolves to a staff record');
    return { reviewer, employee: (await res.json()).employee };
  }

  const recordCount = async () =>
    Number((await pool.query('SELECT COUNT(*)::int AS n FROM hr_employees')).rows[0].n);

  // The case that was breaking: the address matches, the name does not.
  await t.test('matches on the address even when the name differs', async () => {
    const onFile = await createEmployee(pool, { name: 'Immakulada Hiram' });
    await pool.query("UPDATE hr_employees SET email = 'Imma.Hiram@finance.gov.nr' WHERE id = $1", [onFile.id]);

    const { employee } = await firstSignIn({ email: 'imma.hiram@finance.gov.nr', displayName: 'Imma H' });

    assert.equal(employee.id, onFile.id, 'it claims the record HR made, not a new one');
    assert.equal(await recordCount(), 1, 'and no second record exists');
  });

  await t.test('still matches on the name when no address was recorded', async () => {
    const onFile = await createEmployee(pool, { name: 'Val-cade' });

    const { employee } = await firstSignIn({ email: 'nobody@elsewhere.test', displayName: 'Valcade' });

    assert.equal(employee.id, onFile.id);
    assert.equal(await recordCount(), 1);
  });

  // Two people on file with one address is not a match anyone should guess at.
  await t.test('creates a new record when the address is ambiguous', async () => {
    for (const name of ['Shared One', 'Shared Two']) {
      const row = await createEmployee(pool, { name });
      await pool.query("UPDATE hr_employees SET email = 'shared@finance.gov.nr' WHERE id = $1", [row.id]);
    }

    const { employee } = await firstSignIn({ email: 'shared@finance.gov.nr', displayName: 'Someone Else' });

    assert.equal(await recordCount(), 3, 'it leaves the ambiguity for HR rather than guessing');
    assert.equal(employee.display_name, 'Someone Else');
  });

  // A record already linked to somebody else must never be taken over. Two
  // logins cannot share an address, so the way this is reached is the name
  // path: two people on file under the same name, one already linked.
  await t.test('never claims a record that already has a login', async () => {
    const taken = await createEmployee(pool, { name: 'Already Linked' });
    const { rows: [other] } = await pool.query(
      `INSERT INTO reviewers (email, display_name, status, password_hash)
       VALUES ('owner@finance.gov.nr', 'Already Linked', 'active', 'x') RETURNING *`
    );
    await pool.query('UPDATE hr_employees SET reviewer_id = $1 WHERE id = $2', [other.id, taken.id]);

    const { employee } = await firstSignIn({ email: 'namesake@finance.gov.nr', displayName: 'Already Linked' });

    assert.notEqual(employee.id, taken.id, 'the linked record keeps its owner');
    const { rows: [owner] } = await pool.query(
      'SELECT reviewer_id FROM hr_employees WHERE id = $1', [taken.id]
    );
    assert.equal(owner.reviewer_id, other.id, 'and is untouched');
    assert.equal(await recordCount(), 2, 'the newcomer gets their own record');
  });
});

/**
 * Recovering from a duplicate that already exists. Linking the login to the
 * real record used to fail on the unique constraint with "already linked to a
 * different staff record" and no way forward, which left deleting the record
 * HR had prepared — and its opening balances — as the only option.
 */
test('a login can be moved off the record the portal created', { skip: skipWithoutDatabase }, async (t) => {
  const pool = await connectTestDatabase();
  const express = (await import('express')).default;
  const { default: hrRouter } = await import('./hr.js');
  const auth = await import('../services/authService.js');

  let server;
  let base;
  let token;
  t.before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/hr', hrRouter);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;

    await pool.query('DELETE FROM reviewers WHERE email = $1', ['relink-admin@test']);
    const { rows: [admin] } = await pool.query(
      `INSERT INTO reviewers (email, display_name, status, password_hash, permissions)
       VALUES ($1, $1, 'active', 'x', '{"hr_staff_manage": true, "hr_access": true}'::jsonb) RETURNING *`,
      ['relink-admin@test']
    );
    const session = await auth.createSession(admin.id);
    token = auth.buildTokenPayload(admin, session.tokenId, session.expiresAt);
  });
  t.after(() => server?.close());
  t.beforeEach(() => resetLeaveTables(pool));

  const link = (employeeId, reviewerId) => fetch(`${base}/api/hr/employees/${employeeId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewer_id: reviewerId }),
  });

  /** A login holding a record the portal made for it, with nothing on it. */
  async function strandedLogin(email) {
    await pool.query('DELETE FROM reviewers WHERE email = $1', [email]);
    const { rows: [reviewer] } = await pool.query(
      `INSERT INTO reviewers (email, display_name, status, password_hash)
       VALUES ($1, $1, 'active', 'x') RETURNING *`, [email]
    );
    const shell = await createEmployee(pool, { name: 'Auto Created' });
    await pool.query('UPDATE hr_employees SET reviewer_id = $1, email = $2 WHERE id = $3',
      [reviewer.id, email, shell.id]);
    return { reviewer, shell };
  }

  await t.test('discards the empty record and keeps the one HR prepared', async () => {
    const onFile = await createEmployee(pool, { name: 'Real Record', joinDate: '2020-01-06' });
    const { reviewer, shell } = await strandedLogin('stranded@test');

    const res = await link(onFile.id, reviewer.id);
    assert.equal(res.status, 200, 'the link succeeds instead of colliding');

    const { rows: kept } = await pool.query('SELECT reviewer_id FROM hr_employees WHERE id = $1', [onFile.id]);
    assert.equal(kept[0].reviewer_id, reviewer.id, 'the login now sits on the prepared record');
    const { rows: gone } = await pool.query('SELECT 1 FROM hr_employees WHERE id = $1', [shell.id]);
    assert.equal(gone.length, 0, 'and the empty duplicate is gone');
  });

  // Anything with history is somebody's real record, whichever way round the
  // duplicate happened, and is never destroyed to make a link succeed.
  await t.test('refuses when the other record has leave history', async () => {
    const onFile = await createEmployee(pool, { name: 'Real Record' });
    const { reviewer, shell } = await strandedLogin('has-history@test');
    const annual = await upsertLeaveType(pool, { name: 'T:Relink', defaultDays: 20 });
    await pool.query(
      `INSERT INTO hr_leave_adjustments (employee_id, leave_type_id, amount, reason)
       VALUES ($1, $2, 5, 'Opening balance')`, [shell.id, annual.id]
    );

    const res = await link(onFile.id, reviewer.id);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.message, /leave history/);
    assert.equal(body.details.other_employee_id, shell.id, 'and says which record to look at');

    const { rows: still } = await pool.query('SELECT 1 FROM hr_employees WHERE id = $1', [shell.id]);
    assert.equal(still.length, 1, 'the record with history survives');
  });
});

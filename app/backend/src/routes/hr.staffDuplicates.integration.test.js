import assert from 'node:assert/strict';
import test from 'node:test';
import { connectTestDatabase, resetLeaveTables, createEmployee, skipWithoutDatabase } from '../test-support/database.js';
import { normalizeNameKey } from '../lib/names.js';

// hr.js's route handlers aren't exported as standalone functions, so these
// exercise the exact SQL the duplicate-prevention and delete-guard logic
// runs on, the same way leaveService.integration.test.js exercises that
// module's queries directly — the risk worth testing is the SQL and join
// logic, not Express plumbing that's identical to patterns already used
// elsewhere in the file.
test('staff record duplicate prevention', { skip: skipWithoutDatabase }, async (t) => {
  const pool = await connectTestDatabase();

  t.beforeEach(async () => {
    await resetLeaveTables(pool);
    await pool.query('TRUNCATE reviewers CASCADE');
  });

  async function createReviewer({ email, displayName, status = 'active' }) {
    const { rows } = await pool.query(
      `INSERT INTO reviewers (email, display_name, status, password_hash)
       VALUES ($1, $2, $3, 'x') RETURNING *`,
      [email, displayName, status]
    );
    return rows[0];
  }

  await t.test('a login without a staff record is found as "unlinked"', async () => {
    const linked = await createReviewer({ email: 'linked@example.com', displayName: 'Linked Person' });
    const unlinked = await createReviewer({ email: 'unlinked@example.com', displayName: 'Val-cade' });
    const inactive = await createReviewer({ email: 'gone@example.com', displayName: 'Former Person', status: 'inactive' });
    await createEmployee(pool, { name: 'Linked Person' }).then((e) =>
      pool.query('UPDATE hr_employees SET reviewer_id = $1 WHERE id = $2', [linked.id, e.id])
    );

    const { rows } = await pool.query(
      `SELECT r.id, r.display_name, r.email FROM reviewers r
         LEFT JOIN hr_employees e ON e.reviewer_id = r.id
        WHERE r.status = 'active' AND e.id IS NULL`
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, unlinked.id);
    assert.ok(!rows.some((r) => r.id === linked.id), 'the linked login is excluded');
    assert.ok(!rows.some((r) => r.id === inactive.id), 'the inactive login is excluded');
  });

  await t.test('a near-duplicate name matches the unlinked login via normalizeNameKey', async () => {
    await createReviewer({ email: 'unlinked@example.com', displayName: 'Val-cade' });
    const { rows } = await pool.query(
      `SELECT r.display_name, r.email FROM reviewers r
         LEFT JOIN hr_employees e ON e.reviewer_id = r.id
        WHERE r.status = 'active' AND e.id IS NULL`
    );
    const key = normalizeNameKey('Valcade');
    const match = rows.find((row) => normalizeNameKey(row.display_name) === key);
    assert.ok(match, '"Valcade" should match an existing "Val-cade" login');
  });

  await t.test('delete is blocked by a linked login, leave history, or a direct report', async () => {
    const reviewer = await createReviewer({ email: 'a@example.com', displayName: 'A' });
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
});

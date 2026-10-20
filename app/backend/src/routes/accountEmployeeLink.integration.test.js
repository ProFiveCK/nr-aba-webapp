import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { connectTestDatabase, resetLeaveTables, skipWithoutDatabase } from '../test-support/database.js';

describe('account administration staff reassignment', { skip: skipWithoutDatabase }, () => {
  let pool, auth, server, base, admin, other, login, previous, employee, former;
  const reason = 'Verified employee identity and replacement login authority.';
  before(async () => {
    pool = await connectTestDatabase();
    auth = await import('../services/authService.js');
    const express = (await import('express')).default;
    const errors = await import('../middleware/errors.js');
    errors.enableAsyncErrors();
    const app = express();
    app.use(express.json());
    app.use('/hr', (await import('./hr.js')).default);
    app.use('/api', (await import('./admin.js')).default);
    app.use(errors.errorHandler);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await pool?.end(); });
  async function account(permissions = {}) {
    return (await pool.query("INSERT INTO reviewers(email,role,password_hash,permissions) VALUES($1,'user','x',$2) RETURNING *", [`${randomUUID()}@example.test`, permissions])).rows[0];
  }
  async function person(name, reviewer) {
    return (await pool.query('INSERT INTO hr_employees(display_name,reviewer_id,email) VALUES($1,$2,$3) RETURNING *', [name, reviewer?.id || null, reviewer?.email || null])).rows[0];
  }
  async function call(data, actor = admin) {
    const session = await auth.createSession(actor.id);
    const res = await fetch(`${base}/hr/directory/accounts/${login.id}/employee-link`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.buildTokenPayload(actor, session.tokenId, session.expiresAt)}` }, body: JSON.stringify(data) });
    return { status: res.status, body: await res.json() };
  }
  const transfer = () => ({ employee_id: employee.id, expected_employee_id: former.id, expected_reviewer_id: previous.id, reason });
  const mapping = async id => (await pool.query('SELECT reviewer_id,email FROM hr_employees WHERE id=$1', [id])).rows[0];
  beforeEach(async () => {
    await resetLeaveTables(pool);
    admin = await account({ hr_admin: true }); other = await account({ admin: true, hr_staff_manage: true });
    login = await account({ hr_access: true, hr_leave_apply: true }); previous = await account({ hr_access: true });
    former = await person('Former employee', login); employee = await person('Target employee', previous);
  });
  test('replaces the target login, detaches the old employee and revokes all affected sessions', async () => {
    for (const row of [login, previous]) await auth.createSession(row.id);
    const type = (await pool.query("INSERT INTO hr_leave_types(name,default_days) VALUES($1,0) RETURNING id", [`Assignment fixture ${randomUUID()}`])).rows[0];
    try {
      await pool.query('INSERT INTO hr_leave_balances(employee_id,leave_type_id,year,balance,pending) VALUES($1,$2,2026,12,2)', [employee.id, type.id]);
      const result = await call(transfer()); assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.deepEqual(await mapping(former.id), { reviewer_id: null, email: null });
      assert.deepEqual(await mapping(employee.id), { reviewer_id: login.id, email: login.email });
      assert.equal((await pool.query('SELECT count(*)::int n FROM reviewer_sessions WHERE reviewer_id=ANY($1::uuid[])', [[login.id, previous.id]])).rows[0].n, 0);
      assert.equal((await pool.query('SELECT count(*)::int n FROM hr_employee_account_links WHERE employee_id=ANY($1::uuid[])', [[former.id, employee.id]])).rows[0].n, 2);
      const balance = (await pool.query('SELECT balance::text,pending::text FROM hr_leave_balances WHERE employee_id=$1', [employee.id])).rows[0];
      assert.equal(Number(balance.balance), 12); assert.equal(Number(balance.pending), 2);
      // Repeating a stale submission cannot detach the successful assignment.
      assert.equal((await call(transfer())).status, 409);
      assert.equal((await mapping(employee.id)).reviewer_id, login.id);
    } finally { await pool.query('DELETE FROM hr_leave_balances WHERE leave_type_id=$1', [type.id]); await pool.query('DELETE FROM hr_leave_types WHERE id=$1', [type.id]); }
  });
  test('clearing the selection removes the link and supports an unchanged retry', async () => {
    const data = { employee_id: null, expected_employee_id: former.id, expected_reviewer_id: null, reason };
    assert.equal((await call(data)).status, 200);
    assert.equal((await mapping(former.id)).reviewer_id, null);
    assert.equal((await call({ ...data, expected_employee_id: null })).status, 200);
  });
  test('a failure linking the target rolls back the previous detachment, audit and session revocation', async () => {
    await auth.createSession(login.id);
    await pool.query("UPDATE hr_employees SET status='inactive' WHERE id=$1", [employee.id]);
    const count = (await pool.query('SELECT count(*)::int n FROM reviewer_sessions WHERE reviewer_id=$1', [login.id])).rows[0].n;
    assert.equal((await call(transfer())).status, 400);
    assert.equal((await mapping(former.id)).reviewer_id, login.id);
    assert.equal((await mapping(employee.id)).reviewer_id, previous.id);
    assert.equal((await pool.query('SELECT count(*)::int n FROM hr_employee_account_links WHERE employee_id=ANY($1::uuid[])', [[former.id, employee.id]])).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int n FROM reviewer_sessions WHERE reviewer_id=$1', [login.id])).rows[0].n, count);
  });
  test('a stale target, missing expected links and insufficient HR authority cannot change links', async () => {
    assert.equal((await call({ ...transfer(), expected_reviewer_id: null })).status, 409);
    assert.equal((await call({ employee_id: employee.id, reason })).status, 422);
    assert.equal((await call(transfer(), other)).status, 403);
    assert.equal((await mapping(former.id)).reviewer_id, login.id);
    assert.equal((await mapping(employee.id)).reviewer_id, previous.id);
  });
  test('employee-only account edits do not require an ABA department code', async () => {
    await pool.query("UPDATE reviewers SET role='admin' WHERE id=$1", [admin.id]);
    admin.role='admin';
    await pool.query("UPDATE reviewers SET account_type='employee',department_code=NULL WHERE id=$1", [login.id]);
    const session=await auth.createSession(admin.id);
    const edit=async id=>fetch(`${base}/api/reviewers/${id}`, {method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth.buildTokenPayload(admin,session.tokenId,session.expiresAt)}`},body:JSON.stringify({display_name:'Verified login',role:'user',department_code:null,division_code:'00'})});
    const result=await edit(login.id);assert.equal(result.status,200,await result.text());
    assert.equal((await edit(previous.id)).status,400);
  });
  test('competing assignments permit only one reviewed replacement', async () => {
    const results = await Promise.all([call(transfer()), call(transfer())]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal((await mapping(employee.id)).reviewer_id, login.id);
  });
});

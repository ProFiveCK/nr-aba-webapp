/**
 * Public Health writes that touch several rows, against a real Postgres.
 *
 * A participant with no open level is paid as nothing, and a pay period with
 * no entries is an empty pay run, so each of these writes must land whole or
 * not at all. A failure is injected with a trigger that refuses inserts into
 * one table, so the first write has already happened when the second fails.
 */
import assert from 'node:assert/strict';
import test, { after, before, beforeEach, describe } from 'node:test';
import { connectTestDatabase, skipWithoutDatabase } from '../test-support/database.js';
import { createAccount, prepareRoutes, startApp } from '../test-support/http.js';

describe('public health multi-row writes', { skip: skipWithoutDatabase }, () => {
  let pool;
  let app;
  let manager;

  const call = (method, path, body) => app.call(method, `/api/public-health${path}`, { token: manager.token, body });
  const count = async (sql, params = []) => (await pool.query(sql, params)).rows[0].n;

  /** Makes every insert into `table` fail until the returned function runs. */
  async function refuseInserts(table) {
    await pool.query(`CREATE OR REPLACE FUNCTION ph_test_refuse() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'refused by test'; END; $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER ph_test_refuse BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ph_test_refuse()`);
    return () => pool.query(`DROP TRIGGER IF EXISTS ph_test_refuse ON ${table}`);
  }

  async function reset() {
    await pool.query('DELETE FROM public_health_pay_periods');
    await pool.query('DELETE FROM public_health_participants');
  }

  async function addParticipant(name) {
    const res = await call('POST', '/participants', { full_name: name });
    assert.equal(res.status, 201);
    return res.json.id;
  }

  before(async () => {
    pool = await connectTestDatabase();
    prepareRoutes();
    const { default: router } = await import('./public-health.js');
    app = await startApp({ '/api/public-health': router });
    manager = await createAccount(pool, 'ph-manager@test', {
      role: 'public_health',
      capabilities: ['public_health_access', 'public_health_manage'],
    });
  });
  after(async () => {
    await reset();
    await app?.close();
    await pool?.end();
  });
  beforeEach(reset);

  test('creating a participant fails whole when the starting level cannot be written', async () => {
    const restore = await refuseInserts('public_health_participant_levels');
    try {
      const res = await call('POST', '/participants', { full_name: 'Atomic Create' });
      assert.equal(res.status, 500);
    } finally { await restore(); }
    assert.equal(await count('SELECT count(*)::int AS n FROM public_health_participants'), 0,
      'no participant is left behind without a level');
  });

  test('an import is all or nothing', async () => {
    const restore = await refuseInserts('public_health_participant_levels');
    try {
      const res = await call('POST', '/participants/import', { participants: [{ full_name: 'One' }, { full_name: 'Two' }] });
      assert.equal(res.status, 500);
    } finally { await restore(); }
    assert.equal(await count('SELECT count(*)::int AS n FROM public_health_participants'), 0);
  });

  test('a level change that cannot be recorded leaves the current level open', async () => {
    const id = await addParticipant('Level Change');
    const restore = await refuseInserts('public_health_participant_levels');
    try {
      const res = await call('PATCH', `/participants/${id}/level`, { level: 'LV2', reason: 'promoted' });
      assert.equal(res.status, 500);
    } finally { await restore(); }
    assert.equal(
      await count('SELECT count(*)::int AS n FROM public_health_participant_levels WHERE participant_id = $1 AND effective_to IS NULL', [id]),
      1, 'the participant still has exactly one open level');
  });

  test('a level change closes one level and opens the next', async () => {
    const id = await addParticipant('Level Ok');
    assert.equal((await call('PATCH', `/participants/${id}/level`, { level: 'LV2', reason: 'promoted' })).status, 200);
    const { rows } = await pool.query(
      'SELECT level, effective_to IS NULL AS open FROM public_health_participant_levels WHERE participant_id = $1 ORDER BY effective_from', [id]);
    assert.deepEqual(rows.map((r) => [r.level, r.open]), [['LV1', false], ['LV2', true]]);
  });

  test('concurrent level changes for one participant never leave two open levels', async () => {
    const id = await addParticipant('Level Race');
    const results = await Promise.all(['LV2', 'LV3', 'LV0', 'LV2'].map((level) =>
      call('PATCH', `/participants/${id}/level`, { level, reason: 'race' })));
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(
      await count('SELECT count(*)::int AS n FROM public_health_participant_levels WHERE participant_id = $1 AND effective_to IS NULL', [id]),
      1);
  });

  test('a pay period is not left empty when its entries cannot be written', async () => {
    await addParticipant('Period Person');
    const restore = await refuseInserts('public_health_period_entries');
    try {
      const res = await call('POST', '/pay-periods', { paid_date: '2026-11-15' });
      assert.equal(res.status, 500);
    } finally { await restore(); }
    assert.equal(await count('SELECT count(*)::int AS n FROM public_health_pay_periods'), 0);
  });

  test('editing entries applies every row or none, and only on a draft', async () => {
    const a = await addParticipant('Entry A');
    const b = await addParticipant('Entry B');
    const period = (await call('POST', '/pay-periods', { paid_date: '2026-11-15' })).json;
    const active = async (pid) => (await pool.query(
      'SELECT active FROM public_health_period_entries WHERE period_id = $1 AND participant_id = $2', [period.id, pid])).rows[0].active;

    // The second row is not a valid UUID, so the database rejects it midway.
    const bad = await call('PUT', `/pay-periods/${period.id}/entries`, {
      entries: [{ participant_id: a, active: false }, { participant_id: 'not-a-uuid', active: false }],
    });
    assert.equal(bad.status, 500);
    assert.equal(await active(a), true, 'the first row was rolled back with the failed second row');

    const ok = await call('PUT', `/pay-periods/${period.id}/entries`, {
      entries: [{ participant_id: a, active: false }, { participant_id: b, active: false }],
    });
    assert.deepEqual([ok.status, ok.json.updated], [200, 2]);
    assert.equal(await active(a), false);

    assert.equal((await call('PATCH', `/pay-periods/${period.id}/status`, { status: 'submitted' })).status, 200);
    const late = await call('PUT', `/pay-periods/${period.id}/entries`, { entries: [{ participant_id: a, active: true }] });
    assert.equal(late.status, 400);
    assert.equal(await active(a), false);
  });
});

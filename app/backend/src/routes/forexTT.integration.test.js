/**
 * FOREX TT status changes and attachment uploads over HTTP, against a real
 * Postgres. A request is claimed by one reviewer, a status change and its
 * history entry land together, and a multi-file upload keeps every file.
 */
import assert from 'node:assert/strict';
import test, { after, before, beforeEach, describe } from 'node:test';
import { connectTestDatabase, skipWithoutDatabase } from '../test-support/database.js';
import { createAccount, prepareRoutes, startApp } from '../test-support/http.js';

describe('forex tt routes', { skip: skipWithoutDatabase }, () => {
  let pool;
  let app;
  let submitter;
  let reviewerA;
  let reviewerB;

  const setStatus = (who, id, status) =>
    app.call('PATCH', `/api/forex-tt/${id}/status`, { token: who.token, body: { status } });
  const count = async (sql, params = []) => (await pool.query(sql, params)).rows[0].n;

  async function newRequest(status) {
    const id = `FXTT-TEST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    await pool.query(
      `INSERT INTO forex_tt_requests (request_id, submitted_by, status) VALUES ($1, $2, $3)`,
      [id, submitter.reviewer.id, status]
    );
    return id;
  }

  before(async () => {
    pool = await connectTestDatabase();
    prepareRoutes();
    const { default: router } = await import('./forexTT.js');
    app = await startApp({ '/api/forex-tt': router });
    const review = ['forex_tt_access', 'review_forex_tt'];
    submitter = await createAccount(pool, 'fx-submitter@test', { capabilities: ['forex_tt_access', 'submit_forex_tt'] });
    reviewerA = await createAccount(pool, 'fx-reviewer-a@test', { role: 'reviewer', capabilities: review });
    reviewerB = await createAccount(pool, 'fx-reviewer-b@test', { role: 'reviewer', capabilities: review });
  });
  after(async () => {
    await pool.query("DELETE FROM forex_tt_requests WHERE request_id LIKE 'FXTT-TEST-%'");
    await app?.close();
    await pool?.end();
  });
  beforeEach(() => pool.query("DELETE FROM forex_tt_requests WHERE request_id LIKE 'FXTT-TEST-%'"));

  test('two reviewers claiming one request: one wins, one history entry', async () => {
    const id = await newRequest('submitted');
    const results = await Promise.all([setStatus(reviewerA, id, 'claimed'), setStatus(reviewerB, id, 'claimed')]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    const { rows: [row] } = await pool.query('SELECT claimed_by, version FROM forex_tt_requests WHERE request_id = $1', [id]);
    const winner = results[0].status === 200 ? reviewerA : reviewerB;
    assert.equal(row.claimed_by, winner.reviewer.id, 'the claim belongs to the reviewer who got a 200');
    assert.equal(row.version, 2, 'the version moved once');
    assert.equal(await count(
      `SELECT count(*)::int AS n FROM forex_tt_reviews e JOIN forex_tt_requests r ON r.id = e.request_id
        WHERE r.request_id = $1 AND e.status = 'claimed'`, [id]), 1);
  });

  test('a status change is not kept when its history entry cannot be written', async () => {
    const id = await newRequest('submitted');
    await pool.query(`CREATE OR REPLACE FUNCTION fx_test_refuse() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'refused by test'; END; $$ LANGUAGE plpgsql`);
    await pool.query('CREATE TRIGGER fx_test_refuse BEFORE INSERT ON forex_tt_reviews FOR EACH ROW EXECUTE FUNCTION fx_test_refuse()');
    try {
      assert.equal((await setStatus(reviewerA, id, 'claimed')).status, 500);
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS fx_test_refuse ON forex_tt_reviews');
    }
    const { rows: [row] } = await pool.query('SELECT status, claimed_by FROM forex_tt_requests WHERE request_id = $1', [id]);
    assert.deepEqual([row.status, row.claimed_by], ['submitted', null], 'still waiting to be claimed');
  });

  test('selecting several files keeps all of them, and a later upload replaces the set', async () => {
    const id = await newRequest('draft');
    const upload = async (names) => {
      const form = new FormData();
      form.append('category', 'supporting');
      for (const name of names) form.append('files', new Blob([`content of ${name}`], { type: 'application/pdf' }), name);
      const res = await fetch(`${app.base}/api/forex-tt/${id}/attachments`, {
        method: 'POST', headers: { Authorization: `Bearer ${submitter.token}` }, body: form,
      });
      return res.status;
    };
    const active = async () => (await pool.query(
      `SELECT file_name FROM forex_tt_attachments a JOIN forex_tt_requests r ON r.id = a.request_id
        WHERE r.request_id = $1 AND a.superseded_at IS NULL ORDER BY file_name`, [id])).rows.map((r) => r.file_name);

    assert.equal(await upload(['a.pdf', 'b.pdf', 'c.pdf']), 201);
    assert.deepEqual(await active(), ['a.pdf', 'b.pdf', 'c.pdf']);

    assert.equal(await upload(['d.pdf']), 201);
    assert.deepEqual(await active(), ['d.pdf'], 'the new upload replaces the earlier set');
  });
});

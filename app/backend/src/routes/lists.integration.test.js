/**
 * The blacklist import over HTTP, against a real Postgres.
 *
 * A database error on one row used to abort the whole transaction: every later
 * row failed too, COMMIT quietly became a ROLLBACK, and the route still
 * answered 201 with counts for rows that were never stored.
 */
import assert from 'node:assert/strict';
import test, { after, before, beforeEach, describe } from 'node:test';
import { connectTestDatabase, skipWithoutDatabase } from '../test-support/database.js';
import { createAccount, prepareRoutes, startApp } from '../test-support/http.js';

const BSB = '777-001';

describe('blacklist import', { skip: skipWithoutDatabase }, () => {
  let pool;
  let app;
  let admin;

  before(async () => {
    pool = await connectTestDatabase();
    prepareRoutes();
    const { default: listsRouter } = await import('./lists.js');
    app = await startApp({ '/api': listsRouter });
    admin = await createAccount(pool, 'lists-admin@test', { role: 'admin' });
  });
  after(async () => {
    await pool.query('DELETE FROM blacklist_entries WHERE bsb = $1', [BSB]);
    await app?.close();
    await pool?.end();
  });
  beforeEach(() => pool.query('DELETE FROM blacklist_entries WHERE bsb = $1', [BSB]));

  const importEntries = (entries) =>
    app.call('POST', '/api/blacklist/import', { token: admin.token, body: { entries } });

  test('imports every valid row', async () => {
    const res = await importEntries([
      { bsb: BSB, account: '11111111', label: 'one' },
      { bsb: BSB, account: '22222222', label: 'two' },
    ]);
    assert.equal(res.status, 201);
    assert.equal(res.json.inserted, 2);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM blacklist_entries WHERE bsb = $1', [BSB]);
    assert.equal(rows[0].n, 2);
  });

  test('a row the database rejects is skipped and reported; the others are stored', async () => {
    // A NUL byte passes request validation but Postgres refuses it in text.
    const res = await importEntries([
      { bsb: BSB, account: '11111111', label: 'before' },
      { bsb: BSB, account: '22222222', label: 'bad\u0000label', rowNumber: 2 },
      { bsb: BSB, account: '33333333', label: 'after' },
    ]);
    assert.equal(res.status, 201);
    assert.deepEqual([res.json.inserted, res.json.skipped], [2, 1]);
    assert.equal(res.json.errors[0].index, 2);
    const { rows } = await pool.query('SELECT account FROM blacklist_entries WHERE bsb = $1 ORDER BY account', [BSB]);
    assert.deepEqual(rows.map((r) => r.account), ['11111111', '33333333'],
      'the reported counts match what was actually committed');
  });
});

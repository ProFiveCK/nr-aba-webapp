/**
 * The PD-number rule against a real Postgres: a six-digit FMIS PD reference
 * pays out once. A second batch with the same PD is refused unless it is a
 * resubmission of the same batch (same root_batch_id). Rejected batches and
 * drafts do not hold the number; archived ones still do.
 *
 * GET /api/pd/:pd and POST /api/batches both call lib/pdNumber.js, so this
 * tests the check the routes actually run.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach, describe } from 'node:test';
import { connectTestDatabase, skipWithoutDatabase } from './test-support/database.js';
import { findPdConflict } from './lib/pdNumber.js';

describe('PD number duplicate rule', { skip: skipWithoutDatabase }, () => {
  let pool;

  before(async () => { pool = await connectTestDatabase(); });
  after(async () => { await pool?.end(); });

  // Only this file's rows: the integration files share one database.
  beforeEach(async () => {
    await pool.query("DELETE FROM batch_archives WHERE file_path LIKE 'test://pd/%'");
    await pool.query("DELETE FROM batch_archives_history WHERE file_path LIKE 'test://pd/%'");
  });

  let seq = 0;
  async function storeBatch({ pd, stage = 'submitted', draft = false, rootBatchId = randomUUID(), archived = false }) {
    const code = `99-PDTEST${String(++seq).padStart(4, '0')}`;
    const table = archived ? 'batch_archives_history' : 'batch_archives';
    await pool.query(
      `INSERT INTO ${table} (batch_id, code, root_batch_id, department_code, file_name, file_path, pd_number, stage, is_draft)
       VALUES ($1, $2, $3, '99', 'x.aba', $4, $5, $6, $7)`,
      [randomUUID(), code, rootBatchId, `test://pd/${code}`, pd, stage, draft]
    );
    return { code, rootBatchId };
  }

  test('a PD already on a submitted or approved batch is refused', async () => {
    const submitted = await storeBatch({ pd: '123456' });
    await storeBatch({ pd: '654321', stage: 'approved' });

    assert.equal((await findPdConflict(pool, '123456'))?.code, submitted.code);
    assert.ok(await findPdConflict(pool, '654321'));
    assert.equal(await findPdConflict(pool, '111111'), null);
  });

  test('a new batch with the same PD under another root is refused', async () => {
    await storeBatch({ pd: '123456' });
    assert.ok(await findPdConflict(pool, '123456', randomUUID()));
  });

  test('a resubmission of the same batch (same root_batch_id) may reuse its PD', async () => {
    const original = await storeBatch({ pd: '123456' });
    assert.equal(await findPdConflict(pool, '123456', original.rootBatchId), null);
  });

  test('…but not when another batch also holds that PD', async () => {
    const original = await storeBatch({ pd: '123456' });
    const other = await storeBatch({ pd: '123456' });
    assert.equal((await findPdConflict(pool, '123456', original.rootBatchId))?.code, other.code);
  });

  test('rejected batches and drafts release the PD', async () => {
    await storeBatch({ pd: '123456', stage: 'rejected' });
    await storeBatch({ pd: '123456', draft: true });
    assert.equal(await findPdConflict(pool, '123456'), null);
  });

  test('archived batches still hold the PD', async () => {
    await storeBatch({ pd: '123456', stage: 'approved', archived: true });
    assert.ok(await findPdConflict(pool, '123456'));
  });

  test('a stored PD is compared on its digits ("PD123456" holds 123456)', async () => {
    await storeBatch({ pd: 'PD123456' });
    assert.ok(await findPdConflict(pool, '123456'));
  });

  // Submissions used to compare the raw value, so "PD123456" slipped past a
  // stored 123456 and paid the same PD twice.
  test('any spelling of the PD is compared on its digits', async () => {
    await storeBatch({ pd: '123456' });
    assert.ok(await findPdConflict(pool, 'PD123456'));
    assert.ok(await findPdConflict(pool, '12-3456'));
  });

  test('a reference with no digits is compared as written', async () => {
    await storeBatch({ pd: 'MANUAL-REF' });
    assert.ok(await findPdConflict(pool, ' MANUAL-REF '));
    assert.equal(await findPdConflict(pool, 'OTHER-REF'), null);
  });
});

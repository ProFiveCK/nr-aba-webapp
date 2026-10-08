/**
 * The payment routes over HTTP, against a real Postgres: what the server
 * accepts, refuses, stores and audits when a batch is submitted, reviewed,
 * re-dated or deleted.
 */
import assert from 'node:assert/strict';
import test, { after, before, beforeEach, describe } from 'node:test';
import { connectTestDatabase, skipWithoutDatabase } from '../test-support/database.js';
import { createAccount, lastAudit, prepareRoutes, startApp } from '../test-support/http.js';
import { abaFile, payloadFor } from '../test-support/aba.js';

const DEPT = '77';
const GOOD = [['083-004', '987654', 150025], ['062-000', '12345678', 4999975]];
let pdSeq = 0;
const nextPd = () => String(700000 + (++pdSeq));

describe('batch routes', { skip: skipWithoutDatabase }, () => {
  let pool;
  let app;
  let submitter;
  let reviewer;
  let admin;

  before(async () => {
    pool = await connectTestDatabase();
    prepareRoutes();
    const { default: batchesRouter } = await import('./batches.js');
    app = await startApp({ '/api': batchesRouter });
    // A run cut short leaves batches that would pin the test accounts.
    await pool.query('DELETE FROM batch_archives WHERE department_code = $1', [DEPT]);
    submitter = await createAccount(pool, 'batch-submitter@test', { role: 'user', departmentCode: DEPT });
    reviewer = await createAccount(pool, 'batch-reviewer@test', { role: 'reviewer', departmentCode: DEPT });
    admin = await createAccount(pool, 'batch-admin@test', { role: 'admin', departmentCode: DEPT });
  });
  after(async () => {
    await app?.close();
    await pool?.end();
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM batch_archives WHERE department_code = $1', [DEPT]);
    await pool.query('DELETE FROM blacklist_entries WHERE label = $1', ['test-blacklist']);
  });

  const submit = (who, credits, { pd = nextPd(), payload = true, file, workflow } = {}) => app.call('POST', '/api/batches', {
    token: who.token,
    body: {
      aba_content: (file ?? abaFile(credits)).toString('base64'),
      pd_number: pd,
      ...(workflow ? { workflow_type: workflow } : {}),
      ...(payload ? { metadata: payloadFor(credits) } : {}),
    },
  });
  const stored = async (code) => (await pool.query(
    "SELECT convert_from(file_data, 'UTF8') AS text, checksum, stage FROM batch_archives WHERE code = $1", [code]
  )).rows[0];

  test('a valid batch is stored with a server checksum and audited', async () => {
    const res = await submit(submitter, GOOD);
    assert.equal(res.status, 201);
    const row = await stored(res.json.code);
    assert.match(row.checksum, /^[0-9a-f]{64}$/);
    const audit = await lastAudit(pool, 'batch.submit', res.json.code);
    assert.equal(audit.actor_id, submitter.reviewer.id);
    assert.equal(audit.after.total_cents, 5150000);
    assert.equal(audit.after.credit_lines, 2);
  });

  test('a file whose totals do not add up is refused', async () => {
    const res = await submit(submitter, GOOD, { file: abaFile(GOOD, { trailerCredits: 1 }) });
    assert.equal(res.status, 400);
    assert.match(res.json.message, /trailer totals/);
  });

  test('a file paying someone the payload does not show is refused', async () => {
    const hidden = [GOOD[0], ['062-999', '55555555', 4999975]];
    const res = await app.call('POST', '/api/batches', {
      token: submitter.token,
      body: { aba_content: abaFile(hidden).toString('base64'), pd_number: nextPd(), metadata: payloadFor(GOOD) },
    });
    assert.equal(res.status, 400);
    assert.match(res.json.message, /do not match its ABA file/);
  });

  test('a blacklisted payee is refused even with no payload to check', async () => {
    await pool.query(
      "INSERT INTO blacklist_entries (bsb, account, label, active) VALUES ('062-999', '55555555', 'test-blacklist', TRUE)"
    );
    const res = await submit(submitter, [['062-999', '55555555', 1000]], { payload: false });
    assert.equal(res.status, 400);
    assert.match(res.json.message, /062-999 \/ 55555555 \(test-blacklist\) are not permitted/);
  });

  test('a PD already used is refused however it is written', async () => {
    const pd = nextPd();
    assert.equal((await submit(submitter, GOOD, { pd })).status, 201);
    const again = await submit(submitter, GOOD, { pd: `PD ${pd}` });
    assert.equal(again.status, 409);
  });

  test('a value-date change amends only the date, whatever file the client sends, and is audited', async () => {
    const { json: { code } } = await submit(submitter, GOOD);
    const before = await stored(code);
    const evil = abaFile([GOOD[0], ['062-999', '55555555', 4999975]], { proc: '091026' });
    const res = await app.call('PATCH', `/api/batches/${code}/value-date`, {
      token: reviewer.token,
      body: { proc: '091026', aba_content: evil.toString('base64') },
    });
    assert.equal(res.status, 200);
    const after = await stored(code);
    const [head, ...lines] = after.text.split('\r\n');
    assert.equal(head.slice(74, 80), '091026');
    assert.equal(lines[1].slice(1, 17), '062-000 12345678');
    assert.equal(after.text.replace(/091026/g, '061026'), before.text);
    const audit = await lastAudit(pool, 'batch.value_date', code);
    assert.equal(audit.before.proc, '061026');
    assert.equal(audit.after.proc, '091026');
    assert.notEqual(audit.before.checksum, audit.after.checksum);
  });

  test('nobody approves their own public health batch; another reviewer can, and it is audited', async () => {
    const { json: { code } } = await submit(admin, GOOD, { workflow: 'public_health' });
    const own = await app.call('PATCH', `/api/batches/${code}/stage`, { token: admin.token, body: { stage: 'approved' } });
    assert.equal(own.status, 403);
    const other = await app.call('PATCH', `/api/batches/${code}/stage`, { token: reviewer.token, body: { stage: 'approved' } });
    assert.equal(other.status, 200);
    const audit = await lastAudit(pool, 'batch.approve', code);
    assert.equal(audit.actor_id, reviewer.reviewer.id);
    assert.deepEqual([audit.before.stage, audit.after.stage], ['submitted', 'approved']);
  });

  test('a departmental batch can only be rejected, and the rejection is audited', async () => {
    const { json: { code } } = await submit(submitter, GOOD);
    const approve = await app.call('PATCH', `/api/batches/${code}/stage`, { token: reviewer.token, body: { stage: 'approved' } });
    assert.equal(approve.status, 400);
    const reject = await app.call('PATCH', `/api/batches/${code}/stage`, {
      token: reviewer.token, body: { stage: 'rejected', comments: 'Wrong account', notify: false },
    });
    assert.equal(reject.status, 200);
    assert.equal((await lastAudit(pool, 'batch.reject', code)).metadata.comments, 'Wrong account');
  });

  test('only an admin deletes a batch, and the audit log keeps what was deleted', async () => {
    const { json: { code } } = await submit(submitter, GOOD);
    assert.equal((await app.call('DELETE', `/api/batches/${code}`, { token: reviewer.token })).status, 403);
    assert.equal((await app.call('DELETE', `/api/batches/${code}`, { token: admin.token })).status, 204);
    assert.equal(await stored(code), undefined);
    const audit = await lastAudit(pool, 'batch.delete', code);
    assert.equal(audit.before.code, code);
    assert.equal(audit.actor_id, admin.reviewer.id);
  });

  test('the audit log cannot be changed or emptied', async () => {
    await submit(submitter, GOOD);
    await assert.rejects(() => pool.query("UPDATE audit_log SET action = 'x' WHERE action = 'batch.submit'"), /append-only/);
    await assert.rejects(() => pool.query("DELETE FROM audit_log WHERE action = 'batch.submit'"), /append-only/);
    await assert.rejects(() => pool.query('TRUNCATE audit_log'), /append-only/);
  });
});

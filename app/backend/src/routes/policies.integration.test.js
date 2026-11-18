/**
 * Policies & Procedures over HTTP, against a real Postgres: who can read and
 * write what, how drafts become published versions, and which files reach
 * readers.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after, before, beforeEach, describe } from 'node:test';
import { connectTestDatabase, skipWithoutDatabase } from '../test-support/database.js';
import { createAccount, lastAudit, prepareRoutes, startApp } from '../test-support/http.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415478da63f8ffff3f0005fe02fea7d6a4ab0000000049454e44ae426082', 'hex');
const WORD = readFileSync(new URL('../test-support/fixtures/policy-import.docx', import.meta.url));

describe('policies and procedures', { skip: skipWithoutDatabase }, () => {
  let pool;
  let app;
  let editor;
  let publisher;
  let reader;
  let staffOnly;

  const as = (who) => (method, path, body) => app.call(method, `/api/policies${path}`, { token: who.token, body });

  async function upload(who, path, name, bytes) {
    const form = new FormData();
    form.append('file', new Blob([bytes]), name);
    const response = await fetch(`${app.base}/api/policies${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${who.token}` }, body: form,
    });
    return { status: response.status, json: await response.json().catch(() => null) };
  }

  const fetchFile = (who, url) => fetch(app.base + url, { headers: { Authorization: `Bearer ${who.token}` } });

  /** Registers a document and returns it with its empty first draft. */
  async function register(fields = {}) {
    const res = await as(editor)('POST', '/', { code: 'FIN-SOP-001', title: 'Releasing payments', doc_type: 'procedure', ...fields });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    return res.json;
  }

  async function writeAndPublish(id, html, summary = 'First version.') {
    const current = (await as(editor)('GET', `/${id}`)).json;
    const saved = await as(editor)('PUT', `/${id}/draft`, { body_html: html, revision: current.draft?.revision ?? null });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const published = await as(publisher)('POST', `/${id}/publish`, { revision: saved.json.draft.revision, change_summary: summary });
    assert.equal(published.status, 200, JSON.stringify(published.json));
    return published.json;
  }

  before(async () => {
    pool = await connectTestDatabase();
    prepareRoutes();
    const { default: router } = await import('./policies.js');
    app = await startApp({ '/api/policies': router });
    editor = await createAccount(pool, 'policy-editor@test', { capabilities: ['policy_edit'] });
    publisher = await createAccount(pool, 'policy-publisher@test', { capabilities: ['policy_publish'] });
    reader = await createAccount(pool, 'policy-reader@test');
    staffOnly = await createAccount(pool, 'policy-staff@test');
    await pool.query("UPDATE reviewers SET account_type = 'employee', onboarding_state = 'ready' WHERE id = $1", [staffOnly.reviewer.id]);
    await pool.query("INSERT INTO hr_employees (display_name, reviewer_id, status) VALUES ('Policy Staff', $1, 'active')", [staffOnly.reviewer.id]);
  });
  after(async () => {
    await pool?.query('DELETE FROM policy_documents');
    await app?.close();
    await pool?.end();
  });
  beforeEach(() => pool.query('DELETE FROM policy_documents'));

  test('a document reaches readers only once published, and each version is kept', async () => {
    const created = await register();
    assert.equal(created.draft.version_no, 1);
    assert.equal((await as(reader)('GET', '/')).json.length, 0, 'readers see nothing before it is published');
    assert.equal((await as(reader)('GET', `/${created.id}`)).status, 404);

    const first = await writeAndPublish(created.id, '<h2>Purpose</h2><p>Record every payment.</p>');
    assert.equal(first.published.version_no, 1);
    assert.equal(first.draft, null);

    const library = (await as(reader)('GET', '/')).json;
    assert.deepEqual(library.map((d) => [d.code, d.published_version_no]), [['FIN-SOP-001', 1]]);
    assert.equal('draft_version_no' in library[0], false, 'readers are not told about drafts');
    const page = (await as(reader)('GET', `/${created.id}`)).json;
    assert.equal(page.published.body_html, '<h2>Purpose</h2><p>Record every payment.</p>');
    assert.equal(page.draft, null);

    // Editing starts a second draft from the published text; readers keep seeing version 1.
    const second = await as(editor)('PUT', `/${created.id}/draft`, { body_html: '<p>Record and check every payment.</p>', revision: null });
    assert.equal(second.json.draft.version_no, 2);
    assert.equal((await as(reader)('GET', `/${created.id}`)).json.published.version_no, 1);
    assert.equal((await as(reader)('GET', `/${created.id}`)).json.draft, null);

    const republished = await as(publisher)('POST', `/${created.id}/publish`, {
      revision: second.json.draft.revision, change_summary: 'Adds the check.', review_due: '2027-11-18',
    });
    assert.equal(republished.status, 200);
    assert.equal(republished.json.review_due, '2027-11-18');
    const history = (await as(reader)('GET', `/${created.id}`)).json.versions;
    assert.deepEqual(history.map((v) => [v.version_no, v.status, v.change_summary]),
      [[2, 'published', 'Adds the check.'], [1, 'superseded', 'First version.']]);
    const old = await as(reader)('GET', `/${created.id}/versions/${history[1].id}`);
    assert.equal(old.json.body_html, '<h2>Purpose</h2><p>Record every payment.</p>', 'the earlier wording can still be read');

    const audit = await lastAudit(pool, 'policy.published', created.id);
    assert.deepEqual(audit.after, { version_no: 2, replaces: 1, change_summary: 'Adds the check.', review_due: '2027-11-18' });
    assert.equal(audit.actor_id, publisher.reviewer.id);
  });

  test('writing and publishing each need their own tick', async () => {
    assert.equal((await as(reader)('POST', '/', { code: 'X-1', title: 'X', doc_type: 'policy' })).status, 403);
    assert.equal((await as(publisher)('POST', '/', { code: 'X-1', title: 'X', doc_type: 'policy' })).status, 403);
    const created = await register();
    const saved = await as(editor)('PUT', `/${created.id}/draft`, { body_html: '<p>Text</p>', revision: created.draft.revision });
    assert.equal((await as(publisher)('PUT', `/${created.id}/draft`, { body_html: '<p>Mine</p>', revision: saved.json.draft.revision })).status, 403);
    assert.equal((await as(editor)('POST', `/${created.id}/publish`, { revision: saved.json.draft.revision, change_summary: 'x' })).status, 403);
    assert.equal((await as(editor)('POST', `/${created.id}/withdraw`, { reason: 'x' })).status, 403);
  });

  test('a Leave-only staff login reads the library but cannot write to it', async () => {
    const created = await register();
    await writeAndPublish(created.id, '<p>Everyone reads this.</p>');
    assert.equal((await as(staffOnly)('GET', '/')).json.length, 1);
    assert.equal((await as(staffOnly)('GET', `/${created.id}`)).json.published.body_html, '<p>Everyone reads this.</p>');
    assert.equal((await as(staffOnly)('POST', '/', { code: 'X-2', title: 'X', doc_type: 'policy' })).status, 403);
  });

  test('a save based on an older revision is refused instead of overwriting', async () => {
    const created = await register();
    const mine = await as(editor)('PUT', `/${created.id}/draft`, { body_html: '<p>Mine</p>', revision: created.draft.revision });
    assert.equal(mine.status, 200);
    const stale = await as(editor)('PUT', `/${created.id}/draft`, { body_html: '<p>Theirs</p>', revision: created.draft.revision });
    assert.equal(stale.status, 409);
    const publishStale = await as(publisher)('POST', `/${created.id}/publish`, { revision: created.draft.revision, change_summary: 'x' });
    assert.equal(publishStale.status, 409, 'nothing goes into force that the publisher has not read');
    assert.equal((await as(editor)('GET', `/${created.id}`)).json.draft.body_html, '<p>Mine</p>');
  });

  test('what is saved is cleaned, and an empty or unexplained draft is not published', async () => {
    const created = await register();
    const empty = await as(publisher)('POST', `/${created.id}/publish`, { revision: created.draft.revision, change_summary: 'x' });
    assert.equal(empty.status, 400);
    const saved = await as(editor)('PUT', `/${created.id}/draft`, {
      body_html: '<p onclick="steal()">Safe<script>alert(1)</script></p>', revision: created.draft.revision,
    });
    assert.equal(saved.json.draft.body_html, '<p>Safe</p>');
    const unexplained = await as(publisher)('POST', `/${created.id}/publish`, { revision: saved.json.draft.revision, change_summary: ' ' });
    assert.equal(unexplained.status, 400);
  });

  test("files reach readers only through a published version of their own document", async () => {
    const created = await register();
    const picture = await upload(editor, `/${created.id}/files`, 'chart.png', PNG);
    assert.equal(picture.status, 201, JSON.stringify(picture.json));
    assert.equal(picture.json.is_picture, true);
    const form = await upload(editor, `/${created.id}/files`, 'claim form.pdf', Buffer.from('%PDF-1.4 test'));
    assert.equal(form.status, 201);

    const html = `<p><img src="${picture.json.url}" alt="Chart"></p><p><a href="${form.json.url}">Claim form</a></p>`;
    const current = (await as(editor)('GET', `/${created.id}`)).json;
    const saved = await as(editor)('PUT', `/${created.id}/draft`, { body_html: html, revision: current.draft.revision });
    assert.equal((await fetchFile(reader, picture.json.url)).status, 404, 'a draft file stays with the editors');
    assert.equal((await fetchFile(editor, picture.json.url)).status, 200);

    await as(publisher)('POST', `/${created.id}/publish`, { revision: saved.json.draft.revision, change_summary: 'First version.' });
    const shown = await fetchFile(reader, picture.json.url);
    assert.equal(shown.status, 200);
    assert.equal(shown.headers.get('content-type'), 'image/png');
    assert.match(shown.headers.get('content-disposition'), /^inline/);
    const download = await fetchFile(staffOnly, form.json.url);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition'), /^attachment; filename="claim form.pdf"/);
    assert.deepEqual((await as(reader)('GET', `/${created.id}`)).json.published.attachments.map((a) => a.file_name), ['claim form.pdf']);

    // Another document linking to this file does not make a stray upload public.
    const stray = await upload(editor, `/${created.id}/files`, 'stray.png', PNG);
    const other = await register({ code: 'FIN-SOP-002', title: 'Other' });
    await writeAndPublish(other.id, `<p>See the chart.</p><p><img src="${stray.json.url}" alt="x"></p>`);
    assert.equal((await fetchFile(reader, stray.json.url)).status, 404);
  });

  test('a file must really be what its name says', async () => {
    const created = await register();
    assert.equal((await upload(editor, `/${created.id}/files`, 'renamed.pdf', PNG)).status, 400);
    assert.equal((await upload(editor, `/${created.id}/files`, 'script.html', Buffer.from('<script>'))).status, 400);
  });

  test('a Word document is imported for the editor, with its picture stored', async () => {
    const created = await register();
    const imported = await upload(editor, `/${created.id}/import-word`, 'Payments SOP.docx', WORD);
    assert.equal(imported.status, 200, JSON.stringify(imported.json));
    assert.match(imported.json.html, /^<h2>Purpose<\/h2>/);
    assert.equal(imported.json.notes.length, 2);
    const { rows } = await pool.query('SELECT file_name, content_type FROM policy_files WHERE document_id = $1', [created.id]);
    assert.deepEqual(rows, [{ file_name: 'Payments SOP picture 1.png', content_type: 'image/png' }]);
    assert.equal((await as(editor)('GET', `/${created.id}`)).json.draft.body_html, '', 'nothing is saved until the editor saves');
    assert.equal((await upload(editor, `/${created.id}/import-word`, 'old.doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))).status, 400);
  });

  test('search looks through the published text and shows where it matched', async () => {
    const pay = await register();
    await writeAndPublish(pay.id, '<p>Every payment needs two signatures before the cheque is released.</p>');
    const leave = await register({ code: 'HR-POL-001', title: 'Annual leave', doc_type: 'policy', category: 'Human resources' });
    await writeAndPublish(leave.id, '<p>Staff apply for leave in the portal.</p>');

    const found = (await as(reader)('GET', '/?q=signatures')).json;
    assert.deepEqual(found.map((d) => d.code), ['FIN-SOP-001']);
    assert.match(found[0].snippet, /⟦signatures⟧/);
    assert.deepEqual((await as(reader)('GET', '/?q=HR-POL')).json.map((d) => d.code), ['HR-POL-001'], 'codes match in part');
    assert.deepEqual((await as(reader)('GET', '/?type=policy')).json.map((d) => d.code), ['HR-POL-001']);
    assert.deepEqual((await as(reader)('GET', '/meta')).json.categories, ['Human resources']);
  });

  test('a withdrawn document leaves the library but keeps its history', async () => {
    const created = await register();
    await writeAndPublish(created.id, '<p>Old rule.</p>');
    assert.equal((await as(publisher)('POST', `/${created.id}/withdraw`, {})).status, 400, 'a reason is needed');
    const withdrawn = await as(publisher)('POST', `/${created.id}/withdraw`, { reason: 'Replaced by the new payments manual.' });
    assert.equal(withdrawn.status, 200);
    assert.equal((await as(reader)('GET', '/')).json.length, 0);
    assert.equal((await as(reader)('GET', `/${created.id}`)).status, 404);
    assert.equal((await as(editor)('GET', '/')).json[0].retired_at !== null, true, 'editors still see it');
    assert.equal((await as(editor)('PUT', `/${created.id}/draft`, { body_html: '<p>x</p>', revision: null })).status, 400);
    assert.equal((await as(editor)('DELETE', `/${created.id}`)).status, 400, 'a published document is never deleted');

    assert.equal((await as(publisher)('POST', `/${created.id}/restore`)).status, 200);
    assert.equal((await as(reader)('GET', '/')).json.length, 1);
    assert.equal((await lastAudit(pool, 'policy.withdrawn', created.id)).after.reason, 'Replaced by the new payments manual.');
  });

  test('a document never published can be deleted; a published one can have its draft discarded', async () => {
    const unpublished = await register();
    assert.equal((await as(editor)('DELETE', `/${unpublished.id}/draft?revision=${unpublished.draft.revision}`)).status, 400);
    assert.equal((await as(editor)('DELETE', `/${unpublished.id}`)).status, 204);
    assert.equal((await lastAudit(pool, 'policy.deleted', unpublished.id)).before.code, 'FIN-SOP-001');

    const published = await register();
    await writeAndPublish(published.id, '<p>In force.</p>');
    const draft = await as(editor)('PUT', `/${published.id}/draft`, { body_html: '<p>Maybe.</p>', revision: null });
    const discarded = await as(editor)('DELETE', `/${published.id}/draft?revision=${draft.json.draft.revision}`);
    assert.equal(discarded.status, 200);
    assert.equal(discarded.json.draft, null);
    assert.equal(discarded.json.published.body_html, '<p>In force.</p>');
  });

  test('codes are unique whatever their case', async () => {
    await register();
    const clash = await as(editor)('POST', '/', { code: 'fin-sop-001', title: 'Copy', doc_type: 'policy' });
    assert.equal(clash.status, 409);
    assert.match(clash.json.message, /already the code of "Releasing payments"/);
  });
});

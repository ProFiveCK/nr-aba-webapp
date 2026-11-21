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
  async function reset() {
    await pool.query('DELETE FROM policy_documents');
    await pool.query('DELETE FROM policy_categories WHERE parent_id IS NOT NULL');
    await pool.query('DELETE FROM policy_categories');
  }

  after(async () => {
    if (pool) await reset();
    await app?.close();
    await pool?.end();
  });
  beforeEach(reset);

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

  test('what is saved is cleaned, and an empty draft is not published', async () => {
    const created = await register();
    const empty = await as(publisher)('POST', `/${created.id}/publish`, { revision: created.draft.revision });
    assert.equal(empty.status, 400);
    const saved = await as(editor)('PUT', `/${created.id}/draft`, {
      body_html: '<p onclick="steal()">Safe<script>alert(1)</script></p>', revision: created.draft.revision,
    });
    assert.equal(saved.json.draft.body_html, '<p>Safe</p>');
  });

  test('publishing numbers the version itself; a note and a review date are optional', async () => {
    const created = await register({ review_due: '2027-06-30' });
    let current = (await as(editor)('PUT', `/${created.id}/draft`, { body_html: '<p>One</p>', revision: created.draft.revision })).json;
    let published = await as(publisher)('POST', `/${created.id}/publish`, { revision: current.draft.revision });
    assert.equal(published.status, 200, JSON.stringify(published.json));
    assert.equal(published.json.published.version_no, 1);
    assert.equal(published.json.versions[0].change_summary, null);
    assert.equal(published.json.review_due, '2027-06-30', 'leaving the review date out keeps it');

    current = (await as(editor)('PUT', `/${created.id}/draft`, { body_html: '<p>Two</p>', revision: null })).json;
    published = await as(publisher)('POST', `/${created.id}/publish`, { revision: current.draft.revision, change_summary: '', review_due: null });
    assert.equal(published.json.published.version_no, 2);
    assert.equal(published.json.review_due, null, 'a blank review date clears it');
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
    const leave = await register({ code: 'HR-POL-001', title: 'Annual leave', doc_type: 'policy' });
    await writeAndPublish(leave.id, '<p>Staff apply for leave in the portal.</p>');

    const found = (await as(reader)('GET', '/?q=signatures')).json;
    assert.deepEqual(found.map((d) => d.code), ['FIN-SOP-001']);
    assert.match(found[0].snippet, /⟦signatures⟧/);
    assert.deepEqual((await as(reader)('GET', '/?q=HR-POL')).json.map((d) => d.code), ['HR-POL-001'], 'codes match in part');
    assert.deepEqual((await as(reader)('GET', '/?type=policy')).json.map((d) => d.code), ['HR-POL-001']);
  });

  test('a withdrawn document leaves the library but keeps its history', async () => {
    const created = await register();
    await writeAndPublish(created.id, '<p>Old rule.</p>');
    assert.equal((await as(publisher)('POST', `/${created.id}/withdraw`, {})).status, 400, 'a reason is needed');
    const withdrawn = await as(publisher)('POST', `/${created.id}/withdraw`, { reason: 'Replaced by the new payments manual.' });
    assert.equal(withdrawn.status, 200);
    assert.equal((await as(reader)('GET', '/')).json.length, 0);
    assert.equal((await as(reader)('GET', `/${created.id}`)).status, 404);
    assert.equal((await as(editor)('GET', '/')).json.length, 0, 'it leaves the library for editors too');
    assert.deepEqual((await as(editor)('GET', '/?state=withdrawn')).json.map((d) => d.code), ['FIN-SOP-001'], 'editors find it under Withdrawn');
    assert.equal((await as(reader)('GET', '/?state=withdrawn')).json.length, 0, 'readers have no such view');
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

  /** Creates a category as the publisher and returns its id. */
  async function category(name, parentId = null) {
    const res = await as(publisher)('POST', '/categories', { name, parent_id: parentId });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    return res.json.id;
  }

  test('publishers keep the structure: manuals hold sections, two levels at most', async () => {
    assert.equal((await as(editor)('POST', '/categories', { name: 'Mine' })).status, 403, 'editors pick categories, they do not make them');
    const finance = await category('Finance Manual');
    const payments = await category('Payments', finance);
    const procurement = await category('Procurement', finance);
    const hr = await category('HR Manual');

    assert.equal((await as(publisher)('POST', '/categories', { name: 'Petty cash', parent_id: payments })).status, 400, 'no third level');
    assert.equal((await as(publisher)('POST', '/categories', { name: 'payments', parent_id: finance })).status, 409, 'one name once per manual');
    await category('Payments', hr);
    assert.equal((await as(publisher)('PATCH', `/categories/${finance}`, { name: 'Finance Manual', parent_id: hr })).status, 400,
      'a manual with sections stays a manual');

    assert.equal((await as(publisher)('POST', `/categories/${procurement}/move`, { direction: 'up' })).status, 204);
    const listed = (await as(publisher)('GET', '/meta')).json.categories;
    assert.deepEqual(listed.filter((c) => c.parent_id === finance).map((c) => c.name), ['Procurement', 'Payments']);
    assert.deepEqual(listed.filter((c) => !c.parent_id).map((c) => c.name), ['Finance Manual', 'HR Manual']);

    const renamed = await as(publisher)('PATCH', `/categories/${procurement}`, { name: 'Purchasing', parent_id: null });
    assert.equal(renamed.status, 200, 'a section can become a manual of its own');
    assert.equal((await lastAudit(pool, 'policy.category.updated', procurement)).before.name, 'Procurement');
  });

  test('documents are tagged from the list and browsed by manual or section', async () => {
    const finance = await category('Finance Manual');
    const payments = await category('Payments', finance);
    const unused = await category('Procurement', finance);
    const hr = await category('HR Manual');
    const leave = await category('Leave', hr);

    const a = await register({ code: 'FIN-SOP-001', category_ids: [payments] });
    const b = await register({ code: 'HR-POL-001', title: 'Conduct', category_ids: [hr] });
    const c = await register({ code: 'HR-SOP-002', title: 'Leave pay', category_ids: [payments, leave] });
    await writeAndPublish(a.id, '<p>A</p>');
    await writeAndPublish(b.id, '<p>B</p>');
    assert.deepEqual(c.categories.map((t) => [t.parent_name, t.name]), [['Finance Manual', 'Payments'], ['HR Manual', 'Leave']]);

    const codes = async (who, query) => (await as(who)('GET', `/?${query}`)).json.map((d) => d.code);
    assert.deepEqual(await codes(reader, `category=${finance}`), ['FIN-SOP-001'], 'a manual includes its sections');
    assert.deepEqual(await codes(reader, `category=${hr}`), ['HR-POL-001']);
    assert.deepEqual(await codes(editor, `category=${hr}`), ['HR-POL-001', 'HR-SOP-002'], 'editors also see what is not yet published');

    const counts = async (who) => Object.fromEntries((await as(who)('GET', '/meta')).json.categories.map((t) => [t.name, t.document_count]));
    assert.deepEqual(await counts(reader), { 'Finance Manual': 1, Payments: 1, 'HR Manual': 1 }, 'readers see only what holds something for them');
    assert.deepEqual(await counts(editor), { 'Finance Manual': 2, Payments: 2, Procurement: 0, 'HR Manual': 2, Leave: 1 });
    const loose = await register({ code: 'LOOSE-1', title: 'Untagged' });
    await writeAndPublish(loose.id, '<p>No category.</p>');
    const readerMeta = (await as(reader)('GET', '/meta')).json;
    assert.deepEqual([readerMeta.document_count, readerMeta.uncategorised_count], [3, 1]);
    assert.deepEqual(await codes(reader, 'category=none'), ['LOOSE-1'], 'documents in no category have a view of their own');

    assert.equal((await as(editor)('POST', '/', { code: 'X-1', title: 'X', doc_type: 'policy', category_ids: ['11111111-2222-4333-8444-555555555555'] })).status, 400);
    assert.equal((await as(publisher)('DELETE', `/categories/${payments}`)).status, 400, 'a category in use stays');
    assert.equal((await as(publisher)('DELETE', `/categories/${finance}`)).status, 400, 'a manual with sections stays');
    assert.equal((await as(publisher)('DELETE', `/categories/${unused}`)).status, 204);

    const retagged = await as(editor)('PATCH', `/${c.id}`, { code: 'HR-SOP-002', title: 'Leave pay', doc_type: 'procedure', category_ids: [leave] });
    assert.deepEqual(retagged.json.categories.map((t) => t.name), ['Leave']);
    const audit = await lastAudit(pool, 'policy.details_updated', c.id);
    assert.deepEqual([audit.before.categories, audit.after.categories], [['Leave', 'Payments'], ['Leave']]);
  });

  test('free-text categories from the first release become managed ones', async () => {
    const { initPolicySchema } = await import('../services/policySchema.js');
    const one = await register({ code: 'OLD-1' });
    const two = await register({ code: 'OLD-2' });
    const three = await register({ code: 'OLD-3' });
    await pool.query('ALTER TABLE policy_documents ADD COLUMN category TEXT');
    try {
      await pool.query("UPDATE policy_documents SET category = CASE code WHEN 'OLD-1' THEN ' Payments ' WHEN 'OLD-2' THEN 'payments' ELSE NULL END");
      const client = await pool.connect();
      try { await initPolicySchema(client); } finally { client.release(); }
    } finally {
      await pool.query('ALTER TABLE policy_documents DROP COLUMN IF EXISTS category');
    }
    const { rows: made } = await pool.query('SELECT name, parent_id FROM policy_categories');
    assert.deepEqual(made, [{ name: 'Payments', parent_id: null }]);
    const tagged = async (doc) => (await as(editor)('GET', `/${doc.id}`)).json.categories.map((t) => t.name);
    assert.deepEqual([await tagged(one), await tagged(two), await tagged(three)], [['Payments'], ['Payments'], []]);
  });

  test('an earlier version can be restored as the next draft, once, and never over the version in force', async () => {
    const created = await register();
    await writeAndPublish(created.id, '<h2>First</h2><p>The original wording.</p>', 'Start.');
    await writeAndPublish(created.id, '<h2>Second</h2><p>The replacement wording.</p>', 'Change.');
    const page = (await as(editor)('GET', `/${created.id}`)).json;
    assert.equal(page.published.version_no, 2);
    const first = page.versions.at(-1);
    assert.equal(first.version_no, 1);

    const restored = await as(editor)('POST', `/${created.id}/versions/${first.id}/restore-draft`);
    assert.equal(restored.status, 200);
    assert.equal(restored.json.draft.version_no, 3);
    assert.equal(restored.json.draft.body_html, '<h2>First</h2><p>The original wording.</p>');

    // The version in force is untouched; readers see it, not the draft.
    const readerPage = (await as(reader)('GET', `/${created.id}`)).json;
    assert.equal(readerPage.published.version_no, 2);assert.equal(readerPage.draft, null);

    // One draft at a time; an unknown version is a 404.
    assert.equal((await as(editor)('POST', `/${created.id}/versions/${first.id}/restore-draft`)).status, 409);
    assert.equal((await as(editor)('POST', `/${created.id}/versions/11111111-2222-4333-8444-555555555555/restore-draft`)).status, 404);
    assert.equal((await as(reader)('POST', `/${created.id}/versions/${first.id}/restore-draft`)).status, 403);
    const audit = await lastAudit(pool, 'policy.draft_restored', created.id);
    assert.equal(audit.after.restored_from, 1);
  });

  test('the reference check reports internal links and files that no longer resolve', async () => {
    const target = await register({ code: 'REF-TARGET', title: 'Withdrawn later' });
    await writeAndPublish(target.id, '<h2>Target</h2><p>In force.</p>');
    const source = await register({ code: 'REF-SOURCE', title: 'The referrer' });
    const file = await upload(editor, `/${source.id}/files`, 'note.pdf', Buffer.from('%PDF-reference'));
    await writeAndPublish(source.id,
      `<p>See <a href="/policies/${target.id}">the target</a> and <a href="/policies/${source.id}#details">this same policy</a>.</p>`
      + `<img src="/api/policies/files/${file.json.id}" alt="note"><p><a href="/api/policies/files/${file.json.id}">note.pdf</a></p>`, 'References.');

    // Everything resolves: the self link and the stored file are fine.
    const clean = await as(editor)('GET', '/reference-check');
    assert.equal(clean.status, 200);
    assert.equal(clean.json.documents, 2);
    assert.equal(clean.json.issues.length, 0);
    assert.equal((await as(reader)('GET', '/reference-check')).status, 403);

    // A withdrawn target stops resolving; a file that leaves the library stops resolving.
    await as(publisher)('POST', `/${target.id}/withdraw`, { reason: 'Superseded elsewhere.' });
    const { rows: [pruned] } = await pool.query(`DELETE FROM policy_files WHERE id = $1 RETURNING id`, [file.json.id]);
    await pool.query(`UPDATE policy_versions SET body_html = replace(body_html, $2, $3) WHERE document_id = $1`,
      [source.id, pruned.id, '11111111-2222-4333-8444-555555555555']);
    const issues = (await as(editor)('GET', '/reference-check')).json.issues;
    const forSource = issues.filter((issue) => issue.code === 'REF-SOURCE');
    assert.equal(forSource.length, 2);
    assert.deepEqual(forSource.map((issue) => [issue.location, issue.target_kind]),
      [['published', 'document'], ['published', 'file']]);
    assert.match(forSource[0].issue, /withdrawn/);
    assert.equal(forSource[0].target_label, 'REF-TARGET Withdrawn later');
    assert.equal(forSource[1].target, '11111111-2222-4333-8444-555555555555');
  });
});

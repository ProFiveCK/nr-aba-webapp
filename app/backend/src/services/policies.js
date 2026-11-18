/**
 * Policies & Procedures: the library every signed-in account reads, and the
 * drafting and publishing behind it.
 *
 * Who may do what:
 * - anyone signed in reads published documents and their earlier versions;
 * - "Write and edit drafts" (policy_edit) registers documents, writes drafts,
 *   adds files and imports Word documents;
 * - "Approve and publish" (policy_publish) puts a draft into force,
 *   withdraws or restores a document, and maintains the categories (manuals
 *   and their sections) that documents are tagged with.
 * Either tick also shows drafts and withdrawn documents, since both kinds of
 * work need to see them.
 *
 * A draft carries a revision number that each save moves on. Saving or
 * publishing names the revision it was based on, and is refused if someone
 * else has saved since — so one editor never silently overwrites another, and
 * nothing goes into force that the publisher has not read.
 */
import { pool } from '../db.js';
import { withTransaction } from '../lib/transaction.js';
import { badRequest, notFound, ServiceError } from '../lib/serviceError.js';
import { cleanPolicyHtml, policyFileUrl, policyText, referencedFileIds } from '../lib/policyHtml.js';
import { PERMISSIONS, POLICY_TYPES } from '../config.js';
import { sha256 } from '../middleware/upload.js';
import { recordAudit } from './auditService.js';
import { wordToPolicyHtml } from './policyImport.js';

const conflict = (message) => new ServiceError(409, message);

const TODAY = "(NOW() AT TIME ZONE 'Pacific/Nauru')::date";
const TYPE_KEYS = POLICY_TYPES.map((t) => t.key);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What this account may do in the library. */
export function policyRights(user) {
  const granted = user?.permissions ?? {};
  const canEdit = granted[PERMISSIONS.POLICY_EDIT] === true;
  const canPublish = granted[PERMISSIONS.POLICY_PUBLISH] === true;
  return { canEdit, canPublish, canManage: canEdit || canPublish };
}

const isPicture = (contentType) => String(contentType).startsWith('image/');

function fileView(row) {
  return {
    id: row.id,
    url: policyFileUrl(row.id),
    file_name: row.file_name,
    content_type: row.content_type,
    byte_size: row.byte_size,
    is_picture: isPicture(row.content_type),
  };
}

// ===== Reading =====

// What "in the library" means for a document, as SQL on `d`: readers see
// what is in force; editors and publishers also see what is not yet
// published. Withdrawn documents have a view of their own.
const inLibrary = (canManage) => (canManage
  ? 'd.retired_at IS NULL'
  : `d.retired_at IS NULL AND EXISTS (
      SELECT 1 FROM policy_versions p WHERE p.document_id = d.id AND p.status = 'published')`);

/** The categories tagged on a document, as JSON, for a SELECT over `d`. */
const DOCUMENT_CATEGORIES = `COALESCE((
  SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'parent_id', c.parent_id, 'parent_name', pc.name)
                  ORDER BY pc.sort_order NULLS FIRST, lower(pc.name) NULLS FIRST, c.sort_order, lower(c.name))
    FROM policy_document_categories dc
    JOIN policy_categories c ON c.id = dc.category_id
    LEFT JOIN policy_categories pc ON pc.id = c.parent_id
   WHERE dc.document_id = d.id), '[]'::json)`;

/**
 * The library's structure and the lists its filters and forms choose from.
 * Each category carries how many documents in the library it holds, counting
 * a manual's sections; readers are not shown categories with nothing in them.
 */
export async function policyMeta(user) {
  const { canEdit, canPublish, canManage } = policyRights(user);
  const visible = inLibrary(canManage);
  const [{ rows: departments }, { rows: categories }, { rows: [counts] }] = await Promise.all([
    canManage
      ? pool.query('SELECT id, name FROM hr_departments ORDER BY lower(name)')
      : pool.query(`SELECT DISTINCT dep.id, dep.name FROM policy_documents d
                      JOIN hr_departments dep ON dep.id = d.department_id
                     WHERE ${visible} ORDER BY dep.name`),
    pool.query(`
      SELECT c.id, c.parent_id, c.name, c.sort_order,
             (SELECT count(DISTINCT dc.document_id) FROM policy_document_categories dc
                JOIN policy_categories t ON t.id = dc.category_id
                JOIN policy_documents d ON d.id = dc.document_id
               WHERE (t.id = c.id OR t.parent_id = c.id) AND ${visible})::int AS document_count
        FROM policy_categories c
       ORDER BY c.sort_order, lower(c.name)`),
    pool.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM policy_document_categories dc WHERE dc.document_id = d.id))::int AS uncategorised
        FROM policy_documents d WHERE ${visible}`),
  ]);
  return {
    types: POLICY_TYPES,
    departments,
    document_count: counts.total,
    uncategorised_count: counts.uncategorised,
    categories: canManage ? categories : categories.filter((c) => c.document_count > 0),
    can_edit: canEdit,
    can_publish: canPublish,
  };
}

/** The views editors and publishers have besides a category, as SQL. */
const STATES = {
  draft: 'dr.id IS NOT NULL AND d.retired_at IS NULL',
  unpublished: 'p.id IS NULL AND d.retired_at IS NULL',
  overdue: `d.review_due < ${TODAY} AND d.retired_at IS NULL`,
  withdrawn: 'd.retired_at IS NOT NULL',
};

/**
 * The library, narrowed by any of: a category (a manual includes its
 * sections; "none" is the documents in no category), words to search for,
 * kind and owning department, and for
 * editors and publishers one of the STATES views. A search looks through the
 * code, title, category names and the published text, and returns a passage
 * from the text around the match, with the matched words between ⟦ and ⟧.
 */
export async function listPolicies(user, { q, type, category, department_id: departmentId, state } = {}) {
  const { canManage } = policyRights(user);
  const params = [];
  const add = (value) => { params.push(value); return `$${params.length}`; };
  const where = [canManage && Object.hasOwn(STATES, state) ? STATES[state] : inLibrary(canManage)];
  if (type) where.push(`d.doc_type = ${add(String(type))}`);
  if (category === 'none') {
    where.push('NOT EXISTS (SELECT 1 FROM policy_document_categories dc WHERE dc.document_id = d.id)');
  } else if (category) {
    if (!UUID.test(String(category))) throw badRequest('Choose a category from the list.');
    const id = add(String(category));
    where.push(`EXISTS (SELECT 1 FROM policy_document_categories dc JOIN policy_categories c ON c.id = dc.category_id
                         WHERE dc.document_id = d.id AND (c.id = ${id} OR c.parent_id = ${id}))`);
  }
  if (departmentId) {
    if (!UUID.test(String(departmentId))) throw badRequest('Choose a department from the list.');
    where.push(`d.department_id = ${add(String(departmentId))}`);
  }

  let rank = 'NULL::real';
  let snippet = 'NULL::text';
  const search = String(q ?? '').trim().slice(0, 200);
  if (search) {
    const words = `websearch_to_tsquery('english', ${add(search)})`;
    const like = add(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    const names = `(SELECT string_agg(c.name, ' ') FROM policy_document_categories dc
                      JOIN policy_categories c ON c.id = dc.category_id WHERE dc.document_id = d.id)`;
    const text = `to_tsvector('english', d.code || ' ' || d.title || ' ' || coalesce(${names}, '') || ' ' || coalesce(p.body_text, ''))`;
    where.push(`(${text} @@ ${words} OR d.title ILIKE ${like} OR d.code ILIKE ${like})`);
    rank = `ts_rank(${text}, ${words})`;
    snippet = `CASE WHEN coalesce(p.body_text, '') <> '' THEN ts_headline('english', p.body_text, ${words},
      'StartSel=⟦, StopSel=⟧, MaxWords=30, MinWords=12, MaxFragments=1') END`;
  }

  const { rows } = await pool.query(
    `SELECT d.id, d.code, d.title, d.doc_type, d.department_id, dep.name AS department_name,
            d.review_due, d.review_due < ${TODAY} AS review_overdue, d.retired_at,
            p.version_no AS published_version_no, p.published_at,
            ${canManage ? 'dr.version_no AS draft_version_no, dr.updated_at AS draft_updated_at,' : ''}
            ${DOCUMENT_CATEGORIES} AS categories,
            ${rank} AS rank, ${snippet} AS snippet
       FROM policy_documents d
       LEFT JOIN policy_versions p ON p.document_id = d.id AND p.status = 'published'
       LEFT JOIN policy_versions dr ON dr.document_id = d.id AND dr.status = 'draft'
       LEFT JOIN hr_departments dep ON dep.id = d.department_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${search ? 'rank DESC NULLS LAST, ' : ''}lower(d.code)`,
    params,
  );
  return rows.map(({ rank: _rank, ...row }) => row);
}

async function loadDocument(db, id, { lock = false } = {}) {
  if (!UUID.test(String(id))) return null;
  const { rows } = await db.query(
    `SELECT d.*, dep.name AS department_name, d.review_due < ${TODAY} AS review_overdue,
            rb.display_name AS retired_by_name, ${DOCUMENT_CATEGORIES} AS categories,
            EXISTS (SELECT 1 FROM policy_versions v WHERE v.document_id = d.id AND v.status = 'published') AS is_published,
            EXISTS (SELECT 1 FROM policy_versions v WHERE v.document_id = d.id AND v.status <> 'draft') AS was_published
       FROM policy_documents d
       LEFT JOIN hr_departments dep ON dep.id = d.department_id
       LEFT JOIN reviewers rb ON rb.id = d.retired_by
      WHERE d.id = $1 ${lock ? 'FOR UPDATE OF d' : ''}`,
    [id],
  );
  return rows[0] || null;
}

/** The document, or a 404 when this account may not see it. */
async function visibleDocument(user, id) {
  const document = await loadDocument(pool, id);
  if (!document) throw notFound('That document is not in the library.');
  if (!policyRights(user).canManage && (document.retired_at || !document.is_published)) {
    throw notFound('That document is not in the library.');
  }
  return document;
}

async function versionWithFiles(db, where, params) {
  const { rows } = await db.query(
    `SELECT v.id, v.version_no, v.status, v.body_html, v.change_summary, v.revision, v.file_ids,
            v.published_at, v.superseded_at, v.updated_at,
            pb.display_name AS published_by_name, ub.display_name AS updated_by_name
       FROM policy_versions v
       LEFT JOIN reviewers pb ON pb.id = v.published_by
       LEFT JOIN reviewers ub ON ub.id = v.updated_by
      WHERE ${where}`,
    params,
  );
  const version = rows[0];
  if (!version) return null;
  const { rows: files } = await db.query(
    'SELECT id, file_name, content_type, byte_size FROM policy_files WHERE id = ANY($1::uuid[]) ORDER BY file_name',
    [version.file_ids],
  );
  const { file_ids: _ids, ...rest } = version;
  // Pictures are already in the text; the rest are offered as downloads.
  return { ...rest, attachments: files.filter((f) => !isPicture(f.content_type)).map(fileView) };
}

/** One document: its register entry, the version in force, its history, and for editors its draft. */
export async function getPolicy(user, id) {
  const document = await visibleDocument(user, id);
  const { canManage } = policyRights(user);
  const [published, draft, { rows: versions }] = await Promise.all([
    versionWithFiles(pool, "v.document_id = $1 AND v.status = 'published'", [id]),
    canManage ? versionWithFiles(pool, "v.document_id = $1 AND v.status = 'draft'", [id]) : null,
    pool.query(
      `SELECT v.id, v.version_no, v.status, v.change_summary, v.published_at, v.superseded_at,
              pb.display_name AS published_by_name
         FROM policy_versions v LEFT JOIN reviewers pb ON pb.id = v.published_by
        WHERE v.document_id = $1 AND v.status <> 'draft'
        ORDER BY v.version_no DESC`,
      [id],
    ),
  ]);
  const { created_by: _c, retired_by: _r, is_published: _p, was_published: wasPublished, ...register } = document;
  return { ...register, was_published: wasPublished, published, draft: draft ?? null, versions };
}

/** An earlier (or the current) published version, as it read then. */
export async function getPolicyVersion(user, id, versionId) {
  await visibleDocument(user, id);
  if (!UUID.test(String(versionId))) throw notFound('That version is not in the library.');
  const version = await versionWithFiles(pool, "v.document_id = $1 AND v.id = $2 AND v.status <> 'draft'", [id, versionId]);
  if (!version) throw notFound('That version is not in the library.');
  return version;
}

/**
 * A stored file, if this account may have it. Editors may have any; readers
 * only one that a published or earlier version of a document still in the
 * library shows or links to.
 */
export async function readPolicyFile(user, fileId) {
  if (!UUID.test(String(fileId))) throw notFound('That file is not in the library.');
  const { rows } = await pool.query(
    `SELECT f.id, f.file_name, f.content_type, f.byte_size, f.file_data
       FROM policy_files f JOIN policy_documents d ON d.id = f.document_id
      WHERE f.id = $1 AND ($2::boolean OR (d.retired_at IS NULL AND EXISTS (
            SELECT 1 FROM policy_versions v
             WHERE v.document_id = f.document_id AND v.status <> 'draft' AND f.id = ANY(v.file_ids))))`,
    [fileId, policyRights(user).canManage],
  );
  if (!rows[0]) throw notFound('That file is not in the library.');
  return { ...rows[0], is_picture: isPicture(rows[0].content_type) };
}

// ===== The register =====

/**
 * A document's register entry from a form, checked and tidied. Categories
 * come as `category_ids`, picked from the managed list; `categories` returns
 * their names too, for the audit log.
 */
async function registerFields(db, input) {
  const code = String(input.code ?? '').trim().replace(/\s+/g, ' ');
  const title = String(input.title ?? '').trim().replace(/\s+/g, ' ');
  const docType = String(input.doc_type ?? '');
  const departmentId = input.department_id || null;
  const reviewDue = input.review_due || null;
  const categoryIds = [...new Set(Array.isArray(input.category_ids) ? input.category_ids.map(String) : [])];
  if (!code || code.length > 40) throw badRequest('Give the document a code of up to 40 characters, such as FIN-SOP-001.');
  if (!title || title.length > 200) throw badRequest('Give the document a title of up to 200 characters.');
  if (!TYPE_KEYS.includes(docType)) throw badRequest(`Choose what kind of document it is: ${POLICY_TYPES.map((t) => t.label).join(', ')}.`);
  if (reviewDue && !DATE.test(reviewDue)) throw badRequest('Give the review date as a date.');
  if (departmentId) {
    const { rows } = UUID.test(String(departmentId))
      ? await db.query('SELECT 1 FROM hr_departments WHERE id = $1', [departmentId])
      : { rows: [] };
    if (!rows.length) throw badRequest('Choose the owning department from the list.');
  }
  if (categoryIds.length > 10) throw badRequest('Tag a document with at most ten categories.');
  const { rows: picked } = categoryIds.every((c) => UUID.test(c))
    ? await db.query('SELECT id, name FROM policy_categories WHERE id = ANY($1::uuid[]) ORDER BY lower(name)', [categoryIds])
    : { rows: [] };
  if (picked.length !== categoryIds.length) throw badRequest('Choose categories from the list. One you chose may have just been removed.');
  return {
    code, title, doc_type: docType, department_id: departmentId, review_due: reviewDue,
    category_ids: categoryIds, categories: picked.map((c) => c.name),
  };
}

/** Sets the categories a document is tagged with. */
async function tagCategories(db, documentId, categoryIds) {
  await db.query('DELETE FROM policy_document_categories WHERE document_id = $1 AND NOT (category_id = ANY($2::uuid[]))', [documentId, categoryIds]);
  await db.query(
    `INSERT INTO policy_document_categories (document_id, category_id) SELECT $1, unnest($2::uuid[])
     ON CONFLICT DO NOTHING`, [documentId, categoryIds]);
}

async function refuseTakenCode(db, code, exceptId = null) {
  const { rows } = await db.query(
    'SELECT title FROM policy_documents WHERE lower(btrim(code)) = lower($1) AND ($2::uuid IS NULL OR id <> $2)',
    [code, exceptId],
  );
  if (rows.length) throw conflict(`${code} is already the code of "${rows[0].title}". Choose another.`);
}

/** Registers a document, with an empty first draft ready to write. */
export async function createPolicy(actor, input) {
  const id = await withTransaction(pool, async (client) => {
    const fields = await registerFields(client, input);
    await refuseTakenCode(client, fields.code);
    const { rows: [document] } = await client.query(
      `INSERT INTO policy_documents (code, title, doc_type, department_id, review_due, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [fields.code, fields.title, fields.doc_type, fields.department_id, fields.review_due, actor.id],
    );
    await tagCategories(client, document.id, fields.category_ids);
    await client.query(
      `INSERT INTO policy_versions (document_id, version_no, status, created_by, updated_by)
       VALUES ($1, 1, 'draft', $2, $2)`,
      [document.id, actor.id],
    );
    await recordAudit({ actor, action: 'policy.created', entityType: 'policy_document', entityId: document.id, after: fields, client });
    return document.id;
  });
  return getPolicy(actor, id);
}

/** Changes a document's register entry. */
export async function updatePolicyDetails(actor, id, input) {
  await withTransaction(pool, async (client) => {
    const before = await loadDocument(client, id, { lock: true });
    if (!before) throw notFound('That document is not in the library.');
    const fields = await registerFields(client, input);
    await refuseTakenCode(client, fields.code, id);
    await client.query(
      `UPDATE policy_documents SET code = $2, title = $3, doc_type = $4, department_id = $5,
              review_due = $6, updated_at = NOW() WHERE id = $1`,
      [id, fields.code, fields.title, fields.doc_type, fields.department_id, fields.review_due],
    );
    await tagCategories(client, id, fields.category_ids);
    const kept = {
      ...Object.fromEntries(['code', 'title', 'doc_type', 'department_id', 'review_due'].map((key) => [key, before[key]])),
      category_ids: before.categories.map((c) => c.id),
      categories: before.categories.map((c) => c.name).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    };
    await recordAudit({ actor, action: 'policy.details_updated', entityType: 'policy_document', entityId: id, before: kept, after: fields, client });
  });
  return getPolicy(actor, id);
}

/** Deletes a document that was never published. One that was is withdrawn instead, so its history stays. */
export async function deletePolicy(actor, id) {
  await withTransaction(pool, async (client) => {
    const document = await loadDocument(client, id, { lock: true });
    if (!document) throw notFound('That document is not in the library.');
    if (document.was_published) throw badRequest('This document has been published, so it stays on record. Withdraw it instead.');
    await client.query('DELETE FROM policy_documents WHERE id = $1', [id]);
    await recordAudit({ actor, action: 'policy.deleted', entityType: 'policy_document', entityId: id, before: { code: document.code, title: document.title }, client });
  });
}

// ===== Drafting =====

async function lockChangeable(client, id) {
  const document = await loadDocument(client, id, { lock: true });
  if (!document) throw notFound('That document is not in the library.');
  if (document.retired_at) throw badRequest('This document has been withdrawn. Restore it before changing it.');
  return document;
}

async function lockDraft(client, id) {
  const { rows } = await client.query("SELECT * FROM policy_versions WHERE document_id = $1 AND status = 'draft' FOR UPDATE", [id]);
  return rows[0] || null;
}

/**
 * Removes a document's files that no version uses: pictures from an import
 * that was not kept, or attachments taken out before publishing. Only those a
 * day old, so a file uploaded into a draft that has not been saved yet stays.
 */
async function pruneUnusedFiles(client, documentId) {
  await client.query(
    `DELETE FROM policy_files f
      WHERE f.document_id = $1 AND f.created_at < NOW() - INTERVAL '1 day'
        AND NOT EXISTS (SELECT 1 FROM policy_versions v WHERE v.document_id = f.document_id AND f.id = ANY(v.file_ids))`,
    [documentId],
  );
}

/**
 * Saves the draft, starting one from scratch when there is none. `revision`
 * is the draft revision the editor opened, or null when it opened the
 * published text with no draft yet.
 */
export async function saveDraft(actor, id, { body_html: bodyHtml, change_summary: changeSummary, revision = null }) {
  const html = cleanPolicyHtml(bodyHtml);
  const summary = String(changeSummary ?? '').trim().slice(0, 500) || null;
  await withTransaction(pool, async (client) => {
    await lockChangeable(client, id);
    const { rows: own } = await client.query(
      'SELECT id FROM policy_files WHERE document_id = $1 AND id = ANY($2::uuid[])', [id, referencedFileIds(html)]);
    const fileIds = own.map((row) => row.id);
    const draft = await lockDraft(client, id);
    if (draft) {
      if (revision !== draft.revision) {
        throw conflict('Someone else saved this draft after you opened it. Copy anything you need, then reload to see their changes.');
      }
      await client.query(
        `UPDATE policy_versions SET body_html = $2, body_text = $3, file_ids = $4, change_summary = $5,
                revision = revision + 1, updated_by = $6, updated_at = NOW()
          WHERE id = $1`,
        [draft.id, html, policyText(html), fileIds, summary, actor.id],
      );
      return;
    }
    if (revision !== null) {
      throw conflict('This draft was published or discarded after you opened it. Copy anything you need, then reload to start a new draft.');
    }
    const { rows: [{ next }] } = await client.query(
      'SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM policy_versions WHERE document_id = $1', [id]);
    await client.query(
      `INSERT INTO policy_versions (document_id, version_no, status, body_html, body_text, file_ids, change_summary, created_by, updated_by)
       VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, $7)`,
      [id, next, html, policyText(html), fileIds, summary, actor.id],
    );
    await recordAudit({ actor, action: 'policy.draft_started', entityType: 'policy_document', entityId: id, after: { version_no: next }, client });
  });
  return getPolicy(actor, id);
}

/** Throws the draft away, leaving the published version as it is. */
export async function discardDraft(actor, id, { revision = null } = {}) {
  await withTransaction(pool, async (client) => {
    const document = await lockChangeable(client, id);
    const draft = await lockDraft(client, id);
    if (!draft) throw badRequest('There is no draft to discard.');
    if (!document.is_published) throw badRequest('This document has never been published, so the draft is all there is. Delete the document instead.');
    if (revision !== draft.revision) throw conflict('Someone else saved this draft after you opened it. Reload to see their changes first.');
    await client.query('DELETE FROM policy_versions WHERE id = $1', [draft.id]);
    await pruneUnusedFiles(client, id);
    await recordAudit({ actor, action: 'policy.draft_discarded', entityType: 'policy_document', entityId: id, before: { version_no: draft.version_no }, client });
  });
  return getPolicy(actor, id);
}

/**
 * Puts the draft into force, as the next version number. The version it
 * replaces is kept as superseded. A note on what changed is optional, and so
 * is a review date: `review_due` sets or (as null) clears it, and leaving it
 * out keeps the one the document has.
 */
export async function publishDraft(actor, id, { revision = null, change_summary: changeSummary, review_due: reviewDue }) {
  await withTransaction(pool, async (client) => {
    const document = await lockChangeable(client, id);
    const draft = await lockDraft(client, id);
    if (!draft) throw badRequest('There is no draft to publish.');
    if (revision !== draft.revision) throw conflict('The draft changed after you opened it. Reload and read it again before publishing.');
    if (!draft.body_text && !draft.file_ids.length) throw badRequest('The draft is empty. Write it before publishing.');
    const summary = String(changeSummary ?? draft.change_summary ?? '').trim().slice(0, 500) || null;
    const nextReview = reviewDue === undefined ? document.review_due : reviewDue || null;
    if (nextReview && !DATE.test(String(nextReview))) throw badRequest('Give the next review date as a date.');

    const { rows: replaced } = await client.query(
      `UPDATE policy_versions SET status = 'superseded', superseded_at = NOW()
        WHERE document_id = $1 AND status = 'published' RETURNING version_no`, [id]);
    await client.query(
      `UPDATE policy_versions SET status = 'published', change_summary = $2, published_by = $3, published_at = NOW()
        WHERE id = $1`,
      [draft.id, summary, actor.id],
    );
    await client.query('UPDATE policy_documents SET review_due = $2, updated_at = NOW() WHERE id = $1', [id, nextReview]);
    await pruneUnusedFiles(client, id);
    await recordAudit({
      actor, action: 'policy.published', entityType: 'policy_document', entityId: id,
      after: { version_no: draft.version_no, replaces: replaced[0]?.version_no ?? null, change_summary: summary, review_due: nextReview },
      client,
    });
  });
  return getPolicy(actor, id);
}

/** Takes a document out of the library for readers. Its history is kept, and it can be restored. */
export async function retirePolicy(actor, id, { reason }) {
  const why = String(reason ?? '').trim().slice(0, 500);
  if (!why) throw badRequest('Say why the document is being withdrawn.');
  await withTransaction(pool, async (client) => {
    const document = await loadDocument(client, id, { lock: true });
    if (!document) throw notFound('That document is not in the library.');
    if (document.retired_at) throw badRequest('This document has already been withdrawn.');
    await client.query(
      'UPDATE policy_documents SET retired_at = NOW(), retired_by = $2, retired_reason = $3, updated_at = NOW() WHERE id = $1',
      [id, actor.id, why]);
    await recordAudit({ actor, action: 'policy.withdrawn', entityType: 'policy_document', entityId: id, after: { reason: why }, client });
  });
  return getPolicy(actor, id);
}

/** Puts a withdrawn document back in the library. */
export async function restorePolicy(actor, id) {
  await withTransaction(pool, async (client) => {
    const document = await loadDocument(client, id, { lock: true });
    if (!document) throw notFound('That document is not in the library.');
    if (!document.retired_at) throw badRequest('This document is not withdrawn.');
    await client.query(
      'UPDATE policy_documents SET retired_at = NULL, retired_by = NULL, retired_reason = NULL, updated_at = NOW() WHERE id = $1', [id]);
    await recordAudit({
      actor, action: 'policy.restored', entityType: 'policy_document', entityId: id,
      before: { withdrawn_at: document.retired_at, reason: document.retired_reason }, client,
    });
  });
  return getPolicy(actor, id);
}

// ===== Files =====

async function storeFile(db, documentId, actor, file) {
  const { rows: [row] } = await db.query(
    `INSERT INTO policy_files (document_id, file_name, content_type, byte_size, file_data, checksum, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, file_name, content_type, byte_size`,
    [documentId, file.file_name, file.content_type, file.byte_size, file.file_data, file.checksum, actor.id],
  );
  return fileView(row);
}

/** Stores a file for the draft to show or link to. It reaches readers once a published version uses it. */
export async function addPolicyFile(actor, id, file) {
  return withTransaction(pool, async (client) => {
    await lockChangeable(client, id);
    return storeFile(client, id, actor, file);
  });
}

const PICTURE_ENDINGS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/**
 * A Word document as a policy body, for the editor to show before anyone
 * saves it. Its pictures are stored as the document's files on the way.
 */
export async function importWordDocument(actor, id, file) {
  const document = await loadDocument(pool, id);
  if (!document) throw notFound('That document is not in the library.');
  if (document.retired_at) throw badRequest('This document has been withdrawn. Restore it before changing it.');
  let pictures = 0;
  const savePicture = async ({ data, contentType }) => {
    pictures += 1;
    const stem = file.file_name.replace(/\.[^.]*$/, '');
    const stored = await storeFile(pool, id, actor, {
      file_name: `${stem} picture ${pictures}.${PICTURE_ENDINGS[contentType]}`,
      content_type: contentType,
      byte_size: data.length,
      file_data: data,
      checksum: sha256(data),
    });
    return stored.url;
  };
  try {
    return await wordToPolicyHtml(file.file_data, savePicture);
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    console.warn(`[policies] Word import failed for ${file.file_name}: ${err.message}`);
    throw badRequest(`${file.file_name} could not be read as a Word document. Open it in Word, save it again as .docx, and try once more.`);
  }
}

// ===== Categories =====
//
// The library's structure: manuals (top level) holding sections, two levels
// and no more. Publishers maintain it; editors tag documents from it.

async function loadCategory(db, id, { lock = false } = {}) {
  if (!UUID.test(String(id))) return null;
  const { rows } = await db.query(
    `SELECT c.*,
            (SELECT count(*) FROM policy_categories s WHERE s.parent_id = c.id)::int AS section_count,
            (SELECT count(*) FROM policy_document_categories dc WHERE dc.category_id = c.id)::int AS tagged_count
       FROM policy_categories c WHERE c.id = $1 ${lock ? 'FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0] || null;
}

/** A category's name and place from a form, checked: a section's manual must itself be a manual. */
async function categoryFields(db, input, self = null) {
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80) throw badRequest('Give the category a name of up to 80 characters.');
  const parentId = input.parent_id || null;
  if (parentId) {
    const parent = await loadCategory(db, parentId);
    if (!parent || parent.id === self?.id) throw badRequest('Choose the manual from the list.');
    if (parent.parent_id) throw badRequest(`${parent.name} is itself a section. Sections go inside a manual, two levels at most.`);
    if (self?.section_count) throw badRequest(`${self.name} has sections of its own, so it stays a manual. Move its sections first.`);
  }
  return { name, parent_id: parentId };
}

/** Runs a category write, turning a clash of names into something a person can act on. */
async function uniqueName(name, work) {
  try {
    return await work();
  } catch (err) {
    if (err.code === '23505') throw conflict(`There is already a category called ${name} there.`);
    throw err;
  }
}

export async function createCategory(actor, input) {
  return withTransaction(pool, async (client) => {
    const fields = await categoryFields(client, input);
    const { rows: [created] } = await uniqueName(fields.name, () => client.query(
      `INSERT INTO policy_categories (name, parent_id, sort_order)
       VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM policy_categories
                         WHERE parent_id IS NOT DISTINCT FROM $2::uuid))
       RETURNING id, name, parent_id, sort_order`,
      [fields.name, fields.parent_id]));
    await recordAudit({ actor, action: 'policy.category.created', entityType: 'policy_category', entityId: created.id, after: fields, client });
    return created;
  });
}

/** Renames a category, or moves it: a section to another manual or to the top level, a manual into a manual. */
export async function updateCategory(actor, id, input) {
  return withTransaction(pool, async (client) => {
    const before = await loadCategory(client, id, { lock: true });
    if (!before) throw notFound('That category is not in the list.');
    const fields = await categoryFields(client, input, before);
    const moved = (fields.parent_id ?? null) !== (before.parent_id ?? null);
    const { rows: [updated] } = await uniqueName(fields.name, () => client.query(
      `UPDATE policy_categories SET name = $2, parent_id = $3, updated_at = NOW(),
              sort_order = CASE WHEN $4 THEN (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM policy_categories
                                               WHERE parent_id IS NOT DISTINCT FROM $3::uuid) ELSE sort_order END
        WHERE id = $1 RETURNING id, name, parent_id, sort_order`,
      [id, fields.name, fields.parent_id, moved]));
    await recordAudit({
      actor, action: 'policy.category.updated', entityType: 'policy_category', entityId: id,
      before: { name: before.name, parent_id: before.parent_id }, after: fields, client,
    });
    return updated;
  });
}

/** Moves a category one place up or down among its neighbours. */
export async function moveCategory(actor, id, { direction }) {
  if (!['up', 'down'].includes(direction)) throw badRequest('Move a category up or down.');
  await withTransaction(pool, async (client) => {
    const category = await loadCategory(client, id, { lock: true });
    if (!category) throw notFound('That category is not in the list.');
    const { rows: siblings } = await client.query(
      `SELECT id FROM policy_categories WHERE parent_id IS NOT DISTINCT FROM $1::uuid
        ORDER BY sort_order, lower(name) FOR UPDATE`, [category.parent_id]);
    const order = siblings.map((row) => row.id);
    const at = order.indexOf(category.id);
    const to = direction === 'up' ? at - 1 : at + 1;
    if (to < 0 || to >= order.length) return;
    [order[at], order[to]] = [order[to], order[at]];
    await client.query(
      `UPDATE policy_categories c SET sort_order = o.position
         FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, position) WHERE c.id = o.id`, [order]);
  });
}

/** Removes a category nothing uses. One still holding sections or documents is kept, saying why. */
export async function deleteCategory(actor, id) {
  await withTransaction(pool, async (client) => {
    const category = await loadCategory(client, id, { lock: true });
    if (!category) throw notFound('That category is not in the list.');
    if (category.section_count) {
      throw badRequest(`${category.name} still has ${category.section_count} section${category.section_count === 1 ? '' : 's'}. Move or remove them first.`);
    }
    if (category.tagged_count) {
      throw badRequest(`${category.tagged_count} document${category.tagged_count === 1 ? ' is' : 's are'} still in ${category.name}, withdrawn ones included. Take ${category.tagged_count === 1 ? 'it' : 'them'} out of it, or rename the category instead.`);
    }
    await client.query('DELETE FROM policy_categories WHERE id = $1', [id]);
    await recordAudit({ actor, action: 'policy.category.deleted', entityType: 'policy_category', entityId: id, before: { name: category.name, parent_id: category.parent_id }, client });
  });
}

/**
 * Policies & Procedures: the library every signed-in account reads, and the
 * drafting and publishing behind it.
 *
 * Who may do what:
 * - anyone signed in reads published documents and their earlier versions;
 * - "Write and edit drafts" (policy_edit) registers documents, writes drafts,
 *   adds files and imports Word documents;
 * - "Approve and publish" (policy_publish) puts a draft into force, and
 *   withdraws or restores a document.
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

/** The lists the library's filters and the register form choose from. */
export async function policyMeta(user) {
  const { canEdit, canPublish, canManage } = policyRights(user);
  // Readers are offered only what narrows the documents they can see.
  const visible = canManage ? 'TRUE' : `d.retired_at IS NULL AND EXISTS (
    SELECT 1 FROM policy_versions p WHERE p.document_id = d.id AND p.status = 'published')`;
  const [{ rows: departments }, { rows: categories }] = await Promise.all([
    canManage
      ? pool.query('SELECT id, name FROM hr_departments ORDER BY lower(name)')
      : pool.query(`SELECT DISTINCT dep.id, dep.name FROM policy_documents d
                      JOIN hr_departments dep ON dep.id = d.department_id
                     WHERE ${visible} ORDER BY dep.name`),
    pool.query(`SELECT DISTINCT d.category FROM policy_documents d
                 WHERE d.category IS NOT NULL AND ${visible} ORDER BY d.category`),
  ]);
  return {
    types: POLICY_TYPES,
    departments,
    categories: categories.map((row) => row.category),
    can_edit: canEdit,
    can_publish: canPublish,
  };
}

/**
 * The library, narrowed by any of: words to search for, kind, category and
 * owning department. A search looks through the code, title, category and
 * the published text, and returns a passage from the text around the match,
 * with the matched words between ⟦ and ⟧.
 */
export async function listPolicies(user, { q, type, category, department_id: departmentId } = {}) {
  const { canManage } = policyRights(user);
  const params = [];
  const where = [];
  const add = (value) => { params.push(value); return `$${params.length}`; };
  if (!canManage) where.push('d.retired_at IS NULL', 'p.id IS NOT NULL');
  if (type) where.push(`d.doc_type = ${add(String(type))}`);
  if (category) where.push(`d.category = ${add(String(category))}`);
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
    const text = `to_tsvector('english', d.code || ' ' || d.title || ' ' || coalesce(d.category, '') || ' ' || coalesce(p.body_text, ''))`;
    where.push(`(${text} @@ ${words} OR d.title ILIKE ${like} OR d.code ILIKE ${like})`);
    rank = `ts_rank(${text}, ${words})`;
    snippet = `CASE WHEN coalesce(p.body_text, '') <> '' THEN ts_headline('english', p.body_text, ${words},
      'StartSel=⟦, StopSel=⟧, MaxWords=30, MinWords=12, MaxFragments=1') END`;
  }

  const { rows } = await pool.query(
    `SELECT d.id, d.code, d.title, d.doc_type, d.category, d.department_id, dep.name AS department_name,
            d.review_due, d.review_due < ${TODAY} AS review_overdue, d.retired_at,
            p.version_no AS published_version_no, p.published_at,
            ${canManage ? 'dr.version_no AS draft_version_no, dr.updated_at AS draft_updated_at,' : ''}
            ${rank} AS rank, ${snippet} AS snippet
       FROM policy_documents d
       LEFT JOIN policy_versions p ON p.document_id = d.id AND p.status = 'published'
       LEFT JOIN policy_versions dr ON dr.document_id = d.id AND dr.status = 'draft'
       LEFT JOIN hr_departments dep ON dep.id = d.department_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${search ? 'rank DESC NULLS LAST, ' : ''}lower(d.title)`,
    params,
  );
  return rows.map(({ rank: _rank, ...row }) => row);
}

async function loadDocument(db, id, { lock = false } = {}) {
  if (!UUID.test(String(id))) return null;
  const { rows } = await db.query(
    `SELECT d.*, dep.name AS department_name, d.review_due < ${TODAY} AS review_overdue,
            rb.display_name AS retired_by_name,
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

/** A document's register entry from a form, checked and tidied. */
async function registerFields(db, input) {
  const code = String(input.code ?? '').trim().replace(/\s+/g, ' ');
  const title = String(input.title ?? '').trim().replace(/\s+/g, ' ');
  const docType = String(input.doc_type ?? '');
  const category = String(input.category ?? '').trim().replace(/\s+/g, ' ') || null;
  const departmentId = input.department_id || null;
  const reviewDue = input.review_due || null;
  if (!code || code.length > 40) throw badRequest('Give the document a code of up to 40 characters, such as FIN-SOP-001.');
  if (!title || title.length > 200) throw badRequest('Give the document a title of up to 200 characters.');
  if (!TYPE_KEYS.includes(docType)) throw badRequest(`Choose what kind of document it is: ${POLICY_TYPES.map((t) => t.label).join(', ')}.`);
  if (category && category.length > 80) throw badRequest('Keep the category to 80 characters.');
  if (reviewDue && !DATE.test(reviewDue)) throw badRequest('Give the review date as a date.');
  if (departmentId) {
    const { rows } = UUID.test(String(departmentId))
      ? await db.query('SELECT 1 FROM hr_departments WHERE id = $1', [departmentId])
      : { rows: [] };
    if (!rows.length) throw badRequest('Choose the owning department from the list.');
  }
  return { code, title, doc_type: docType, category, department_id: departmentId, review_due: reviewDue };
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
      `INSERT INTO policy_documents (code, title, doc_type, category, department_id, review_due, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [fields.code, fields.title, fields.doc_type, fields.category, fields.department_id, fields.review_due, actor.id],
    );
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
      `UPDATE policy_documents SET code = $2, title = $3, doc_type = $4, category = $5, department_id = $6,
              review_due = $7, updated_at = NOW() WHERE id = $1`,
      [id, fields.code, fields.title, fields.doc_type, fields.category, fields.department_id, fields.review_due],
    );
    const kept = Object.fromEntries(Object.keys(fields).map((key) => [key, before[key]]));
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
 * Puts the draft into force. The version it replaces is kept as superseded.
 * `review_due`, when given, becomes the document's next review date.
 */
export async function publishDraft(actor, id, { revision = null, change_summary: changeSummary, review_due: reviewDue = null }) {
  await withTransaction(pool, async (client) => {
    await lockChangeable(client, id);
    const draft = await lockDraft(client, id);
    if (!draft) throw badRequest('There is no draft to publish.');
    if (revision !== draft.revision) throw conflict('The draft changed after you opened it. Reload and read it again before publishing.');
    if (!draft.body_text && !draft.file_ids.length) throw badRequest('The draft is empty. Write it before publishing.');
    const summary = String(changeSummary ?? draft.change_summary ?? '').trim().slice(0, 500);
    if (!summary) throw badRequest('Say briefly what this version changes, so readers of the history know.');
    if (reviewDue && !DATE.test(String(reviewDue))) throw badRequest('Give the next review date as a date.');

    const { rows: replaced } = await client.query(
      `UPDATE policy_versions SET status = 'superseded', superseded_at = NOW()
        WHERE document_id = $1 AND status = 'published' RETURNING version_no`, [id]);
    await client.query(
      `UPDATE policy_versions SET status = 'published', change_summary = $2, published_by = $3, published_at = NOW()
        WHERE id = $1`,
      [draft.id, summary, actor.id],
    );
    await client.query(
      'UPDATE policy_documents SET review_due = COALESCE($2::date, review_due), updated_at = NOW() WHERE id = $1',
      [id, reviewDue || null],
    );
    await pruneUnusedFiles(client, id);
    await recordAudit({
      actor, action: 'policy.published', entityType: 'policy_document', entityId: id,
      after: { version_no: draft.version_no, replaces: replaced[0]?.version_no ?? null, change_summary: summary, review_due: reviewDue || null },
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

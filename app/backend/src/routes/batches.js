import express from 'express';
import crypto from 'crypto';
import { body, param, query, handleValidation } from '../middleware/validation.js';
import { pool } from '../db.js';
import { requireAuth } from '../services/authService.js';
import {
  notifyPublicHealthReviewers,
  notifySubmitterOfApproval,
  notifySubmitterOfRejection,
} from '../services/mailService.js';
import { amendValueDate, parseAbaFile } from '../lib/abaFile.js';
import { ServiceError } from '../lib/serviceError.js';
import { findPdConflict } from '../lib/pdNumber.js';
import { buildBlacklistKey, formatBatchCode, lowerEmail, normalizeBsb } from '../utils/helpers.js';
import {
  ADMIN_ARCHIVE_LIMIT_DEFAULT,
  BATCH_WORKFLOW_TYPES,
  REVIEW_ACCESS_ROLES,
  REVIEWER_ARCHIVE_LIMIT_DEFAULT,
  UUID_REGEX,
  workflowStageTransitions,
} from '../config.js';

const router = express.Router();

const ADMIN_ARCHIVE_LIMIT_MAX = 500;
const REVIEWER_ARCHIVE_LIMIT_MAX = 100;

// True when the payload transactions (what reviewers are shown) and the ABA
// file's credit lines (what the bank pays) are the same payments, in any order.
function sameCredits(payloadTransactions, fileCredits) {
  const key = (bsb, account, cents) => `${buildBlacklistKey(bsb, account)}|${cents}`;
  const fromPayload = payloadTransactions
    .map((tx) => key(tx?.bsb, tx?.account, Math.round(Number.parseFloat(String(tx?.amount)) * 100)))
    .sort();
  const fromFile = fileCredits.map((c) => key(c.bsb, c.account, c.cents)).sort();
  return fromPayload.length === fromFile.length && fromPayload.every((k, i) => k === fromFile[i]);
}

// The first credit line paying a blacklisted account or BSB, with its entry.
async function findBlacklistedCredit(fileCredits) {
  const { rows } = await pool.query(
    'SELECT bsb, account, all_accounts, label FROM blacklist_entries WHERE active = TRUE'
  );
  for (const credit of fileCredits) {
    const entry = rows.find((row) => (row.all_accounts
      ? normalizeBsb(row.bsb) === normalizeBsb(credit.bsb)
      : buildBlacklistKey(row.bsb, row.account) === buildBlacklistKey(credit.bsb, credit.account)));
    if (entry) return { credit, entry };
  }
  return null;
}

async function fetchRecentArchives(limit) {
  const requested = Number.isFinite(limit) ? limit : REVIEWER_ARCHIVE_LIMIT_DEFAULT;
  const clamped = Math.max(1, Math.min(requested, ADMIN_ARCHIVE_LIMIT_MAX));
  const { rows } = await pool.query(
    `SELECT code, root_batch_id, department_code, file_name, checksum, transactions, created_at,
      stage, stage_updated_at, pd_number, submitted_email, submitted_by, is_draft
       FROM batch_archives
      ORDER BY created_at DESC
      LIMIT $1`,
    [clamped]
  );
  return rows;
}

async function fetchArchivesPage({ includeHistory = false, limit, offset = 0, search = '' }) {
  const requested = Number.isFinite(limit) ? limit : REVIEWER_ARCHIVE_LIMIT_DEFAULT;
  const clampedLimit = Math.max(1, Math.min(requested, ADMIN_ARCHIVE_LIMIT_MAX));
  const clampedOffset = Math.max(0, Number.isFinite(offset) ? offset : 0);
  const trimmedSearch = String(search || '').trim();
  const params = [clampedLimit, clampedOffset];
  const where = ['deleted_at IS NULL'];
  if (!includeHistory) {
    where.push('from_history = FALSE');
  }
  if (trimmedSearch) {
    params.push(`%${trimmedSearch.toLowerCase()}%`);
    const searchParam = `$${params.length}`;
    where.push(`
      LOWER(CONCAT_WS(' ',
        code,
        pd_number,
        department_code,
        submitted_email,
        stage,
        transactions->>'prepared_by'
      )) LIKE ${searchParam}
    `);
  }
  const whereSql = where.join(' AND ');
  const countWhereSql = trimmedSearch ? whereSql.replace(/\$3/g, '$1') : whereSql;
  const countParams = trimmedSearch ? [params[2]] : [];
  const baseFrom = `FROM combined_batch_archives WHERE ${whereSql}`;
  const [{ rows }, countResult] = await Promise.all([
    pool.query(
      `SELECT code, root_batch_id, department_code, file_name, checksum, transactions, created_at,
              stage, stage_updated_at, pd_number, submitted_email, submitted_by, is_draft,
              archived_at, from_history
         ${baseFrom}
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2`,
      params
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM combined_batch_archives WHERE ${countWhereSql}`, countParams)
  ]);
  const total = Number(countResult.rows[0]?.total || 0);
  return {
    items: rows,
    total,
    limit: clampedLimit,
    offset: clampedOffset,
    hasMore: clampedOffset + rows.length < total,
  };
}

async function fetchAllArchives() {
  const { rows } = await pool.query(
    `SELECT code, root_batch_id, department_code, file_name, checksum, transactions, created_at,
            stage, stage_updated_at, pd_number, submitted_email, submitted_by, is_draft,
            archived_at, from_history
       FROM combined_batch_archives
      ORDER BY created_at DESC`
  );
  return rows;
}

function maskArchivesForRole(rows, isAdmin) {
  if (isAdmin) return rows;
  return rows.map(({ checksum, ...rest }) => rest);
}

async function fetchBatchHistory(rootBatchId) {
  if (!rootBatchId) return [];
  const { rows: relatedBatches } = await pool.query(
    `SELECT batch_id, code, stage, stage_updated_at, created_at, archived_at
       FROM combined_batch_archives
      WHERE root_batch_id = $1
      ORDER BY created_at ASC`,
    [rootBatchId]
  );
  if (!relatedBatches.length) return [];
  const batchIds = relatedBatches.map((row) => row.batch_id);
  const { rows: events } = await pool.query(
    `SELECT id, batch_id, reviewer, status, stage, comments, metadata, actor_id, created_at
       FROM batch_reviews
      WHERE batch_id = ANY($1::uuid[])
      ORDER BY created_at ASC`,
    [batchIds]
  );
  const batchLookup = new Map(relatedBatches.map((row) => [row.batch_id, row]));
  return events.map((event) => {
    const batchMeta = batchLookup.get(event.batch_id) || {};
    return {
      id: event.id,
      batch_id: event.batch_id,
      code: batchMeta.code || null,
      reviewer: event.reviewer,
      status: event.status,
      stage: event.stage || batchMeta.stage || null,
      comments: event.comments,
      metadata: event.metadata,
      actor_id: event.actor_id,
      created_at: event.created_at,
      batch_created_at: batchMeta.created_at || null,
      batch_stage: batchMeta.stage || null,
      batch_stage_updated_at: batchMeta.stage_updated_at || null
    };
  });
}

// ===== Reviews =====
// Review entries are written only by the routes that act on a batch, with the
// signed-in user as the reviewer; there is deliberately no endpoint to post one.
router.get('/reviews', requireAuth(['admin']), async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM batch_reviews ORDER BY created_at DESC LIMIT 100');
  res.json(rows);
});

router.get('/reviews/:batchId', [requireAuth(REVIEW_ACCESS_ROLES), param('batchId').isUUID()], async (req, res) => {
  if (!handleValidation(req, res)) return;
  const { rows } = await pool.query(
    'SELECT * FROM batch_reviews WHERE batch_id = $1 ORDER BY created_at DESC',
    [req.params.batchId]
  );
  res.json(rows);
});

router.get(
  '/pd/:pdNumber',
  requireAuth(),
  [
    param('pdNumber').isString().trim().isLength({ min: 1, max: 50 }),
    query('root_batch_id').optional().isString()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const digitsOnly = req.params.pdNumber.replace(/\D/g, '');
    if (!digitsOnly) {
      res.status(400).json({ message: 'PD number must include digits.' });
      return;
    }

    const rootBatchIdRaw = typeof req.query.root_batch_id === 'string' ? req.query.root_batch_id : null;
    const conflict = await findPdConflict(pool, digitsOnly, UUID_REGEX.test(rootBatchIdRaw || '') ? rootBatchIdRaw : null);
    if (conflict) {
      const conflictLabel = conflict.code ? formatBatchCode(conflict.code) : 'an existing batch';
      const deptLabel = conflict.department_code ? ` for department ${conflict.department_code}` : '';
      const stageLabel = conflict.stage ? ` (currently ${conflict.stage})` : '';
      res.status(409).json({
        message: `PD ${digitsOnly} has already been used on ${conflictLabel}${deptLabel}${stageLabel}.`,
        conflict,
      });
      return;
    }

    res.json({ exists: false });
  }
);

// ===== Batch storage =====
router.post(
  '/batches',
  requireAuth(),
  [
    body('aba_content').isString(),
    body('pd_number').isString().trim().isLength({ min: 1, max: 50 }),
    body('metadata').optional({ nullable: true }),
    body('suggested_file_name').optional({ nullable: true }).isString(),
    body('dept_code').optional({ nullable: true }).matches(/^\d{2}$/),
    body('workflow_type').optional({ nullable: true }).isIn(BATCH_WORKFLOW_TYPES)
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const account = req.user;
    const workflowType = req.body.workflow_type || 'aba';
    const pdNumber = String(req.body.pd_number || '').trim();
    if (!pdNumber) {
      res.status(400).json({ message: 'PD number is required.' });
      return;
    }
    // The stored bytes are what the bank pays, so they are checked here, not
    // only in the browser: the file must add up, its payees must not be
    // blacklisted, and it must match the transactions reviewers are shown.
    const fileData = Buffer.from(req.body.aba_content, 'base64');
    const abaFile = parseAbaFile(fileData);
    const accountDept = account.department_code ? String(account.department_code).trim() : '';
    const fallbackDept = req.body.dept_code ? String(req.body.dept_code).trim() : '';
    const deptCode = accountDept || fallbackDept;
    if (!/^\d{2}$/.test(deptCode)) {
      res.status(400).json({ message: 'Department Head is required for your account.' });
      return;
    }

    const rootBatchIdRaw = req.body.root_batch_id;
    let rootBatchId = null;
    if (rootBatchIdRaw) {
      if (typeof rootBatchIdRaw !== 'string' || !UUID_REGEX.test(rootBatchIdRaw)) {
        res.status(400).json({ message: 'Invalid root batch identifier provided.' });
        return;
      }
      rootBatchId = rootBatchIdRaw;
    }

    const conflict = await findPdConflict(pool, pdNumber, rootBatchId);
    if (conflict) {
      const conflictLabel = conflict.code ? formatBatchCode(conflict.code) : 'an existing batch';
      const deptLabel = conflict.department_code ? ` for department ${conflict.department_code}` : '';
      const stageLabel = conflict.stage ? ` (currently ${conflict.stage})` : '';
      res.status(409).json({
        message: `PD ${pdNumber} has already been used on ${conflictLabel}${deptLabel}${stageLabel}. Please load that batch instead of creating a new submission.`
      });
      return;
    }

    const now = new Date();
    const submittedIso = now.toISOString();
    const datePart = submittedIso.slice(0, 10).replace(/-/g, '');
    const prefix = `${deptCode}-${datePart}`;
    let sequence = 1;
    const { rows: existing } = await pool.query(
      'SELECT code FROM combined_batch_archives WHERE code LIKE $1 ORDER BY code DESC LIMIT 1',
      [`${prefix}%`]
    );
    if (existing.length) {
      const suffix = existing[0].code.slice(prefix.length);
      const parsed = parseInt(suffix, 10);
      if (!Number.isNaN(parsed)) sequence = parsed + 1;
    }

    const fileNameSuggested = req.body.suggested_file_name;
    const metadataInput = req.body.metadata;
    const metadata = (metadataInput && typeof metadataInput === 'object') ? { ...metadataInput } : {};
    const preparedByRaw = typeof metadata.prepared_by === 'string' ? metadata.prepared_by.trim() : '';
    const preparedBy = preparedByRaw || account.display_name || account.email;
    if (!preparedBy) {
      res.status(400).json({ message: 'Prepared by is required.' });
      return;
    }
    metadata.prepared_by = preparedBy;
    metadata.department_code = deptCode;
    metadata.pd_number = pdNumber;
    metadata.submitted_by_email = account.email;
    metadata.submitted_by_role = account.role;
    if (account.display_name) metadata.submitted_by_name = account.display_name;
    metadata.submitted_at = submittedIso;

    const payloadTransactions = Array.isArray(metadata?.payload?.transactions)
      ? metadata.payload.transactions
      : null;
    if (payloadTransactions && !sameCredits(payloadTransactions, abaFile.credits)) {
      res.status(400).json({
        message: 'The transactions in this submission do not match its ABA file. Generate the file again and resubmit.'
      });
      return;
    }
    const blocked = await findBlacklistedCredit(abaFile.credits);
    if (blocked) {
      const labelText = blocked.entry.label ? ` (${blocked.entry.label})` : '';
      res.status(400).json({
        message: `Transactions to ${blocked.credit.bsb}${blocked.entry.all_accounts ? '' : ` / ${blocked.credit.account}`}${labelText} are not permitted.`
      });
      return;
    }
    const checksum = crypto.createHash('sha256').update(fileData).digest('hex');

    const batchId = crypto.randomUUID();
    if (!rootBatchId) rootBatchId = batchId;
    // All workflows land in 'submitted'. Departmental ABA stays there unless a
    // reviewer rejects it; public health batches require explicit approval.
    const initialStage = 'submitted';
    let insertedRow = null;
    for (let attempt = 0; attempt < 5 && !insertedRow; attempt++) {
      const code = `${prefix}${String(sequence).padStart(2, '0')}`;
      const fileName = fileNameSuggested || `ABA_${code}.aba`;
      try {
        const { rows } = await pool.query(
          `INSERT INTO batch_archives (
             batch_id, code, root_batch_id, department_code, file_name, file_path, checksum,
             duplicate_report_path, transactions, workflow_type, file_data, pd_number, submitted_email,
             submitted_by, stage, stage_updated_at, is_draft
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, FALSE)
           RETURNING batch_id, code, root_batch_id, file_name, created_at, department_code, workflow_type, stage, stage_updated_at, pd_number, submitted_email, submitted_by`,
          [
            batchId,
            code,
            rootBatchId,
            deptCode,
            fileName,
            `db://${code}`,
            checksum,
            null,
            metadata,
            workflowType,
            fileData,
            pdNumber,
            account.email,
            account.id,
            initialStage,
            submittedIso
          ]
        );
        insertedRow = rows[0];
      } catch (err) {
        if (err.code === '23505') {
          sequence += 1;
          continue;
        }
        throw err;
      }
    }
    if (!insertedRow) {
      res.status(500).json({ message: 'Unable to generate unique batch code.' });
      return;
    }

    const initialReviewComment = metadata.notes && metadata.notes.trim()
      ? metadata.notes.trim()
      : (initialStage === 'approved' ? 'Batch filed to repository.' : 'Batch submitted for review.');
    await pool.query(
      `INSERT INTO batch_reviews (batch_id, reviewer, status, comments, metadata, actor_id, stage)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        batchId,
        account.display_name || account.email,
        initialStage,
        initialReviewComment,
        { pd_number: pdNumber, department_code: deptCode, workflow_type: workflowType },
        account.id,
        initialStage
      ]
    );

    const savedBatch = { ...insertedRow, metadata };
    // Only public health pay runs notify reviewers on submission. Departmental
    // ABA batches stay 'submitted' without a reviewer email; reviewers reject
    // them from the Repository when needed.
    if (workflowType === 'public_health') {
      notifyPublicHealthReviewers(savedBatch, metadata).catch((err) => {
        console.error('Failed to send public health reviewer notification', err);
      });
    }
    res.status(201).json(savedBatch);
  }
);

router.patch(
  '/batches/:code/stage',
  requireAuth(REVIEW_ACCESS_ROLES),
  [
    param('code').isString().isLength({ min: 1, max: 64 }),
    body('stage').isIn(['approved', 'rejected']),
    body('comments').optional({ nullable: true }).isString().isLength({ max: 4000 }),
    body('notify').optional().isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const code = req.params.code;
    const targetStage = req.body.stage;
    const commentsRaw = typeof req.body.comments === 'string' ? req.body.comments.trim() : '';
  const actor = req.user;
  const notifySubmitter = req.body.notify !== false; // default true unless explicitly false

    const { rows } = await pool.query(
      `SELECT batch_id, code, root_batch_id, department_code, file_name, checksum, created_at, transactions,
        workflow_type, stage, stage_updated_at, pd_number, submitted_email, submitted_by, is_draft
         FROM batch_archives
        WHERE code = $1`,
      [code]
    );
    if (!rows.length) {
      res.status(404).json({ message: 'Batch not found.' });
      return;
    }
    const batch = rows[0];
    const metadata = (batch.transactions && typeof batch.transactions === 'object') ? batch.transactions : {};
    const currentStage = batch.stage;
    // Departmental ABA has no approval step (submitted -> rejected only);
    // public health keeps the full approve/reject gate.
    const baseTransitions = workflowStageTransitions(batch.workflow_type);
    const allowedNext = baseTransitions[currentStage] || [];
    const isOverride = batch.workflow_type === 'public_health'
      && actor?.role === 'admin'
      && currentStage !== 'submitted'
      && targetStage === 'approved';
    if (!allowedNext.includes(targetStage)) {
      res.status(400).json({ message: `Cannot move batch from ${currentStage} to ${targetStage}.` });
      return;
    }
    const isSubmitter = batch.submitted_by
      ? batch.submitted_by === actor.id
      : Boolean(batch.submitted_email) && lowerEmail(batch.submitted_email) === lowerEmail(actor.email);
    if (targetStage === 'approved' && isSubmitter) {
      res.status(403).json({ message: 'You cannot approve a batch you submitted. Another reviewer must approve it.' });
      return;
    }
    const stageUpdatedIso = new Date().toISOString();
    const { rows: updatedRows } = await pool.query(
      `UPDATE batch_archives
          SET stage = $1,
              stage_updated_at = $2
        WHERE code = $3
      RETURNING batch_id, code, root_batch_id, department_code, file_name, checksum, created_at, transactions,
                stage, stage_updated_at, pd_number, submitted_email, submitted_by, is_draft`,
      [targetStage, stageUpdatedIso, code]
    );
    const updated = updatedRows[0];

    await pool.query(
      `INSERT INTO batch_reviews (batch_id, reviewer, status, comments, metadata, actor_id, stage)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        updated.batch_id,
        actor.display_name || actor.email,
        targetStage,
        commentsRaw || null,
        {
          from_stage: currentStage,
          to_stage: targetStage,
          pd_number: updated.pd_number,
          department_code: updated.department_code,
          override_by_admin: isOverride === true,
          notify_submitter: notifySubmitter === true
        },
        actor.id,
        targetStage
      ]
    );

    if (targetStage === 'rejected' && notifySubmitter) {
      notifySubmitterOfRejection(updated, metadata, commentsRaw, actor).catch((err) => {
        console.error('Failed to notify submitter of rejection', err);
      });
    }
    if (targetStage === 'approved') {
      notifySubmitterOfApproval(updated, metadata, commentsRaw, actor).catch((err) => {
        console.error('Failed to notify submitter of approval', err);
      });
    }

    res.json(updated);
  }
);

router.get('/batches/:code', requireAuth(REVIEW_ACCESS_ROLES), async (req, res) => {
  const { code } = req.params;
  const { rows } = await pool.query(
    `SELECT batch_id, code, root_batch_id, department_code, file_name, checksum, created_at, transactions,
            encode(file_data, 'base64') AS file_base64, stage, stage_updated_at, pd_number,
            submitted_email, submitted_by, is_draft, archived_at, workflow_type
       FROM combined_batch_archives
      WHERE code = $1
      ORDER BY archived_at NULLS FIRST, created_at DESC
      LIMIT 1`,
    [code]
  );
  if (!rows.length) {
    res.status(404).json({ message: 'Batch not found.' });
    return;
  }
  const record = rows[0];
  const response = { ...record };
  // Repository semantics: submitted and approved batches are both retrievable.
  if (record.stage === 'approved' || record.stage === 'submitted') {
    response.file_available = true;
  } else {
    response.file_base64 = null;
    response.file_available = false;
  }
  res.json(response);
});

router.patch(
  '/batches/:code/value-date',
  requireAuth(REVIEW_ACCESS_ROLES),
  [
    param('code').isString().trim(),
    body('proc').matches(/^\d{6}$/),
    body('desc').optional({ nullable: true }).isString(),
    body('remitter').optional({ nullable: true }).isString()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const formattedCode = formatBatchCode(req.params.code);
    // Any aba_content the client sends is ignored: the stored file is amended
    // here, so a reviewer can change the date but never the payments.
    const { proc, desc, remitter } = req.body;
    try {
      const { rows } = await pool.query(
        `SELECT batch_id, code, root_batch_id, department_code, file_name, checksum, created_at, transactions,
                stage, stage_updated_at, pd_number, submitted_email, submitted_by, is_draft, file_data
           FROM batch_archives
          WHERE deleted_at IS NULL
            AND code = $1
          LIMIT 1`,
        [formattedCode]
      );
      if (!rows.length) {
        res.status(404).json({ message: 'Batch not found.' });
        return;
      }
      const record = rows[0];
      const stage = (record.stage || '').toLowerCase();
      if (!['submitted', 'approved'].includes(stage)) {
        res.status(400).json({ message: 'Value date adjustments are not allowed for this stage.' });
        return;
      }
      const metadata = (record.transactions && typeof record.transactions === 'object')
        ? { ...record.transactions }
        : {};
      if (!metadata.payload || !metadata.payload.header || !Array.isArray(metadata.payload.transactions)) {
        res.status(400).json({ message: 'Original payload unavailable. Cannot rebuild ABA automatically.' });
        return;
      }
      const fileData = amendValueDate(record.file_data, { proc, desc, remitter });
      metadata.payload = { ...metadata.payload, header: { ...metadata.payload.header, proc } };
      if (typeof desc === 'string') metadata.payload.header.desc = desc;
      if (typeof remitter === 'string') metadata.payload.header.remitter = remitter;
      metadata.value_date_adjustment = {
        proc,
        adjusted_at: new Date().toISOString(),
        adjusted_by: req.user.display_name || req.user.email || `user-${req.user.id}`
      };
      const checksum = crypto.createHash('sha256').update(fileData).digest('hex');
      const { rows: updatedRows } = await pool.query(
        `UPDATE batch_archives
            SET file_data = $1,
                transactions = $2,
                checksum = $3
          WHERE code = $4
          RETURNING batch_id, code, root_batch_id, department_code, file_name, checksum, created_at, transactions,
                    encode(file_data, 'base64') AS file_base64, stage, stage_updated_at, pd_number,
                    submitted_email, submitted_by, is_draft`,
        [fileData, metadata, checksum, formattedCode]
      );
      if (!updatedRows.length) {
        res.status(500).json({ message: 'Failed to update batch value date.' });
        return;
      }
      const updated = updatedRows[0];

      const actorName = req.user.display_name || req.user.email || `user-${req.user.id}`;
      const commentParts = [`Value date set to ${proc}`];
      if (typeof desc === 'string') commentParts.push(`Desc: ${desc || 'blank'}`);
      if (typeof remitter === 'string') commentParts.push(`Remitter: ${remitter || 'blank'}`);
      const adjustmentMetadata = { action: 'value_date_adjustment', proc };
      if (typeof desc === 'string') adjustmentMetadata.desc = desc;
      if (typeof remitter === 'string') adjustmentMetadata.remitter = remitter;
      await pool.query(
        `INSERT INTO batch_reviews (batch_id, reviewer, status, comments, metadata, actor_id, stage)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          record.batch_id,
          actorName,
          record.stage || 'submitted',
          commentParts.join(' · '),
          adjustmentMetadata,
          req.user.id || null,
          record.stage || 'submitted'
        ]
      );

      const response = { ...updated };
      if (updated.stage === 'approved' || updated.stage === 'submitted') {
        response.file_available = true;
      } else {
        response.file_base64 = null;
        response.file_available = false;
      }
      res.json(response);
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      console.error('Failed to adjust value date', err);
      res.status(500).json({ message: 'Unable to adjust value date.' });
    }
  }
);

router.get('/my/batches', requireAuth(), async (req, res) => {
  const userId = req.user.id;
  const userEmail = lowerEmail(req.user.email);
  const limitParam = Number.parseInt(req.query.limit, 10);
  const limit = Number.isNaN(limitParam) ? 200 : Math.max(1, Math.min(limitParam, 500));
  try {
    const { rows } = await pool.query(
      `SELECT code, root_batch_id, department_code, file_name, created_at, stage, stage_updated_at,
              pd_number, submitted_email, submitted_by, is_draft
         FROM batch_archives
        WHERE deleted_at IS NULL
          AND (
                submitted_by = $1
             OR (submitted_by IS NULL AND submitted_email IS NOT NULL AND LOWER(submitted_email) = $2)
          )
        ORDER BY created_at DESC
        LIMIT $3`,
      [userId, userEmail, limit]
    );
    res.json(rows);
  } catch (err) {
    console.error('Failed to load owned batches', err);
    res.status(500).json({ message: 'Failed to load your batches.' });
  }
});

router.get('/my/batches/:code', requireAuth(), async (req, res) => {
  const rawCode = req.params.code;
  const formattedCode = formatBatchCode(rawCode);
  const userId = req.user.id;
  const userEmail = lowerEmail(req.user.email);
  try {
    const { rows } = await pool.query(
      `SELECT batch_id, code, root_batch_id, department_code, file_name, checksum, created_at, transactions,
              encode(file_data, 'base64') AS file_base64, stage, stage_updated_at, pd_number,
              submitted_email, submitted_by, is_draft
         FROM batch_archives
        WHERE deleted_at IS NULL
          AND code = $1
          AND (
                submitted_by = $2
             OR (submitted_by IS NULL AND submitted_email IS NOT NULL AND LOWER(submitted_email) = $3)
          )`,
      [formattedCode, userId, userEmail]
    );
    if (!rows.length) {
      res.status(404).json({ message: 'Batch not found.' });
      return;
    }
    const batch = rows[0];
    const history = await fetchBatchHistory(batch.root_batch_id);
    res.json({ ...batch, history });
  } catch (err) {
    console.error('Failed to load owned batch', err);
    res.status(500).json({ message: 'Failed to load batch details.' });
  }
});

router.delete(
  '/batches/:code',
  [requireAuth(['admin']), param('code').isString().isLength({ min: 1, max: 64 })],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { rowCount } = await pool.query('DELETE FROM batch_archives WHERE code = $1', [req.params.code]);
    if (!rowCount) {
      res.status(404).json({ message: 'Batch not found.' });
      return;
    }
    res.status(204).send();
  }
);

router.get('/archives', requireAuth(REVIEW_ACCESS_ROLES), async (req, res) => {
  const isAdmin = req.user?.role === 'admin';
  const scope = String(req.query.scope || '').toLowerCase();
  const wantAllArchives = scope === 'all';
  const wantsMeta = req.query.meta === '1' || req.query.meta === 'true';
  const limitParam = Number.parseInt(req.query.limit, 10);
  const offsetParam = Number.parseInt(req.query.offset, 10);
  const search = typeof req.query.search === 'string' ? req.query.search : '';
  let limit = isAdmin ? ADMIN_ARCHIVE_LIMIT_DEFAULT : REVIEWER_ARCHIVE_LIMIT_DEFAULT;
  if (!wantAllArchives) {
    if (!Number.isNaN(limitParam)) {
      const upper = isAdmin ? ADMIN_ARCHIVE_LIMIT_MAX : REVIEWER_ARCHIVE_LIMIT_MAX;
      limit = Math.max(1, Math.min(limitParam, upper));
    } else if (!isAdmin && scope === 'recent') {
      limit = REVIEWER_ARCHIVE_LIMIT_DEFAULT;
    }
  }
  try {
    if (wantsMeta) {
      const pageLimit = Number.isNaN(limitParam)
        ? limit
        : Math.max(1, Math.min(limitParam, isAdmin ? ADMIN_ARCHIVE_LIMIT_MAX : REVIEWER_ARCHIVE_LIMIT_MAX));
      const page = await fetchArchivesPage({
        includeHistory: wantAllArchives,
        limit: pageLimit,
        offset: Number.isNaN(offsetParam) ? 0 : offsetParam,
        search,
      });
      res.json({
        ...page,
        items: maskArchivesForRole(page.items, isAdmin),
      });
      return;
    }
    const rows = wantAllArchives ? await fetchAllArchives() : await fetchRecentArchives(limit);
    res.json(maskArchivesForRole(rows, isAdmin));
  } catch (err) {
    console.error('Failed to load archives', err);
    res.status(500).json({ message: 'Failed to load archives.' });
  }
});

router.get('/archives/recent', requireAuth(REVIEW_ACCESS_ROLES), async (req, res) => {
  try {
    const limitParam = Number.parseInt(req.query.limit, 10);
    const limit = Number.isNaN(limitParam)
      ? REVIEWER_ARCHIVE_LIMIT_DEFAULT
      : Math.max(1, Math.min(limitParam, REVIEWER_ARCHIVE_LIMIT_MAX));
    const rows = await fetchRecentArchives(limit);
    res.json(maskArchivesForRole(rows, req.user?.role === 'admin'));
  } catch (err) {
    console.error('Failed to load archives (recent)', err);
    res.status(500).json({ message: 'Failed to load archives.' });
  }
});

export default router;

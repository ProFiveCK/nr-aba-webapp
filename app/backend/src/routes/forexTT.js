import express from 'express';
import { param, body } from '../middleware/validation.js';
import { handleValidation } from '../middleware/validation.js';
import { forexTTUpload, sha256 } from '../middleware/upload.js';
import { pool } from '../db.js';
import { requireAuth, requirePermission } from '../services/authService.js';
import { notifyForexTTReviewers, notifyForexTTSubmitter } from '../services/notificationService.js';
import { generateForexTTPdf } from '../services/pdfService.js';
import { PERMISSIONS, FOREX_TT_STATUSES } from '../config.js';

const router = express.Router();

function generateRequestId() {
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `FXTT-${ts}-${rand}`;
}

function statusTransitions() {
  return {
    draft: ['submitted', 'cancelled'],
    submitted: ['claimed', 'cancelled'],
    claimed: ['processing', 'needs_changes', 'approved', 'cancelled'],
    processing: ['needs_changes', 'approved', 'cancelled'],
    needs_changes: ['submitted', 'cancelled'],
    approved: [],
    cancelled: [],
  };
}

function canTransition(current, target, actor) {
  const allowed = statusTransitions()[current] || [];
  if (allowed.includes(target)) return true;
  if (actor?.role === 'admin' && target !== 'approved') return true;
  return false;
}

function allowedNextStatuses(current, actor) {
  const base = statusTransitions()[current] || [];
  if (actor?.role === 'admin') {
    const all = new Set([...base]);
    FOREX_TT_STATUSES.forEach((s) => { if (s !== current) all.add(s); });
    return Array.from(all);
  }
  return base;
}

async function recordEvent(requestId, actor, status, comments = null, metadata = {}) {
  await pool.query(
    `INSERT INTO forex_tt_reviews (request_id, reviewer, actor_id, status, comments, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [requestId, actor.display_name || actor.email, actor.id, status, comments, metadata]
  );
}

async function loadRequest(code, actor) {
  const { rows } = await pool.query(
    `SELECT id, request_id, root_request_id, submitted_by, department_code, division_code,
            status, version, form_data, bank_confirmation, claimed_by, claimed_at, created_at, updated_at, deleted_at
       FROM forex_tt_requests
      WHERE request_id = $1
        AND deleted_at IS NULL`,
    [code]
  );
  if (!rows.length) return null;
  const r = rows[0];
  const isOwner = r.submitted_by === actor.id;
  const isReviewer = actor.permissions?.review_forex_tt || actor.role === 'admin';
  if (!isOwner && !isReviewer) return null;
  return r;
}

// List all accessible FOREX TT requests (submitter sees own; reviewer/admin sees all)
router.get('/', requireAuth(), async (req, res) => {
  try {
    const canReview = req.user.permissions?.review_forex_tt || req.user.role === 'admin';
    const { rows } = await pool.query(
      `SELECT id, request_id, status, version, department_code, division_code,
              submitted_by, form_data, created_at, updated_at
         FROM forex_tt_requests
        WHERE deleted_at IS NULL
          AND ($1 OR submitted_by = $2)
        ORDER BY updated_at DESC`,
      [canReview, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Failed to load FOREX TT requests', err);
    res.status(500).json({ message: 'Failed to load FOREX TT requests.' });
  }
});

// List my FOREX TT requests
router.get('/my', requireAuth(), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, request_id, status, version, department_code, division_code,
              submitted_by, form_data, created_at, updated_at
         FROM forex_tt_requests
        WHERE submitted_by = $1
          AND deleted_at IS NULL
        ORDER BY updated_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Failed to load my FOREX TT requests', err);
    res.status(500).json({ message: 'Failed to load your FOREX TT requests.' });
  }
});

// List review queue
router.get('/review-queue', requirePermission(PERMISSIONS.REVIEW_FOREX_TT), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.request_id, r.status, r.version, r.department_code, r.division_code,
              r.form_data, r.claimed_by, rv.display_name AS claimed_by_name,
              r.created_at, r.updated_at
         FROM forex_tt_requests r
         LEFT JOIN reviewers rv ON rv.id = r.claimed_by
        WHERE r.status IN ('submitted', 'needs_changes', 'claimed', 'processing')
          AND r.deleted_at IS NULL
        ORDER BY r.updated_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Failed to load FOREX TT review queue', err);
    res.status(500).json({ message: 'Failed to load review queue.' });
  }
});

// Create draft (accepts either flat fields or { form_data } wrapper for compatibility)
router.post(
  '/',
  requireAuth(),
  [body('form_data').optional().isObject()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    try {
      const requestId = generateRequestId();
      const formData = req.body.form_data || req.body;
      const { rows: inserted } = await pool.query(
        `INSERT INTO forex_tt_requests (request_id, submitted_by, department_code, division_code, status, form_data)
         VALUES ($1, $2, $3, $4, 'draft', $5)
         RETURNING id, request_id, submitted_by, department_code, division_code,
                   status, version, form_data, created_at, updated_at`,
        [requestId, req.user.id, req.user.department_code, req.user.division_code, formData]
      );
      res.status(201).json(inserted[0]);
    } catch (err) {
      console.error('Failed to create FOREX TT request', err);
      res.status(500).json({ message: 'Failed to create request.' });
    }
  }
);

// Get single request with attachments + history
router.get('/:requestId', requireAuth(), async (req, res) => {
  try {
    const request = await loadRequest(req.params.requestId, req.user);
    if (!request) {
      res.status(404).json({ message: 'Request not found.' });
      return;
    }
    const [{ rows: attachments }, { rows: history }] = await Promise.all([
      pool.query(
        `SELECT id, category, file_name, checksum, superseded_at, uploaded_by, created_at
           FROM forex_tt_attachments
          WHERE request_id = $1
          ORDER BY category, created_at DESC`,
        [request.id]
      ),
      pool.query(
        `SELECT id, reviewer, status, comments, metadata, created_at
           FROM forex_tt_reviews
          WHERE request_id = $1
          ORDER BY created_at ASC`,
        [request.id]
      ),
    ]);
    res.json({ ...request, attachments, history, allowed_next: allowedNextStatuses(request.status, req.user) });
  } catch (err) {
    console.error('Failed to load FOREX TT request', err);
    res.status(500).json({ message: 'Failed to load request.' });
  }
});

// Convenience submit endpoint (draft / needs_changes → submitted)
router.post(
  '/:requestId/submit',
  requireAuth(),
  async (req, res) => {
    const request = await loadRequest(req.params.requestId, req.user);
    if (!request) {
      res.status(404).json({ message: 'Request not found.' });
      return;
    }
    if (request.submitted_by !== req.user.id) {
      res.status(403).json({ message: 'Only the submitter can submit this request.' });
      return;
    }
    if (!['draft', 'needs_changes'].includes(request.status)) {
      res.status(400).json({ message: 'Only drafts or requests needing changes can be submitted.' });
      return;
    }
    const { rows } = await pool.query(
      `UPDATE forex_tt_requests
          SET status = 'submitted',
              version = version + 1,
              claimed_by = NULL,
              claimed_at = NULL,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, request_id, status, version, form_data, claimed_by, claimed_at, created_at, updated_at`,
      [request.id]
    );
    const updated = rows[0];
    await recordEvent(request.id, req.user, 'submitted', req.body?.comments || null, {
      from_status: request.status,
      to_status: 'submitted',
    });
    notifyForexTTReviewers(updated, req.user).catch((err) => console.error('Failed to notify FOREX TT reviewers', err));
    res.json(updated);
  }
);

// Update draft
router.patch(
  '/:requestId',
  requireAuth(),
  [body('form_data').optional().isObject(), body('version').optional().isInt()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const request = await loadRequest(req.params.requestId, req.user);
    if (!request) {
      res.status(404).json({ message: 'Request not found.' });
      return;
    }
    if (request.submitted_by !== req.user.id) {
      res.status(403).json({ message: 'You can only update your own drafts.' });
      return;
    }
    if (!['draft', 'needs_changes'].includes(request.status)) {
      res.status(400).json({ message: 'Only drafts or requests needing changes can be edited.' });
      return;
    }
    if (req.body.version !== undefined && req.body.version !== request.version) {
      res.status(409).json({ message: 'Request was modified by another user. Please refresh.' });
      return;
    }
    const formData = req.body.form_data ? JSON.stringify(req.body.form_data) : null;
    const { rows } = await pool.query(
      `UPDATE forex_tt_requests
          SET form_data = COALESCE($1, form_data),
              version = version + 1,
              updated_at = NOW()
        WHERE id = $2
        RETURNING id, request_id, submitted_by, department_code, division_code,
            status, version, form_data, created_at, updated_at`,
      [formData, request.id]
    );
    res.json(rows[0]);
  }
);

// Delete an unsubmitted draft owned by the current user.
router.delete('/:requestId', requireAuth(), async (req, res) => {
  try {
    const request = await loadRequest(req.params.requestId, req.user);
    if (!request) {
      res.status(404).json({ message: 'Request not found.' });
      return;
    }
    if (request.submitted_by !== req.user.id) {
      res.status(403).json({ message: 'You can only delete your own drafts.' });
      return;
    }
    if (request.status !== 'draft') {
      res.status(400).json({ message: 'Only unsubmitted drafts can be deleted.' });
      return;
    }

    await pool.query(
      `UPDATE forex_tt_requests
          SET deleted_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [request.id]
    );
    res.status(204).end();
  } catch (err) {
    console.error('Failed to delete FOREX TT draft', err);
    res.status(500).json({ message: 'Failed to delete draft.' });
  }
});

// Upload attachments
router.post(
  '/:requestId/attachments',
  requireAuth(),
  forexTTUpload,
  async (req, res) => {
    try {
      const request = await loadRequest(req.params.requestId, req.user);
      if (!request) {
        res.status(404).json({ message: 'Request not found.' });
        return;
      }
      if (request.submitted_by !== req.user.id) {
        res.status(403).json({ message: 'Only the submitter may upload attachments.' });
        return;
      }
      if (!['draft', 'needs_changes'].includes(request.status)) {
        res.status(400).json({ message: 'Attachments can only be added while drafting or addressing changes.' });
        return;
      }

      const files = req.files || [];
      const category = req.body?.category || 'supporting';
      const inserted = [];
      for (const file of files) {
        const checksum = sha256(file.buffer);
        // Mark previous attachments of the same category as superseded
        await pool.query(
          `UPDATE forex_tt_attachments
              SET superseded_at = NOW()
            WHERE request_id = $1
              AND category = $2
              AND superseded_at IS NULL`,
          [request.id, category]
        );
        const { rows } = await pool.query(
          `INSERT INTO forex_tt_attachments (request_id, category, file_name, file_data, checksum, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, category, file_name, checksum, created_at`,
          [request.id, category, file.originalname, file.buffer, checksum, req.user.id]
        );
        inserted.push(rows[0]);
      }
      res.status(201).json({ attachments: inserted });
    } catch (err) {
      console.error('Failed to upload FOREX TT attachments', err);
      res.status(500).json({ message: err.message || 'Failed to upload attachments.' });
    }
  }
);

// Remove attachment (draft / needs_changes only, submitter only)
router.delete(
  '/:requestId/attachments/:attachmentId',
  requireAuth(),
  async (req, res) => {
    try {
      const request = await loadRequest(req.params.requestId, req.user);
      if (!request) {
        res.status(404).json({ message: 'Request not found.' });
        return;
      }
      if (request.submitted_by !== req.user.id) {
        res.status(403).json({ message: 'Only the submitter may remove attachments.' });
        return;
      }
      if (!['draft', 'needs_changes'].includes(request.status)) {
        res.status(400).json({ message: 'Attachments can only be removed while drafting or addressing changes.' });
        return;
      }
      const { rowCount } = await pool.query(
        `DELETE FROM forex_tt_attachments
          WHERE id = $1
            AND request_id = $2`,
        [req.params.attachmentId, request.id]
      );
      if (rowCount === 0) {
        res.status(404).json({ message: 'Attachment not found.' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      console.error('Failed to remove FOREX TT attachment', err);
      res.status(500).json({ message: 'Failed to remove attachment.' });
    }
  }
);

// Download attachment
router.get('/attachments/:attachmentId', requireAuth(), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.file_name, a.file_data, a.request_id, r.submitted_by
         FROM forex_tt_attachments a
         JOIN forex_tt_requests r ON r.id = a.request_id
        WHERE a.id = $1`,
      [req.params.attachmentId]
    );
    if (!rows.length) {
      res.status(404).json({ message: 'Attachment not found.' });
      return;
    }
    const a = rows[0];
    const isOwner = a.submitted_by === req.user.id;
    const isReviewer = req.user.permissions?.review_forex_tt || req.user.role === 'admin';
    if (!isOwner && !isReviewer) {
      res.status(403).json({ message: 'Forbidden.' });
      return;
    }
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(a.file_name)}"`);
    res.send(a.file_data);
  } catch (err) {
    console.error('Failed to download attachment', err);
    res.status(500).json({ message: 'Failed to download attachment.' });
  }
});

// Generate PDF
router.get('/:requestId/pdf', requireAuth(), async (req, res) => {
  try {
    const request = await loadRequest(req.params.requestId, req.user);
    if (!request) {
      res.status(404).json({ message: 'Request not found.' });
      return;
    }
    const { rows: attachments } = await pool.query(
      `SELECT category, file_name
         FROM forex_tt_attachments
        WHERE request_id = $1
          AND superseded_at IS NULL
        ORDER BY category`,
      [request.id]
    );
    const pdfBytes = await generateForexTTPdf(request, attachments);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(request.request_id)}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('Failed to generate FOREX TT PDF', err);
    res.status(500).json({ message: 'Failed to generate PDF.' });
  }
});

// Transition status (submit / claim / approve / reject / etc)
router.patch(
  '/:requestId/status',
  requireAuth(),
  [
    body('status').isIn(FOREX_TT_STATUSES),
    body('comments').optional({ nullable: true }).isString(),
    body('bank_confirmation').optional({ nullable: true }).isString().isLength({ max: 2000 }),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { status: targetStatus, comments, bank_confirmation: bankConfirmation } = req.body;
    const request = await loadRequest(req.params.requestId, req.user);
    if (!request) {
      res.status(404).json({ message: 'Request not found.' });
      return;
    }
    const isOwner = request.submitted_by === req.user.id;
    const isReviewer = req.user.permissions?.review_forex_tt || req.user.role === 'admin';

    if (targetStatus === 'submitted' && !isOwner) {
      res.status(403).json({ message: 'Only the submitter can submit this request.' });
      return;
    }
    if (['claimed', 'processing', 'approved'].includes(targetStatus) && !isReviewer) {
      res.status(403).json({ message: 'Only FOREX TT reviewers can perform this action.' });
      return;
    }
    if (!canTransition(request.status, targetStatus, req.user)) {
      res.status(400).json({ message: `Cannot move request from ${request.status} to ${targetStatus}.` });
      return;
    }

    const updates = ['status = $1', 'version = version + 1', 'updated_at = NOW()'];
    const values = [targetStatus];
    if (targetStatus === 'claimed') {
      updates.push('claimed_by = $' + (values.length + 1));
      updates.push('claimed_at = NOW()');
      values.push(req.user.id);
    }
    if (targetStatus === 'submitted' || targetStatus === 'needs_changes') {
      updates.push('claimed_by = NULL');
      updates.push('claimed_at = NULL');
    }
    if (targetStatus === 'approved' && bankConfirmation !== undefined) {
      updates.push('bank_confirmation = $' + (values.length + 1));
      values.push(bankConfirmation);
    }
    values.push(request.id);

    const { rows } = await pool.query(
      `UPDATE forex_tt_requests
          SET ${updates.join(', ')}
        WHERE id = $${values.length}
        RETURNING id, request_id, status, version, form_data, bank_confirmation, claimed_by, claimed_at, created_at, updated_at`,
      values
    );
    const updated = rows[0];

    await recordEvent(request.id, req.user, targetStatus, comments, {
      from_status: request.status,
      to_status: targetStatus,
      bank_confirmation: bankConfirmation || null,
    });

    if (targetStatus === 'submitted') {
      notifyForexTTReviewers(updated, req.user).catch((err) => console.error('Failed to notify FOREX TT reviewers', err));
    } else if (targetStatus !== 'claimed' && targetStatus !== 'processing') {
      notifyForexTTSubmitter(updated, targetStatus, comments, req.user).catch((err) => console.error('Failed to notify FOREX TT submitter', err));
    }

    res.json(updated);
  }
);

export default router;

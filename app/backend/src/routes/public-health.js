import express from 'express';
import { body, param } from '../middleware/validation.js';
import { handleValidation } from '../middleware/validation.js';
import { pool } from '../db.js';
import { requirePermission } from '../services/authService.js';
import { encryptSecret, decryptSecret } from '../services/encryption.js';
import { recordAudit } from '../services/auditService.js';
import { PERMISSIONS, PUBLIC_HEALTH_TIERS } from '../config.js';

const router = express.Router();


function tierRank(level) {
  const idx = PUBLIC_HEALTH_TIERS.indexOf(level);
  return idx === -1 ? PUBLIC_HEALTH_TIERS.length : idx;
}

async function getPeriod(id) {
  const { rows } = await pool.query('SELECT * FROM public_health_pay_periods WHERE id = $1', [id]);
  return rows[0] || null;
}

function participantPayload(row) {
  const { bank_account_enc, ...rest } = row;
  return { ...rest, bank_account: decryptSecret(bank_account_enc) };
}

// ===== Tiers =====
router.get('/tiers', requirePermission(PERMISSIONS.PUBLIC_HEALTH_MANAGE), async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM public_health_tiers ORDER BY sort_order');
    res.json(rows);
  } catch (err) {
    console.error('Failed to load public health tiers', err);
    res.status(500).json({ message: 'Failed to load tiers.' });
  }
});

router.put(
  '/tiers/:code',
  requirePermission(PERMISSIONS.PUBLIC_HEALTH_MANAGE),
  [param('code').isIn(PUBLIC_HEALTH_TIERS), body('monthly_amount').isFloat({ min: 0 })],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    try {
      const { rows } = await pool.query(
        `UPDATE public_health_tiers
            SET monthly_amount = $1,
                label = COALESCE($2, label),
                updated_at = NOW()
          WHERE code = $3
          RETURNING *`,
        [req.body.monthly_amount, req.body.label ?? null, req.params.code]
      );
      if (!rows.length) {
        res.status(404).json({ message: 'Tier not found.' });
        return;
      }
      await recordAudit({
        actor: req.user,
        action: 'public_health.tier.updated',
        entityType: 'public_health_tier',
        entityId: req.params.code,
        after: rows[0],
      });
      res.json(rows[0]);
    } catch (err) {
      console.error('Failed to update public health tier', err);
      res.status(500).json({ message: 'Failed to update tier.' });
    }
  }
);

// ===== Participants =====
router.get('/participants', requirePermission(PERMISSIONS.PUBLIC_HEALTH_MANAGE), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, COALESCE(l.level, 'LV1') AS current_level
         FROM public_health_participants p
         LEFT JOIN LATERAL (
           SELECT level
             FROM public_health_participant_levels
            WHERE participant_id = p.id
              AND effective_to IS NULL
            ORDER BY effective_from DESC
            LIMIT 1
         ) l ON TRUE
        WHERE p.status <> 'removed'
        ORDER BY p.full_name`
    );
    res.json(rows.map(participantPayload));
  } catch (err) {
    console.error('Failed to load public health participants', err);
    res.status(500).json({ message: 'Failed to load participants.' });
  }
});

router.post(
  '/participants',
  requirePermission(PERMISSIONS.PUBLIC_HEALTH_MANAGE),
  [
    body('full_name').isString().trim().notEmpty(),
    body('bank_bsb').optional({ nullable: true }).matches(/^\d{3}-\d{3}$/),
    body('bank_account').optional({ nullable: true }).isString(),
    body('bank_account_name').optional({ nullable: true }).isString(),
    body('village').optional({ nullable: true }).isString(),
    body('external_ref').optional({ nullable: true }).isString(),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    try {
      const fullName = String(req.body.full_name).trim();
      const bankAccount = req.body.bank_account ? String(req.body.bank_account).trim() : null;
      const enc = encryptSecret(bankAccount);
      const { rows } = await pool.query(
        `INSERT INTO public_health_participants (full_name, bank_bsb, bank_account_enc, bank_account_name, village, external_ref, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [fullName, req.body.bank_bsb ?? null, enc, req.body.bank_account_name ?? null, req.body.village ?? null, req.body.external_ref ?? null, req.user.id]
      );
      const participant = rows[0];
      await pool.query(
        `INSERT INTO public_health_participant_levels (participant_id, level, reason, created_by)
         VALUES ($1, 'LV1', 'initial', $2)`,
        [participant.id, req.user.id]
      );
      await recordAudit({
        actor: req.user,
        action: 'public_health.participant.created',
        entityType: 'public_health_participant',
        entityId: participant.id,
        after: { ...participant, bank_account: bankAccount },
      });
      res.status(201).json({ ...participantPayload(participant), current_level: 'LV1' });
    } catch (err) {
      console.error('Failed to create public health participant', err);
      res.status(500).json({ message: 'Failed to create participant.' });
    }
  }
);

router.post(
  '/participants/import',
  requirePermission(PERMISSIONS.PUBLIC_HEALTH_MANAGE),
  [body('participants').isArray({ min: 1 })],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    try {
      let created = 0;
      let skipped = 0;
      for (const item of req.body.participants) {
        const fullName = String(item?.full_name || '').trim();
        if (!fullName) {
          skipped += 1;
          continue;
        }
        const externalRef = item?.external_ref ? String(item.external_ref).trim() : null;
        if (externalRef) {
          const { rows: existing } = await pool.query(
            'SELECT id FROM public_health_participants WHERE external_ref = $1',
            [externalRef]
          );
          if (existing.length) {
            skipped += 1;
            continue;
          }
        }
        const enc = encryptSecret(item?.bank_account ? String(item.bank_account).trim() : null);
        const village = item?.village ? String(item.village).trim() : null;
        const { rows } = await pool.query(
          `INSERT INTO public_health_participants (full_name, bank_bsb, bank_account_enc, bank_account_name, village, external_ref, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [fullName, item?.bank_bsb ?? null, enc, item?.bank_account_name ?? null, village, externalRef, req.user.id]
        );
        await pool.query(
          `INSERT INTO public_health_participant_levels (participant_id, level, reason, created_by)
           VALUES ($1, 'LV1', 'import', $2)`,
          [rows[0].id, req.user.id]
        );
        created += 1;
      }
      await recordAudit({
        actor: req.user,
        action: 'public_health.participants.imported',
        entityType: 'public_health_participant',
        metadata: { created, skipped },
      });
      res.status(201).json({ created, skipped });
    } catch (err) {
      console.error('Failed to import public health participants', err);
      res.status(500).json({ message: 'Failed to import participants.' });
    }
  }
);

router.patch(
  '/participants/:id',
  requirePermission(PERMISSIONS.PUBLIC_HEALTH_MANAGE),
  [param('id').isUUID()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    try {
      const { rows } = await pool.query('SELECT * FROM public_health_participants WHERE id = $1', [req.params.id]);
      if (!rows.length) {
        res.status(404).json({ message: 'Participant not found.' });
        return;
      }
      const existing = rows[0];
      const fullName = req.body.full_name !== undefined ? String(req.body.full_name).trim() : existing.full_name;
      const bankBsb = req.body.bank_bsb !== undefined ? req.body.bank_bsb : existing.bank_bsb;
      const bankAccountName = req.body.bank_account_name !== undefined ? req.body.bank_account_name : existing.bank_account_name;
      const village = req.body.village !== undefined ? (req.body.village ? String(req.body.village).trim() : null) : existing.village;
      const status = req.body.status !== undefined ? req.body.status : existing.status;
      let bankAccountEnc = existing.bank_account_enc;
      if (req.body.bank_account !== undefined) {
        bankAccountEnc = encryptSecret(req.body.bank_account ? String(req.body.bank_account).trim() : null);
      }
      const { rows: updated } = await pool.query(
        `UPDATE public_health_participants
            SET full_name = $1,
                bank_bsb = $2,
                bank_account_enc = $3,
                bank_account_name = $4,
                village = $5,
                status = $6,
                updated_at = NOW()
          WHERE id = $7
          RETURNING *`,
        [fullName, bankBsb, bankAccountEnc, bankAccountName, village, status, req.params.id]
      );
      await recordAudit({
        actor: req.user,
        action: 'public_health.participant.updated',
        entityType: 'public_health_participant',
        entityId: req.params.id,
        before: { full_name: existing.full_name, status: existing.status },
        after: { full_name: fullName, status: status },
      });
      res.json(participantPayload(updated[0]));
    } catch (err) {
      console.error('Failed to update public health participant', err);
      res.status(500).json({ message: 'Failed to update participant.' });
    }
  }
);

router.delete(
  '/participants/:id',
  requirePermission(PERMISSIONS.PUBLIC_HEALTH_MANAGE),
  [param('id').isUUID()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    try {
      const { rowCount } = await pool.query(
        `UPDATE public_health_participants SET status = 'inactive', updated_at = NOW() WHERE id = $1`,
        [req.params.id]
      );
      if (!rowCount) {
        res.status(404).json({ message: 'Participant not found.' });
        return;
      }
      await recordAudit({
        actor: req.user,
        action: 'public_health.participant.deactivated',
        entityType: 'public_health_participant',
        entityId: req.params.id,
      });
      res.status(204).end();
    } catch (err) {
      console.error('Failed to deactivate public health participant', err);
      res.status(500).json({ message: 'Failed to deactivate participant.' });
    }
  }
);

router.patch(
  '/participants/:id/level',
  requirePermission(PERMISSIONS.PUBLIC_HEALTH_MANAGE),
  [param('id').isUUID(), body('level').isIn(PUBLIC_HEALTH_TIERS), body('reason').isString().trim().notEmpty()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    try {
      const { rows } = await pool.query('SELECT * FROM public_health_participants WHERE id = $1', [req.params.id]);
      if (!rows.length) {
        res.status(404).json({ message: 'Participant not found.' });
        return;
      }
      const participant = rows[0];
      const { rows: currentRows } = await pool.query(
        `SELECT level
           FROM public_health_participant_levels
          WHERE participant_id = $1
            AND effective_to IS NULL
          ORDER BY effective_from DESC
          LIMIT 1`,
        [participant.id]
      );
      const currentLevel = currentRows[0]?.level || 'LV1';
      const newLevel = req.body.level;
      const reasonText = String(req.body.reason).trim();
      const direction = tierRank(newLevel) > tierRank(currentLevel)
        ? 'promotion'
        : tierRank(newLevel) < tierRank(currentLevel)
          ? 'demotion'
          : 'manual';

      await pool.query(
        `UPDATE public_health_participant_levels
            SET effective_to = NOW()
          WHERE participant_id = $1
            AND effective_to IS NULL`,
        [participant.id]
      );
      await pool.query(
        `INSERT INTO public_health_participant_levels (participant_id, level, reason, notes, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [participant.id, newLevel, direction, reasonText, req.user.id]
      );
      await recordAudit({
        actor: req.user,
        action: 'public_health.participant.level_changed',
        entityType: 'public_health_participant',
        entityId: participant.id,
        before: { level: currentLevel },
        after: { level: newLevel, reason: reasonText },
      });
      res.json({ id: participant.id, current_level: newLevel });
    } catch (err) {
      console.error('Failed to change public health participant level', err);
      res.status(500).json({ message: 'Failed to change level.' });
    }
  }
);

// ===== Pay periods =====
router.get('/pay-periods', requirePermission(PERMISSIONS.PUBLIC_HEALTH_MANAGE), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM public_health_period_entries e WHERE e.period_id = p.id) AS entry_count,
              (SELECT COUNT(*) FROM public_health_period_entries e WHERE e.period_id = p.id AND e.active) AS active_count
         FROM public_health_pay_periods p
        ORDER BY p.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Failed to load public health pay periods', err);
    res.status(500).json({ message: 'Failed to load pay periods.' });
  }
});

router.post(
  '/pay-periods',
  requirePermission(PERMISSIONS.PUBLIC_HEALTH_MANAGE),
  [body('paid_date').isISO8601()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    try {
      const { rows } = await pool.query(
        `INSERT INTO public_health_pay_periods (paid_date, created_by)
         VALUES ($1, $2)
         RETURNING *`,
        [req.body.paid_date, req.user.id]
      );
      const period = rows[0];
      await pool.query(
        `INSERT INTO public_health_period_entries (period_id, participant_id, level, active, amount)
         SELECT $1, p.id, COALESCE(l.level, 'LV1'), (COALESCE(l.level, 'LV1') <> 'LV0'), COALESCE(t.monthly_amount, 0)
           FROM public_health_participants p
           LEFT JOIN LATERAL (
             SELECT level
               FROM public_health_participant_levels
              WHERE participant_id = p.id
                AND effective_to IS NULL
              ORDER BY effective_from DESC
              LIMIT 1
           ) l ON TRUE
           LEFT JOIN public_health_tiers t ON t.code = COALESCE(l.level, 'LV1')
          WHERE p.status = 'active'`,
        [period.id]
      );
      await recordAudit({
        actor: req.user,
        action: 'public_health.period.created',
        entityType: 'public_health_pay_period',
        entityId: period.id,
        after: period,
      });
      res.status(201).json(period);
    } catch (err) {
      console.error('Failed to create public health pay period', err);
      res.status(500).json({ message: 'Failed to create pay period.' });
    }
  }
);

router.get(
  '/pay-periods/:id',
  requirePermission(PERMISSIONS.PUBLIC_HEALTH_MANAGE),
  [param('id').isUUID()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    try {
      const period = await getPeriod(req.params.id);
      if (!period) {
        res.status(404).json({ message: 'Pay period not found.' });
        return;
      }
      const { rows: entries } = await pool.query(
        `SELECT e.id, e.participant_id, e.level, e.active, e.amount, e.is_manual_override,
                p.full_name, p.bank_bsb, p.bank_account_enc, p.bank_account_name, p.village
           FROM public_health_period_entries e
           JOIN public_health_participants p ON p.id = e.participant_id
          WHERE e.period_id = $1
          ORDER BY p.full_name`,
        [period.id]
      );
      res.json({
        ...period,
        entries: entries.map((e) => {
          const { bank_account_enc, ...rest } = e;
          return { ...rest, bank_account: decryptSecret(bank_account_enc) };
        }),
      });
    } catch (err) {
      console.error('Failed to load public health pay period', err);
      res.status(500).json({ message: 'Failed to load pay period.' });
    }
  }
);

router.put(
  '/pay-periods/:id/entries',
  requirePermission(PERMISSIONS.PUBLIC_HEALTH_MANAGE),
  [param('id').isUUID(), body('entries').isArray()],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    try {
      const period = await getPeriod(req.params.id);
      if (!period) {
        res.status(404).json({ message: 'Pay period not found.' });
        return;
      }
      if (period.status !== 'draft') {
        res.status(400).json({ message: 'Only draft periods can be edited.' });
        return;
      }
      const entries = req.body.entries || [];
      let updated = 0;
      for (const e of entries) {
        // LV0 (demoted, no payment) is never activatable — forced inactive.
        const { rowCount } = await pool.query(
          `UPDATE public_health_period_entries
              SET active = CASE WHEN level = 'LV0' THEN FALSE ELSE $1 END,
                  updated_at = NOW()
            WHERE period_id = $2
              AND participant_id = $3`,
          [e?.active === true, period.id, e?.participant_id]
        );
        updated += rowCount;
      }
      await recordAudit({
        actor: req.user,
        action: 'public_health.period.entries_updated',
        entityType: 'public_health_pay_period',
        entityId: period.id,
        metadata: { updated },
      });
      res.json({ updated });
    } catch (err) {
      console.error('Failed to update public health period entries', err);
      res.status(500).json({ message: 'Failed to update entries.' });
    }
  }
);

router.patch(
  '/pay-periods/:id/status',
  requirePermission(PERMISSIONS.PUBLIC_HEALTH_MANAGE),
  [param('id').isUUID(), body('status').isIn(['draft', 'submitted'])],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    try {
      const period = await getPeriod(req.params.id);
      if (!period) {
        res.status(404).json({ message: 'Pay period not found.' });
        return;
      }
      const { rows } = await pool.query(
        `UPDATE public_health_pay_periods SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [req.body.status, period.id]
      );
      await recordAudit({
        actor: req.user,
        action: 'public_health.period.status_changed',
        entityType: 'public_health_pay_period',
        entityId: period.id,
        before: { status: period.status },
        after: { status: req.body.status },
      });
      res.json(rows[0]);
    } catch (err) {
      console.error('Failed to update public health pay period status', err);
      res.status(500).json({ message: 'Failed to update pay period status.' });
    }
  }
);

// ===== Review (treasury) =====
router.get('/review', requirePermission(PERMISSIONS.PUBLIC_HEALTH_REVIEW), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT batch_id, code, root_batch_id, department_code, file_name, pd_number,
              stage, stage_updated_at, submitted_email, created_at, transactions
         FROM batch_archives
        WHERE workflow_type = 'public_health'
          AND deleted_at IS NULL
        ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Failed to load public health review queue', err);
    res.status(500).json({ message: 'Failed to load review queue.' });
  }
});

export default router;

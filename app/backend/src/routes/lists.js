import express from 'express';
import { body, param, handleValidation } from '../middleware/validation.js';
import { pool } from '../db.js';
import { requireAuth } from '../services/authService.js';
import { actorFrom, recordAudit } from '../services/auditService.js';
import {
  normalizeAccountNumber,
  normalizeBsb,
} from '../utils/helpers.js';
import { BSB_REGEX } from '../config.js';

const router = express.Router();

// Every change to these lists is a change to what may be paid, so each one is audited.
const audit = (req, action, entityType, entityId, record = {}) =>
  recordAudit({ actor: actorFrom(req), action, entityType, entityId, ...record });

const BLACKLIST_IMPORT_LIMIT = 1000;

// ===== Blacklist =====
router.get('/blacklist', requireAuth(['admin']), async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM blacklist_entries ORDER BY bsb ASC, account ASC');
  res.json(rows);
});

router.get('/blacklist/active', requireAuth(), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT bsb, account, all_accounts, label FROM blacklist_entries
      WHERE active = TRUE
      ORDER BY bsb ASC, account ASC`
  );
  res.json(rows);
});

router.post(
  '/blacklist',
  requireAuth(['admin']),
  [
    body('bsb').matches(BSB_REGEX),
    body('account').custom((value, { req }) => {
      if (req.body.all_accounts === true) return true;
      if (/^\d{5,16}$/.test(String(value ?? ''))) return true;
      throw new Error('Account number must be 5-16 digits.');
    }),
    body('all_accounts').optional({ nullable: true }).isBoolean(),
    body('label').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body('notes').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('active').optional({ nullable: true }).isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const bsb = normalizeBsb(req.body.bsb);
    const allAccounts = !!req.body.all_accounts;
    const account = allAccounts ? null : normalizeAccountNumber(req.body.account);
    const label = req.body.label ? String(req.body.label).trim() : null;
    const notes = req.body.notes ? String(req.body.notes).trim() : null;
    const active = req.body.active === undefined ? true : !!req.body.active;
    if (!bsb || (!allAccounts && !account)) {
      res.status(400).json({ message: 'Provide a valid BSB and account number, or block all accounts at a BSB.' });
      return;
    }
    try {
      const query = allAccounts
        ? `INSERT INTO blacklist_entries (bsb, account, all_accounts, label, notes, active)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (bsb) WHERE all_accounts = TRUE
           DO UPDATE SET label = EXCLUDED.label, notes = EXCLUDED.notes, active = EXCLUDED.active, updated_at = NOW()
           RETURNING *`
        : `INSERT INTO blacklist_entries (bsb, account, all_accounts, label, notes, active)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (bsb, account)
           DO UPDATE SET all_accounts = EXCLUDED.all_accounts, label = EXCLUDED.label, notes = EXCLUDED.notes, active = EXCLUDED.active, updated_at = NOW()
           RETURNING *`;
      const { rows } = await pool.query(
        query,
        [bsb, account, allAccounts, label, notes, active]
      );
      await audit(req, 'blacklist.create', 'blacklist_entry', rows[0].id, { after: rows[0] });
      res.status(201).json(rows[0]);
    } catch (err) {
      console.error('Failed to upsert blacklist entry', err);
      res.status(500).json({ message: 'Unable to store blacklist entry.' });
    }
  }
);

router.post(
  '/blacklist/import',
  requireAuth(['admin']),
  [
    body('entries').isArray({ min: 1, max: BLACKLIST_IMPORT_LIMIT })
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const rawEntries = Array.isArray(req.body.entries) ? req.body.entries : [];
    const invalid = [];
    const validEntries = [];
    const parseActive = (value) => {
      if (value === undefined || value === null || value === '') return true;
      const lowered = String(value).trim().toLowerCase();
      if (!lowered) return true;
      if (['true', 't', '1', 'yes', 'y', 'active'].includes(lowered)) return true;
      if (['false', 'f', '0', 'no', 'n', 'inactive'].includes(lowered)) return false;
      return null;
    };
    rawEntries.forEach((entry, idx) => {
      const rowNumberCandidate = Number(entry?.rowNumber ?? entry?.row_number);
      const rowNumber = Number.isFinite(rowNumberCandidate) && rowNumberCandidate > 0 ? Math.floor(rowNumberCandidate) : idx + 1;
      if (!entry || typeof entry !== 'object') {
        invalid.push({ index: rowNumber, message: 'Row is empty or invalid.' });
        return;
      }
      const bsb = normalizeBsb(entry.bsb);
      const account = normalizeAccountNumber(entry.account);
      const labelRaw = entry.label === undefined || entry.label === null ? null : String(entry.label).trim();
      const notesRaw = entry.notes === undefined || entry.notes === null ? null : String(entry.notes).trim();
      const activeParsed = parseActive(entry.active);
      if (!bsb) {
        invalid.push({ index: rowNumber, message: 'Invalid BSB. Use NNN-NNN.' });
        return;
      }
      if (!account || account.length < 5 || account.length > 16) {
        invalid.push({ index: rowNumber, message: 'Account number must be 5-16 digits.' });
        return;
      }
      if (labelRaw && labelRaw.length > 200) {
        invalid.push({ index: rowNumber, message: 'Label exceeds 200 characters.' });
        return;
      }
      if (notesRaw && notesRaw.length > 2000) {
        invalid.push({ index: rowNumber, message: 'Notes exceed 2000 characters.' });
        return;
      }
      if (activeParsed === null) {
        invalid.push({ index: rowNumber, message: 'Active flag must be yes/no or true/false.' });
        return;
      }
      validEntries.push({
        rowNumber,
        bsb,
        account,
        label: labelRaw || null,
        notes: notesRaw || null,
        active: activeParsed
      });
    });
    if (!validEntries.length) {
      res.status(400).json({ message: 'No valid entries to import.', errors: invalid });
      return;
    }
    const client = await pool.connect();
    const stats = { inserted: 0, updated: 0 };
    try {
      await client.query('BEGIN');
      for (const entry of validEntries) {
        try {
          const { rows } = await client.query(
            `INSERT INTO blacklist_entries (bsb, account, label, notes, active)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (bsb, account)
             DO UPDATE SET label = EXCLUDED.label, notes = EXCLUDED.notes, active = EXCLUDED.active, updated_at = NOW()
             RETURNING (xmax = 0)::boolean AS inserted` ,
            [entry.bsb, entry.account, entry.label, entry.notes, entry.active]
          );
          if (rows[0]?.inserted) stats.inserted += 1;
          else stats.updated += 1;
        } catch (err) {
          console.error('Import blacklist row failed', err);
          invalid.push({ index: entry.rowNumber, message: 'Database error while importing row.' });
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Failed to import blacklist entries', err);
      res.status(500).json({ message: 'Unable to import blacklist entries.' });
      return;
    } finally {
      client.release();
    }
    await audit(req, 'blacklist.import', 'blacklist_entry', null, {
      metadata: { inserted: stats.inserted, updated: stats.updated, skipped: invalid.length },
    });
    res.status(201).json({
      inserted: stats.inserted,
      updated: stats.updated,
      skipped: invalid.length,
      errors: invalid
    });
  }
);

router.put(
  '/blacklist/:id',
  requireAuth(['admin']),
  [
    param('id').isInt({ gt: 0 }),
    body('bsb').optional().matches(BSB_REGEX),
    body('account').optional().matches(/^\d{5,16}$/),
    body('all_accounts').optional().isBoolean(),
    body('label').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body('notes').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('active').optional({ nullable: true }).isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const id = Number(req.params.id);
    // Explicit allowlist prevents mass assignment of columns like id/created_at.
    const patch = {};
    const allowedFields = ['bsb', 'account', 'all_accounts', 'label', 'notes', 'active'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        patch[field] = req.body[field];
      }
    }
    if (patch.bsb !== undefined) {
      const normalized = normalizeBsb(patch.bsb);
      if (!normalized) {
        res.status(400).json({ message: 'BSB must be formatted as NNN-NNN.' });
        return;
      }
      patch.bsb = normalized;
    }
    if (patch.account !== undefined) {
      const normalized = normalizeAccountNumber(patch.account);
      if (!normalized) {
        res.status(400).json({ message: 'Account number is required.' });
        return;
      }
      patch.account = normalized;
    }
    if (patch.all_accounts !== undefined) {
      patch.all_accounts = !!patch.all_accounts;
      if (patch.all_accounts) patch.account = null;
    }
    if (patch.label !== undefined) patch.label = patch.label === null ? null : String(patch.label).trim();
    if (patch.notes !== undefined) patch.notes = patch.notes === null ? null : String(patch.notes).trim();
    if (patch.active !== undefined) patch.active = !!patch.active;
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (!entries.length) {
      res.status(400).json({ message: 'No fields to update.' });
      return;
    }
    const fields = entries.map(([key], idx) => `${key} = $${idx + 1}`);
    const values = entries.map(([, value]) => value);
    fields.push(`updated_at = NOW()`);
    values.push(id);
    const { rows: [before] } = await pool.query('SELECT * FROM blacklist_entries WHERE id = $1', [id]);
    try {
      const { rows } = await pool.query(
        `UPDATE blacklist_entries SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
        values
      );
      if (!rows.length) {
        res.status(404).json({ message: 'Blacklist entry not found.' });
        return;
      }
      await audit(req, 'blacklist.update', 'blacklist_entry', id, { before, after: rows[0] });
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        res.status(409).json({ message: 'A blacklist entry for this BSB/account already exists.' });
        return;
      }
      console.error('Failed to update blacklist entry', err);
      res.status(500).json({ message: 'Unable to update blacklist entry.' });
    }
  }
);

router.delete('/blacklist/:id', [requireAuth(['admin']), param('id').isInt({ gt: 0 })], async (req, res) => {
  if (!handleValidation(req, res)) return;
  const id = Number(req.params.id);
  try {
    const { rows: deleted } = await pool.query('DELETE FROM blacklist_entries WHERE id = $1 RETURNING *', [id]);
    if (!deleted.length) {
      res.status(404).json({ message: 'Blacklist entry not found.' });
      return;
    }
    await audit(req, 'blacklist.delete', 'blacklist_entry', id, { before: deleted[0] });
    res.status(204).send();
  } catch (err) {
    console.error('Failed to delete blacklist entry', err);
    res.status(500).json({ message: 'Unable to delete blacklist entry.' });
  }
});

export default router;

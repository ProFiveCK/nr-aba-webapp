import express from 'express';
import { body, param, handleValidation } from '../middleware/validation.js';
import { pool } from '../db.js';
import { requireAuth } from '../services/authService.js';
import {
  normalizeAccountNumber,
  normalizeAccountNumber as normalizeSupplierAccount,
  normalizeBsb,
  normalizeBsb as normalizeSupplierBsb,
} from '../utils/helpers.js';
import { BSB_REGEX, REVIEW_ACCESS_ROLES } from '../config.js';

const router = express.Router();

const BLACKLIST_IMPORT_LIMIT = 1000;

// ===== Sanity thresholds =====
router.get('/thresholds', requireAuth(REVIEW_ACCESS_ROLES), async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM sanity_thresholds ORDER BY created_at DESC');
  res.json(rows);
});

router.post(
  '/thresholds',
  requireAuth(['admin']),
  [
    body('name').isString().trim().notEmpty(),
    body('amount_limit').isFloat({ gt: 0 }),
    body('per_account_daily_limit').optional({ nullable: true }).isInt({ gt: 0 }),
    body('currency').optional({ nullable: true }).isString().isLength({ min: 3, max: 3 }),
    body('description').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('active').optional({ nullable: true }).isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { name, description, currency = 'AUD', amount_limit, per_account_daily_limit, active } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO sanity_thresholds (name, description, currency, amount_limit, per_account_daily_limit, active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, description ?? null, currency.toUpperCase(), amount_limit, per_account_daily_limit ?? null, active !== undefined ? active : false]
    );
    res.status(201).json(rows[0]);
  }
);

router.put(
  '/thresholds/:id',
  requireAuth(['admin']),
  [
    param('id').isInt({ gt: 0 }),
    body('name').optional().isString().trim().notEmpty(),
    body('description').optional({ nullable: true }).isString(),
    body('currency').optional({ nullable: true }).isString().isLength({ min: 3, max: 3 }),
    body('amount_limit').optional().isFloat({ gt: 0 }),
    body('per_account_daily_limit').optional({ nullable: true }).isInt({ gt: 0 }),
    body('active').optional({ nullable: true }).isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const id = Number(req.params.id);
    // Explicit allowlist prevents mass assignment of columns like id/created_at.
    const patch = {};
    const allowedFields = ['name', 'description', 'currency', 'amount_limit', 'per_account_daily_limit', 'active'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        patch[field] = req.body[field];
      }
    }
    if (patch.active !== undefined) patch.active = !!patch.active;
    const fields = [];
    const values = [];
    Object.entries(patch).forEach(([key, value], idx) => {
      if (value === undefined) return;
      fields.push(`${key} = $${idx + 1}`);
      values.push(key === 'currency' ? value.toUpperCase() : value);
    });
    if (!fields.length) {
      res.status(400).json({ message: 'No fields to update.' });
      return;
    }
    fields.push(`updated_at = NOW()`);
    const query = `UPDATE sanity_thresholds SET ${fields.join(', ')} WHERE id = $${values.length + 1} RETURNING *`;
    values.push(id);
    const { rows } = await pool.query(query, values);
    if (!rows.length) {
      res.status(404).json({ message: 'Threshold not found.' });
      return;
    }
    res.json(rows[0]);
  }
);

router.delete('/thresholds/:id', [requireAuth(['admin']), param('id').isInt({ gt: 0 })], async (req, res) => {
  if (!handleValidation(req, res)) return;
  const id = Number(req.params.id);
  const { rowCount } = await pool.query('DELETE FROM sanity_thresholds WHERE id = $1', [id]);
  if (!rowCount) {
    res.status(404).json({ message: 'Threshold not found.' });
    return;
  }
  res.status(204).send();
});

// ===== Whitelist =====
router.get('/whitelist', requireAuth(REVIEW_ACCESS_ROLES), async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM whitelist_entries ORDER BY alias ASC');
  res.json(rows);
});

router.post(
  '/whitelist',
  requireAuth(['admin']),
  [
    body('bsb').matches(/^[0-9]{3}-[0-9]{3}$/),
    body('account').isLength({ min: 5, max: 16 }),
    body('alias').isString().trim().notEmpty(),
    body('notes').optional({ nullable: true }).isString(),
    body('active').optional({ nullable: true }).isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { bsb, account, alias, notes, active } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO whitelist_entries (bsb, account, alias, notes, active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (bsb, account) DO UPDATE SET alias = EXCLUDED.alias, notes = EXCLUDED.notes, active = EXCLUDED.active, updated_at = NOW()
       RETURNING *`,
      [bsb, account, alias, notes ?? null, active !== undefined ? active : false]
    );
    res.status(201).json(rows[0]);
  }
);

router.put(
  '/whitelist/:id',
  requireAuth(['admin']),
  [
    param('id').isInt({ gt: 0 }),
    body('alias').optional().isString().trim().notEmpty(),
    body('notes').optional({ nullable: true }).isString(),
    body('active').optional({ nullable: true }).isBoolean()
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const id = Number(req.params.id);
    // Explicit allowlist prevents mass assignment of columns like id/created_at.
    const patch = {};
    const allowedFields = ['alias', 'notes', 'active'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        patch[field] = req.body[field];
      }
    }
    if (patch.active !== undefined) patch.active = !!patch.active;
    const fields = [];
    const values = [];
    Object.entries(patch).forEach(([key, value], idx) => {
      if (value === undefined) return;
      fields.push(`${key} = $${idx + 1}`);
      values.push(value);
    });
    if (!fields.length) {
      res.status(400).json({ message: 'No fields to update.' });
      return;
    }
    fields.push('updated_at = NOW()');
    const query = `UPDATE whitelist_entries SET ${fields.join(', ')} WHERE id = $${values.length + 1} RETURNING *`;
    values.push(id);
    const { rows } = await pool.query(query, values);
    if (!rows.length) {
      res.status(404).json({ message: 'Whitelist entry not found.' });
      return;
    }
    res.json(rows[0]);
  }
);

router.delete('/whitelist/:id', [requireAuth(['admin']), param('id').isInt({ gt: 0 })], async (req, res) => {
  if (!handleValidation(req, res)) return;
  const id = Number(req.params.id);
  const { rowCount } = await pool.query('DELETE FROM whitelist_entries WHERE id = $1', [id]);
  if (!rowCount) {
    res.status(404).json({ message: 'Whitelist entry not found.' });
    return;
  }
  res.status(204).send();
});

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
    try {
      const { rows } = await pool.query(
        `UPDATE blacklist_entries SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
        values
      );
      if (!rows.length) {
        res.status(404).json({ message: 'Blacklist entry not found.' });
        return;
      }
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
    const { rowCount } = await pool.query('DELETE FROM blacklist_entries WHERE id = $1', [id]);
    if (!rowCount) {
      res.status(404).json({ message: 'Blacklist entry not found.' });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error('Failed to delete blacklist entry', err);
    res.status(500).json({ message: 'Unable to delete blacklist entry.' });
  }
});

// ===== Suppliers =====
const SUPPLIER_MANAGE_ROLES = ['banking', 'reviewer', 'admin'];
const SUPPLIER_STATUS_VALUES = ['blocked', 'enabled', 'removed'];

function supplierNeedsCbaBankAccount(row) {
  return row.status !== 'enabled';
}

function mapSupplierRow(row) {
  return {
    ...row,
    need_cba_bank_account: supplierNeedsCbaBankAccount(row),
  };
}

router.get('/suppliers', requireAuth(), async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const conditions = [];
    const values = [];

    if (search) {
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
      conditions.push(`(supplier_id ILIKE $${values.length - 2} OR description ILIKE $${values.length - 1} OR email ILIKE $${values.length})`);
    }

    if (SUPPLIER_STATUS_VALUES.includes(status)) {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countValues = values.slice();
    const countQuery = `SELECT COUNT(*)::int AS total FROM suppliers ${whereClause}`;
    const dataQuery = `
      SELECT id, supplier_id, description, email, bsb, account, account_name, need_cba_bank_account, status, notes, created_at, updated_at
      FROM suppliers
      ${whereClause}
      ORDER BY description ASC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `;

    const dataValues = [...values, limit, offset];
    const [countResult, dataResult] = await Promise.all([
      pool.query(countQuery, countValues),
      pool.query(dataQuery, dataValues),
    ]);

    res.json({
      items: (dataResult.rows || []).map(mapSupplierRow),
      total: countResult.rows[0]?.total || 0,
      limit,
      offset,
      hasMore: offset + dataResult.rows.length < (countResult.rows[0]?.total || 0),
    });
  } catch (err) {
    console.error('Failed to load suppliers', err);
    res.status(500).json({ message: 'Unable to load suppliers.' });
  }
});

router.get('/suppliers/:id', [requireAuth(), param('id').isInt({ gt: 0 })], async (req, res) => {
  if (!handleValidation(req, res)) return;
  const id = Number(req.params.id);
  try {
    const { rows } = await pool.query(
      `SELECT id, supplier_id, description, email, bsb, account, account_name, need_cba_bank_account, status, notes, created_at, updated_at
       FROM suppliers WHERE id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ message: 'Supplier not found.' });
      return;
    }
    res.json(mapSupplierRow(rows[0]));
  } catch (err) {
    console.error('Failed to load supplier', err);
    res.status(500).json({ message: 'Unable to load supplier.' });
  }
});

router.patch(
  '/suppliers/:id',
  [
    requireAuth(SUPPLIER_MANAGE_ROLES),
    param('id').isInt({ gt: 0 }),
    body('status').optional().isIn(SUPPLIER_STATUS_VALUES),
    body('notes').optional().isString().isLength({ max: 1000 }),
    body('need_cba_bank_account').optional().isBoolean(),
    body('bsb').optional().isString().trim().isLength({ min: 6, max: 7 }),
    body('account').optional().isString().trim().isLength({ min: 5, max: 16 }),
    body('account_name').optional().isString().trim().isLength({ min: 1, max: 200 }),
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const id = Number(req.params.id);
    const updates = {};
    const allowedFields = ['status', 'notes', 'need_cba_bank_account', 'account_name'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (req.body.bsb !== undefined) {
      const normalized = normalizeSupplierBsb(req.body.bsb);
      if (!normalized) {
        res.status(400).json({ message: 'BSB must be 6 digits (e.g. 062-000).' });
        return;
      }
      updates.bsb = normalized;
    }
    if (req.body.account !== undefined) {
      const normalized = normalizeSupplierAccount(req.body.account);
      if (!normalized || normalized.length < 5 || normalized.length > 16) {
        res.status(400).json({ message: 'Account number must be 5-16 digits.' });
        return;
      }
      updates.account = normalized;
    }

    if (!Object.keys(updates).length) {
      res.status(400).json({ message: 'No fields provided to update.' });
      return;
    }

    // When a supplier is enabled we treat the CBA bank account requirement as resolved.
    if (updates.status === 'enabled') {
      updates.need_cba_bank_account = false;
    } else if (updates.status === 'blocked') {
      updates.need_cba_bank_account = true;
    }

    updates.updated_at = new Date().toISOString();
    const fields = Object.keys(updates).map((key, index) => `${key} = $${index + 2}`);
    const values = [id, ...Object.values(updates)];

    try {
      const { rows } = await pool.query(
        `UPDATE suppliers SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
        values
      );
      if (!rows.length) {
        res.status(404).json({ message: 'Supplier not found.' });
        return;
      }
      res.json(mapSupplierRow(rows[0]));
    } catch (err) {
      console.error('Failed to update supplier', err);
      res.status(500).json({ message: 'Unable to update supplier.' });
    }
  }
);

export default router;

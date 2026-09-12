import express from 'express';
import { param, body } from '../middleware/validation.js';
import { handleValidation } from '../middleware/validation.js';
import { pool } from '../db.js';
import { requireAuth } from '../services/authService.js';
import { FOREX_TT_STATUSES } from '../config.js';

const router = express.Router();

// Health check
router.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Keep-alive placeholder for future lightweight ping endpoint
router.get('/ping', (_req, res) => res.json({ ok: true }));

export default router;

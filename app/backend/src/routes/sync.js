import express from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { body, handleValidation } from '../middleware/validation.js';
import { pool } from '../db.js';
import {
  hashPassphrase,
  isLegacyPassphraseHash,
  legacyHashPassphrase,
  requireAuth,
} from '../services/authService.js';

const router = express.Router();

// SFTP Sync Configuration
const SFTP_SYNC_METHOD = process.env.SFTP_SYNC_METHOD || 'database'; // 'direct', 'file', or 'database'
// Default to host.docker.internal for Docker containers (Windows/Mac), fallback to localhost for Linux native
const WINDOWS_SYNC_URL = process.env.WINDOWS_SYNC_URL || 'http://host.docker.internal:8088/sync-trigger';
const SYNC_TRIGGER_PATH = process.env.SYNC_TRIGGER_PATH || null; // For file-based approach
const SYNC_TIMEOUT = Number(process.env.SYNC_TIMEOUT || 30000); // 30 seconds

// File handling: ABA files are uploaded as base64 JSON payloads; FOREX TT uses multipart.
// SSRF protection for the Windows sync service. The URL is env-configured (admin-gated endpoint),
// but we validate the resolved host against an allowlist before issuing any request to prevent
// the server being used to reach internal metadata/loopback endpoints.
// Allowed hosts come from SYNC_ALLOWED_HOSTS (comma-separated). Defaults to the sync host itself.
const SYNC_ALLOWED_HOSTS = String(process.env.SYNC_ALLOWED_HOSTS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// Private/loopback IPv4 ranges and cloud metadata endpoints we always block.
const BLOCKED_IP_PATTERNS = [
  /^127\./,                        // loopback
  /^10\./,                         // private
  /^192\.168\./,                   // private
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // private
  /^169\.254\./,                   // link-local / metadata (AWS/GCP/Azure)
  /^0\./,                          // 0.0.0.0/8
];

function isBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  // IPv6 loopback and metadata
  if (host === '::1' || host === '::' || host === '[::1]' || host === 'metadata.google.internal') return true;
  // Allowlist takes precedence if configured
  if (SYNC_ALLOWED_HOSTS.length && SYNC_ALLOWED_HOSTS.includes(host)) return false;
  // Block RFC1918 / loopback / metadata by default
  if (BLOCKED_IP_PATTERNS.some((re) => re.test(host))) return true;
  // host.docker.internal is a Docker alias to the host — allow it only when explicitly allowlisted
  if (host === 'host.docker.internal') return SYNC_ALLOWED_HOSTS.includes(host) ? false : true;
  return false;
}

async function safeFetchSyncUrl(url, init) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('WINDOWS_SYNC_URL is not a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('WINDOWS_SYNC_URL must use http or https.');
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`WINDOWS_SYNC_URL host "${parsed.hostname}" is blocked by SSRF protection. Add it to SYNC_ALLOWED_HOSTS if it is legitimate.`);
  }
  return fetch(url, init);
}

router.get('/reviewer/passphrase', async (_req, res) => {
  const { rows } = await pool.query('SELECT updated_at FROM reviewer_settings WHERE id = TRUE');
  if (!rows.length) {
    res.json({ configured: false });
    return;
  }
  res.json({ configured: true, updated_at: rows[0].updated_at });
});

router.post(
  '/reviewer/passphrase',
  [requireAuth(['admin']), body('passphrase').isString().isLength({ min: 4, max: 128 })],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const passphraseHash = await hashPassphrase(req.body.passphrase);
    const { rows } = await pool.query(
      `INSERT INTO reviewer_settings (id, passphrase_hash, updated_at)
       VALUES (TRUE, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET passphrase_hash = EXCLUDED.passphrase_hash, updated_at = NOW()
       RETURNING updated_at`,
      [passphraseHash]
    );
    res.status(201).json({ configured: true, updated_at: rows[0].updated_at });
  }
);

const passphraseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many passphrase attempts. Please try again later.' },
});

router.post(
  '/reviewer/passphrase/verify',
  [passphraseLimiter, body('passphrase').isString().isLength({ min: 1, max: 128 })],
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { rows } = await pool.query('SELECT passphrase_hash FROM reviewer_settings WHERE id = TRUE');
    if (!rows.length || !rows[0].passphrase_hash) {
      res.status(404).json({ message: 'Reviewer passphrase not configured.' });
      return;
    }
    const incoming = req.body.passphrase;
    const stored = rows[0].passphrase_hash;
    let valid = false;
    if (isLegacyPassphraseHash(stored)) {
      // Legacy SHA-256 path — compare in constant time, then offer no upgrade hook here.
      const incomingHash = legacyHashPassphrase(incoming);
      if (incomingHash.length === stored.length) {
        valid = crypto.timingSafeEqual(Buffer.from(incomingHash, 'hex'), Buffer.from(stored, 'hex'));
      }
    } else {
      valid = await bcrypt.compare(incoming, stored);
    }
    if (valid) res.json({ valid: true });
    else res.status(401).json({ valid: false, message: 'Invalid passphrase.' });
  }
);

// ========== SFTP SYNC ENDPOINTS ==========

// Trigger a manual SFTP sync (admin only)
router.post('/saas/sync-trigger', requireAuth(['admin']), async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const requesterEmail = req.user?.email || 'unknown';
      const requesterName = req.user?.display_name || req.user?.email || 'unknown';
      const requesterId = req.user?.id || null;
      
      // Auto-cleanup: Delete sync records older than 30 days
      await client.query(`
        DELETE FROM sftp_sync_requests 
        WHERE requested_at < NOW() - INTERVAL '30 days'
      `);
      
      // Check if there's already a pending request in the last 5 minutes
      const recent = await client.query(`
        SELECT id FROM sftp_sync_requests 
        WHERE status IN ('pending', 'processing')
        AND requested_at > NOW() - INTERVAL '5 minutes'
        ORDER BY requested_at DESC 
        LIMIT 1
      `);
      
      if (recent.rows.length > 0) {
        return res.status(429).json({ 
          message: 'A sync request is already pending or processing from the last 5 minutes. Please wait before requesting another sync.' 
        });
      }
      
      // Insert new sync request
      const result = await client.query(`
        INSERT INTO sftp_sync_requests (requested_by, requester_email, requester_name, status, notes) 
        VALUES ($1, $2, $3, $4, $5) 
        RETURNING id, requested_at
      `, [
        requesterId, 
        requesterEmail,
        requesterName,
        SFTP_SYNC_METHOD === 'database' ? 'pending' : 'processing',
        req.body?.notes || 'Manual sync triggered from web interface'
      ]);
      
      const requestId = result.rows[0].id;
      
      // Handle different sync methods
      if (SFTP_SYNC_METHOD === 'direct') {
        // Call Windows web service directly
        try {
          console.log(`[SFTP Sync] Attempting direct sync to ${WINDOWS_SYNC_URL}`);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), SYNC_TIMEOUT);
          
          const windowsResponse = await safeFetchSyncUrl(WINDOWS_SYNC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              requestId, 
              requestedBy: requesterEmail,
              timestamp: new Date().toISOString()
            }),
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (!windowsResponse.ok) {
            const errorText = await windowsResponse.text().catch(() => 'No error details');
            throw new Error(`Windows service responded with status ${windowsResponse.status}: ${errorText}`);
          }
          
          const syncResult = await windowsResponse.json();
          console.log(`[SFTP Sync] Direct sync completed:`, syncResult);
          
          // Update database with success
          await client.query(`
            UPDATE sftp_sync_requests 
            SET status = 'completed', completed_at = NOW(), files_synced = $2
            WHERE id = $1
          `, [requestId, syncResult.filesCount || 0]);
          
          res.json({
            success: true,
            message: 'Sync completed successfully',
            requestId: requestId,
            filesCount: syncResult.filesCount || 0,
            method: 'direct'
          });
          
        } catch (syncError) {
          console.error(`[SFTP Sync] Direct sync failed:`, syncError);
          
          // Determine the specific error type
          let errorMessage = syncError.message;
          if (syncError.name === 'AbortError' || syncError.message.includes('aborted')) {
            errorMessage = `Sync request timed out after ${SYNC_TIMEOUT}ms. The Windows sync service may be unreachable at ${WINDOWS_SYNC_URL}`;
          } else if (syncError.message.includes('fetch failed') || syncError.message.includes('ECONNREFUSED') || syncError.message.includes('ENOTFOUND')) {
            errorMessage = `Cannot connect to Windows sync service at ${WINDOWS_SYNC_URL}. Please ensure the service is running and accessible.`;
          } else if (syncError.message.includes('ECONNRESET')) {
            errorMessage = `Connection to Windows sync service was reset. The service may have crashed or closed the connection.`;
          }
          
          // Update database with failure
          await client.query(`
            UPDATE sftp_sync_requests 
            SET status = 'failed', completed_at = NOW(), error_message = $2
            WHERE id = $1
          `, [requestId, errorMessage]);
          
          throw new Error(`Sync failed: ${errorMessage}`);
        }
        
      } else if (SFTP_SYNC_METHOD === 'file' && SYNC_TRIGGER_PATH) {
        // File-based trigger
        try {
          const triggerData = {
            requestId,
            requestedBy: requesterEmail,
            requestedAt: new Date().toISOString()
          };
          
          await fs.writeFile(SYNC_TRIGGER_PATH, JSON.stringify(triggerData));
          
          // For file-based, we return immediately and let the scheduled script handle it
          res.json({
            success: true,
            message: 'Sync request submitted. The Windows service will process this shortly.',
            requestId: requestId,
            method: 'file'
          });
          
        } catch (fileError) {
          await client.query(`
            UPDATE sftp_sync_requests 
            SET status = 'failed', completed_at = NOW(), error_message = $2
            WHERE id = $1
          `, [requestId, `File trigger failed: ${fileError.message}`]);
          
          throw new Error(`Failed to create trigger file: ${fileError.message}`);
        }
        
      } else {
        // Database-only method (original approach)
        res.json({ 
          success: true, 
          message: 'Sync request submitted. The next scheduled sync (within 15 minutes) will process this request.',
          requestId: requestId,
          method: 'database',
          warning: 'This method requires waiting for the next scheduled sync cycle.'
        });
      }
      
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Failed to create sync request:', error);
    res.status(500).json({ 
      success: false,
      message: error.message || 'Failed to submit sync request.' 
    });
  }
});

// Get sync configuration info
router.get('/saas/config', requireAuth(), async (req, res) => {
  const config = {
    method: SFTP_SYNC_METHOD,
    immediateSync: SFTP_SYNC_METHOD !== 'database',
    description: {
      'direct': 'Immediate sync via Windows web service',
      'file': 'Immediate sync via file trigger',
      'database': 'Scheduled sync (up to 15 minute delay)'
    }[SFTP_SYNC_METHOD] || 'Unknown method',
    windowsSyncUrl: SFTP_SYNC_METHOD === 'direct' ? WINDOWS_SYNC_URL : null,
    syncTriggerPath: SFTP_SYNC_METHOD === 'file' ? SYNC_TRIGGER_PATH : null,
    syncTimeout: SYNC_TIMEOUT
  };
  
  console.log(`[SFTP Sync] Config requested:`, config);
  res.json(config);
});

// Get recent sync requests for status display
router.get('/saas/sync-history', requireAuth(), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const client = await pool.connect();
    try {
      // Auto-cleanup: Delete sync records older than 30 days
      await client.query(`
        DELETE FROM sftp_sync_requests 
        WHERE requested_at < NOW() - INTERVAL '30 days'
      `);
      
      const result = await client.query(`
        SELECT 
          id, 
          requested_at, 
          requester_email,
          requester_name,
          status, 
          completed_at, 
          error_message, 
          files_synced,
          notes
        FROM sftp_sync_requests 
        ORDER BY requested_at DESC 
        LIMIT $1
      `, [limit]);
      
      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Failed to fetch sync history:', error);
    res.status(500).json({ message: 'Failed to load sync history.' });
  }
});

export default router;

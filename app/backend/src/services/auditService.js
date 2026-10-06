import { pool } from '../db.js';

// Append-only audit trail. All writes flow through record() so the audit_log
// table can be locked down (no UPDATE/DELETE grants) while callers never touch
// it directly.
export async function recordAudit({ actor, action, entityType, entityId, before, after, metadata, client }) {
  try {
    await (client || pool).query(
      `INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, before, after, metadata, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        actor?.id ?? null,
        actor?.email ?? null,
        action,
        entityType,
        entityId ? String(entityId) : null,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        metadata ? JSON.stringify(metadata) : '{}',
        actor?.ip ?? null,
      ]
    );
  } catch (err) {
    // Identity/authority changes supply their transaction so an audit failure
    // rolls back the change. Older callers retain their best-effort behaviour.
    if (client) throw err;
    // Audit failures must never break the primary operation.
    console.error('Failed to record audit entry', err);
  }
}

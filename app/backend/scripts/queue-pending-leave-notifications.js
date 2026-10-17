// Preview by default. --apply queues current pending approvals once; the normal
// delivery worker sends them after commit. Never replays historical decisions.
import { pool } from '../src/db.js';
import { withTransaction } from '../src/lib/transaction.js';
import { getRequest, stagesFor, bindingIssue } from '../src/services/governmentLeaveWorkflow.js';
import { queueCurrentLeaveApprover } from '../src/services/governmentLeaveNotifications.js';

try {
  const apply = process.argv.includes('--apply');
  const { rows } = await pool.query("SELECT id FROM hr_gov_requests WHERE status='pending' ORDER BY submitted_at,id");
  for (const { id } of rows) await withTransaction(pool, async client => {
    await client.query('SELECT id FROM hr_gov_requests WHERE id=$1 FOR UPDATE', [id]);
    const request = await getRequest(client, id);
    if (request.status !== 'pending') return;
    const stage = (await stagesFor(client, id)).find(item => item.ordinal === request.stage_index);
    const issue = stage ? await bindingIssue(client, request, stage) : 'Missing current stage.';
    if (issue) { console.log(`${id}: blocked — ${issue}`); return; }
    if (apply) await queueCurrentLeaveApprover(client, id);
    console.log(`${id}: ${apply ? 'queued (or already queued)' : 'would queue'} — ${stage.binding.approver_name}`);
  });
} finally { await pool.end(); }

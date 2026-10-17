import { FRONTEND_BASE_URL } from '../config.js';
import { withTransaction } from '../lib/transaction.js';
import { lowerEmail } from '../utils/helpers.js';
import { mailTransport, sendMail, testingModeEnabled } from './mailService.js';
import { localProductionReview } from './localReviewMode.js';

export async function initGovernmentLeaveNotificationSchema(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS hr_gov_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_key TEXT NOT NULL UNIQUE,
    request_id UUID NOT NULL REFERENCES hr_gov_requests(id),
    kind TEXT NOT NULL CHECK(kind IN ('approval_needed','decision')),
    recipient_id UUID NOT NULL REFERENCES reviewers(id),
    stage_id UUID REFERENCES hr_gov_request_stages(id), binding_id UUID REFERENCES hr_gov_stage_bindings(id),
    payload JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','skipped')),
    attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT, recipient_email TEXT, message_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), sent_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS idx_hr_gov_notifications_due
    ON hr_gov_notifications(next_attempt_at,id) WHERE status='pending';
  CREATE INDEX IF NOT EXISTS idx_hr_gov_notifications_request ON hr_gov_notifications(request_id,created_at);`);
}

async function enqueue(client, { key, requestId, kind, recipientId, stageId = null, bindingId = null, payload = {} }) {
  if (!recipientId) return;
  await client.query(`INSERT INTO hr_gov_notifications
    (event_key,request_id,kind,recipient_id,stage_id,binding_id,payload)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(event_key) DO NOTHING`,
  [key, requestId, kind, recipientId, stageId, bindingId, payload]);
}

// Called in the application transaction: an accepted application cannot lose
// its notification if SMTP is unavailable or the process restarts.
export async function queueCurrentLeaveApprover(client, requestId) {
  const { rows: [stage] } = await client.query(`SELECT s.id,b.id AS binding_id,b.reviewer_id
    FROM hr_gov_requests r JOIN hr_gov_request_stages s ON s.request_id=r.id AND s.ordinal=r.stage_index
    JOIN LATERAL(SELECT * FROM hr_gov_stage_bindings WHERE stage_id=s.id ORDER BY recorded_at DESC,id DESC LIMIT 1)b ON TRUE
    WHERE r.id=$1 AND r.status='pending'`, [requestId]);
  if (!stage) return;
  await enqueue(client, { key: `approval:${stage.binding_id}`, requestId, kind: 'approval_needed',
    recipientId: stage.reviewer_id, stageId: stage.id, bindingId: stage.binding_id });
}

export async function queueLeaveDecision(client, { requestId, eventKey, actorId, stage, decision, status }) {
  const { rows: [employee] } = await client.query(`SELECT e.reviewer_id FROM hr_gov_requests r
    JOIN hr_employees e ON e.id=r.employee_id WHERE r.id=$1`, [requestId]);
  const recipients = new Set([actorId]);
  // Intermediate approvals are recommendations, not a final grant. Applicants
  // and previous approving officers receive the final outcome when it exists.
  if (status !== 'pending') {
    recipients.add(employee?.reviewer_id);
    const { rows } = await client.query('SELECT actor_id FROM hr_gov_decisions WHERE request_id=$1', [requestId]);
    for (const row of rows) recipients.add(row.actor_id);
  }
  for (const recipientId of recipients) await enqueue(client, {
    key: `decision:${eventKey}:${recipientId}`, requestId, kind: 'decision', recipientId,
    stageId: stage.id, bindingId: stage.binding.id,
    payload: { decision, status, actor_id: actorId, applicant_id: employee?.reviewer_id, label: stage.label || stage.level.replaceAll('_', ' ') },
  });
}

async function prepareNotification(client, notification) {
  const workflow = await import('./governmentLeaveWorkflow.js');
  const request = await workflow.getRequest(client, notification.request_id);
  const { rows: [recipient] } = await client.query('SELECT email,display_name,status FROM reviewers WHERE id=$1', [notification.recipient_id]);
  if (!recipient || recipient.status !== 'active') return { skip: 'Recipient account is inactive.' };
  const to = lowerEmail(recipient.email || '');
  if (!to) throw new Error('Recipient has no email address.');
  const applicant = request.application_snapshot.employee.name;
  const base = FRONTEND_BASE_URL.replace(/\/+$/, '');
  const summary = `Applicant: ${applicant}\nApplication: ${request.id}\nDates: ${request.start_date} to ${request.end_date}`;
  if (notification.kind === 'approval_needed') {
    const stage = (await workflow.stagesFor(client, request.id)).find(s => s.id === notification.stage_id);
    if (request.status !== 'pending' || stage?.ordinal !== request.stage_index || stage.decision || stage.binding?.id !== notification.binding_id)
      return { skip: 'The application or current stage assignment changed.' };
    const issue = await workflow.bindingIssue(client, request, stage);
    if (issue) return { skip: issue };
    return { to, subject: `Leave approval needed — ${applicant}`,
      text: `Hello ${recipient.display_name || 'there'},\n\nA leave application is waiting for your decision at ${stage.label || stage.level.replaceAll('_', ' ')}.\n\n${summary}\n\nReview the application: ${base}/leave/approvals\n` };
  }
  const payload = notification.payload;
  const isApplicant = notification.recipient_id === payload.applicant_id;
  if (isApplicant) {
    const { rows: [employee] } = await client.query('SELECT reviewer_id FROM hr_employees WHERE id=$1', [request.employee_id]);
    if (employee?.reviewer_id !== notification.recipient_id) return { skip: 'Applicant account link changed.' };
  } else {
    // A decision receipt does not grant access to personnel records. Recheck
    // current authority before notifying an officer whose role has changed.
    const state = await workflow.accountState(client, notification.recipient_id, request);
    if (!state || !await workflow.canReadRequest(client, state.user, request)) return { skip: 'Officer access to the application changed.' };
  }
  const outcome = payload.status === 'pending'
    ? `Your approval at ${payload.label} was recorded. ${request.status === 'pending' ? 'The application is still pending further approval.' : `The application is now ${request.status}.`}`
    : `The leave application was ${payload.status === 'approved' ? 'approved' : 'rejected'}.`;
  return { to, subject: payload.status === 'pending' ? `Leave decision recorded — ${applicant}` : `Leave ${payload.status} — ${applicant}`,
    text: `Hello ${recipient.display_name || 'there'},\n\n${outcome}\n\n${summary}\n\nView the decision: ${base}/leave/${isApplicant ? 'my-leave' : 'approvals'}\n` };
}

// One recipient per message lets each delivery succeed or retry independently.
// SMTP acceptance is recorded; it does not prove delivery into the inbox.
export async function deliverLeaveNotifications(pool, { limit = 25, deliver = sendMail } = {}) {
  const result = { sent: 0, failed: 0, skipped: 0, paused: false };
  if (localProductionReview || testingModeEnabled || !mailTransport) return { ...result, paused: true };
  for (let index = 0; index < limit; index++) {
    const handled = await withTransaction(pool, async client => {
      const { rows: [notification] } = await client.query(`SELECT * FROM hr_gov_notifications
        WHERE status='pending' AND next_attempt_at<=NOW() ORDER BY next_attempt_at,id
        LIMIT 1 FOR UPDATE SKIP LOCKED`);
      if (!notification) return false;
      try {
        const message = await prepareNotification(client, notification);
        if (message.skip) {
          await client.query("UPDATE hr_gov_notifications SET status='skipped',last_error=$2 WHERE id=$1", [notification.id, message.skip]);
          result.skipped++;
          return true;
        }
        const info = await deliver({ ...message, messageId: `<leave-${notification.id}@${new URL(FRONTEND_BASE_URL).hostname}>` });
        if (info?.skipped) { result.paused = true; return false; }
        if (!info?.accepted?.some(address => lowerEmail(address) === message.to)) throw new Error('SMTP did not accept the recipient.');
        await client.query(`UPDATE hr_gov_notifications SET status='sent',attempts=attempts+1,
          recipient_email=$2,message_id=$3,sent_at=NOW(),last_error=NULL WHERE id=$1`,
        [notification.id, message.to, info.messageId || null]);
        result.sent++;
      } catch (error) {
        // Retry indefinitely with a capped backoff; do not lose a saved decision.
        await client.query(`UPDATE hr_gov_notifications SET attempts=attempts+1,last_error=$2,
          next_attempt_at=NOW()+make_interval(secs=>$3) WHERE id=$1`,
        [notification.id, String(error.message || error).slice(0, 1000), Math.min(3600, 30 * 2 ** Math.min(notification.attempts, 7))]);
        console.error('[leave-notifications] Delivery failed', notification.id, error.message);
        result.failed++;
      }
      return true;
    });
    if (!handled) break;
  }
  return result;
}

export function startLeaveNotificationDelivery(pool) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await deliverLeaveNotifications(pool);
      if (result.sent || result.failed || result.skipped) console.info('[leave-notifications]', result);
    } catch (error) { console.error('[leave-notifications] Queue processing failed', error); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(run, 15_000);
  timer.unref();
  return timer;
}

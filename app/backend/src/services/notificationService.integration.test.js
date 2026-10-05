/**
 * Leave and FOREX TT notifications used to keep their own mail transport and
 * testing-mode flag, so switching on testing mode in Admin did not stop them.
 * They now send through mailService, and follow its switch.
 */
import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import { connectTestDatabase, skipWithoutDatabase } from '../test-support/database.js';

// A transport that exists but can never deliver: an attempted send fails.
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = '1';

describe('notifications follow the admin testing-mode switch', { skip: skipWithoutDatabase }, () => {
  let pool;
  let mail;
  let notifications;
  const leave = {
    application: { leave_type_name: 'Annual', start_date: '2026-10-12', end_date: '2026-10-13', days: 2, reason: 'Rest' },
    employee: { display_name: 'Ana' },
    approvers: [{ email: 'approver@test' }],
  };

  before(async () => {
    pool = await connectTestDatabase();
    mail = await import('./mailService.js');
    notifications = await import('./notificationService.js');
  });
  after(async () => {
    await pool.query('UPDATE reviewer_settings SET testing_mode = FALSE WHERE id = TRUE');
    await pool?.end();
  });

  test('testing mode on: nothing is sent', async () => {
    await pool.query('UPDATE reviewer_settings SET testing_mode = TRUE WHERE id = TRUE');
    await mail.refreshTestingModeSetting();
    assert.deepEqual(await notifications.notifyLeaveSubmitted(leave), []);
  });

  test('testing mode off: a send is attempted', async () => {
    await pool.query('UPDATE reviewer_settings SET testing_mode = FALSE WHERE id = TRUE');
    await mail.refreshTestingModeSetting();
    await assert.rejects(() => notifications.notifyLeaveSubmitted(leave));
  });
});

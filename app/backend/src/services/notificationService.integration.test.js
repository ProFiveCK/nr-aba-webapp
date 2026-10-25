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
  };
  // Any mail the leave notifier would send; used to probe the testing-mode switch.
  const decision = { ...leave, employee: { display_name: 'Ana', email: 'ana@test' }, decision: 'approved',
    approver: { email: 'approver@test' }, decidedBy: 'Approver' };

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
    assert.deepEqual(await notifications.notifyLeaveDecision(decision), []);
  });

  test('testing mode off: a send is attempted', async () => {
    await pool.query('UPDATE reviewer_settings SET testing_mode = FALSE WHERE id = TRUE');
    await mail.refreshTestingModeSetting();
    await assert.rejects(() => notifications.notifyLeaveDecision(decision));
  });

  test('legacy decision emails go separately to the applicant and deciding approver', async () => {
    const messages = [];
    const original = mail.mailTransport.sendMail;
    mail.mailTransport.sendMail = async message => { messages.push(message); return { accepted: [message.to] }; };
    try {
      const sent = await notifications.notifyLeaveDecision({ ...leave,
        employee: { display_name: 'Ana', email: 'ana@test' }, decision: 'approved',
        approver: { email: 'approver@test' }, decidedBy: 'Approver',
      });
      assert.deepEqual(sent, ['ana@test', 'approver@test']);
      assert.match(messages[0].subject, /Your leave request was approved/);
      assert.match(messages[1].subject, /Leave decision recorded/);
      assert.match(messages[1].text, /leave\/approvals/);
    } finally { mail.mailTransport.sendMail = original; }
  });

  test('a deciding approver still receives confirmation when the legacy applicant has no email', async () => {
    const messages = [];
    const original = mail.mailTransport.sendMail;
    mail.mailTransport.sendMail = async message => { messages.push(message); return { accepted: [message.to] }; };
    try {
      const sent = await notifications.notifyLeaveDecision({ ...leave,
        decision: 'rejected', approver: { email: 'approver@test' },
      });
      assert.deepEqual(sent, ['approver@test']);
      assert.match(messages[0].text, /not approved/);
    } finally { mail.mailTransport.sendMail = original; }
  });

  test('shared mail service returns actual SMTP acceptance for notification tracking', async () => {
    const { createServer } = await import('node:net');
    const nodemailer = (await import('nodemailer')).default;
    const sockets = new Set();
    const received = [];
    const server = createServer(socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.write('220 localhost test SMTP\r\n');
      let buffer = '', data = false, body = [];
      socket.on('data', chunk => {
        buffer += chunk.toString();
        let end;
        while ((end = buffer.indexOf('\r\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          if (data) {
            if (line === '.') { received.push(body.join('\n')); body = []; data = false; socket.write('250 accepted\r\n'); }
            else body.push(line);
          } else if (/^EHLO/i.test(line)) socket.write('250-localhost\r\n250 PIPELINING\r\n');
          else if (/^DATA/i.test(line)) { data = true; socket.write('354 send message\r\n'); }
          else if (/^QUIT/i.test(line)) socket.end('221 goodbye\r\n');
          else socket.write('250 ok\r\n');
        }
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const transport = nodemailer.createTransport({ host: '127.0.0.1', port: server.address().port, secure: false, socketTimeout: 3000 });
    const original = mail.mailTransport.sendMail;
    mail.mailTransport.sendMail = transport.sendMail.bind(transport);
    try {
      const info = await mail.sendMail({ to: 'approver@example.test', from: 'portal@example.test', subject: 'Synthetic leave decision', text: 'Synthetic approval confirmation.' });
      assert.deepEqual(info.accepted, ['approver@example.test']);
      assert.ok(info.messageId);
      assert.equal(received.length, 1);
      assert.match(received[0], /Synthetic approval confirmation/);
    } finally {
      mail.mailTransport.sendMail = original;
      transport.close();
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  });
});

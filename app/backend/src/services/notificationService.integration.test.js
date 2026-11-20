/**
 * The whole app sends through one mail service: the SMTP settings and the
 * testing-mode switch saved in Admin. These probes pin the switch down —
 * when testing mode is on nothing is attempted, and off, sends go to a real
 * socket and report the server's acceptance so notification tracking works.
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

  before(async () => {
    pool = await connectTestDatabase();
    mail = await import('./mailService.js');
    await mail.refreshTestingModeSetting();
  });
  after(async () => {
    await pool.query('UPDATE reviewer_settings SET testing_mode = FALSE WHERE id = TRUE');
    await pool?.end();
  });

  test('testing mode on: nothing is attempted', async () => {
    await pool.query('UPDATE reviewer_settings SET testing_mode = TRUE WHERE id = TRUE');
    await mail.refreshTestingModeSetting();
    assert.deepEqual(await mail.sendMail({ to: 'approver@example.test', subject: 'Synthetic', text: 'x' }),
      { skipped: true, reason: 'testing_mode' });
    await assert.rejects(() => mail.mailTransport.sendMail({ to: 'approver@example.test', subject: 'Synthetic', text: 'x' }));
  });

  test('testing mode off: a send is attempted against the configured transport', async () => {
    await pool.query('UPDATE reviewer_settings SET testing_mode = FALSE WHERE id = TRUE');
    await mail.refreshTestingModeSetting();
    await assert.rejects(() => mail.sendMail({ to: 'approver@example.test', subject: 'Synthetic', text: 'x' }));
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

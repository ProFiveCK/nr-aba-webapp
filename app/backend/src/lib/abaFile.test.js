import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAbaFile, amendValueDate } from './abaFile.js';
import { detail, file, header, trailer } from '../test-support/aba.js';

const goodLines = [
  header('SALARIES', '061026'),
  detail('062-000', '12345678', '53', 150025, 'JANE CITIZEN', 'PAY 1'),
  detail('083-004', '987654', '53', 4999975, 'JOHN SMITH', 'PAY 2'),
  detail('012-345', '11112222', '13', 5150000, 'TREASURY OPERATING', 'SALARIES-061026'),
  trailer(0, 5150000, 5150000, 3),
];

test('parses a balanced file and lists the credit lines', () => {
  const parsed = parseAbaFile(file(goodLines));
  assert.equal(parsed.header.proc, '061026');
  assert.equal(parsed.details.length, 3);
  assert.deepEqual(parsed.credits.map((c) => [c.bsb, c.account, c.cents]), [
    ['062-000', '12345678', 150025],
    ['083-004', '987654', 4999975],
  ]);
});

test('accepts LF line endings too', () => {
  assert.equal(parseAbaFile(file(goodLines, '\n')).details.length, 3);
});

test('rejects a file whose trailer does not match its lines', () => {
  // A payee's amount raised without fixing the totals.
  const tampered = [...goodLines];
  tampered[2] = detail('083-004', '987654', '53', 9999975, 'JOHN SMITH', 'PAY 2');
  assert.throws(() => parseAbaFile(file(tampered)), /trailer totals/);
});

test('rejects wrong line counts, widths, record types and codes', () => {
  const badCount = [...goodLines.slice(0, 4), trailer(0, 5150000, 5150000, 9)];
  assert.throws(() => parseAbaFile(file(badCount)), /line count/);

  const shortLine = [...goodLines];
  shortLine[1] = shortLine[1].slice(0, 119);
  assert.throws(() => parseAbaFile(file(shortLine)), /line 2 is 119 characters/);

  assert.throws(() => parseAbaFile(file(goodLines.slice(1))), /not a header/);

  const badCode = [...goodLines];
  badCode[1] = detail('062-000', '12345678', '99', 150025, 'JANE CITIZEN', 'PAY 1');
  assert.throws(() => parseAbaFile(file(badCode)), /unknown transaction code 99/);

  assert.throws(() => parseAbaFile(Buffer.from('not an aba file')), /needs a header/);
});

test('amending the value date changes only the date, description and remitter', () => {
  const before = file(goodLines);
  const after = amendValueDate(before, { proc: '091026', desc: 'WAGES', remitter: 'NAURU GOVT' });
  const lines = after.toString('utf8').split('\r\n');
  const parsed = parseAbaFile(after);

  assert.equal(parsed.header.proc, '091026');
  assert.equal(parsed.header.desc, 'WAGES');
  assert.equal(lines[1].slice(96, 112), 'NAURU GOVT      ');
  assert.equal(lines[3].slice(62, 80), 'WAGES-091026      ');
  // Payees, accounts and amounts untouched.
  assert.deepEqual(parsed.details.map((d) => [d.bsb, d.account, d.cents]),
    parseAbaFile(before).details.map((d) => [d.bsb, d.account, d.cents]));
  assert.equal(lines[1].slice(0, 96), goodLines[1].slice(0, 96));
  assert.ok(after.toString('utf8').endsWith('\r\n'));
});

test('amending without a description or remitter keeps the existing ones', () => {
  const after = amendValueDate(file(goodLines), { proc: '091026' });
  const lines = after.toString('utf8').split('\r\n');
  assert.equal(lines[0].slice(62, 74), 'SALARIES    ');
  assert.equal(lines[1].slice(96, 112), 'RON TREASURY    ');
  assert.equal(lines[3].slice(62, 80), 'SALARIES-091026   ');
});

test('amending refuses a bad date or a broken file', () => {
  assert.throws(() => amendValueDate(file(goodLines), { proc: '9/10/26' }), /DDMMYY/);
  assert.throws(() => amendValueDate(Buffer.from('junk'), { proc: '091026' }), /ABA file/);
});

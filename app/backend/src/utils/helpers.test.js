import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBlacklistKey, normalizeAccountNumber, normalizeBsb } from './helpers.js';

// POST /api/batches refuses a batch whose payload pays a blacklisted account.
// It matches on these keys, so they must agree with how the admin stored the
// entry and how the client (lib/blacklist.ts) builds its own.

test('normalizeBsb accepts six digits in any punctuation and nothing else', () => {
  for (const input of ['082001', '082-001', ' 082 001 ', '082.001']) assert.equal(normalizeBsb(input), '082-001');
  for (const input of ['08200', '', null, undefined, 'abc-def']) assert.equal(normalizeBsb(input), null);
});

test('normalizeAccountNumber keeps the digits only', () => {
  assert.equal(normalizeAccountNumber(' 12-345-678 '), '12345678');
  assert.equal(normalizeAccountNumber(null), '');
});

test('a blacklist key is the same however the BSB and account were typed', () => {
  assert.equal(buildBlacklistKey('082001', '12-345-678'), '082-001|12345678');
  assert.equal(buildBlacklistKey(' 082 001', '12345678'), buildBlacklistKey('082-001', '12345678'));
  assert.notEqual(buildBlacklistKey('082-001', '12345678'), buildBlacklistKey('082-001', '12345679'));
});

test('no key without a valid BSB and an account', () => {
  assert.equal(buildBlacklistKey('08200', '12345678'), null);
  assert.equal(buildBlacklistKey('082-001', ''), null);
});


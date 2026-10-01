import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeNameKey } from './names.js';

test('collapses punctuation and spacing differences to the same key', () => {
  assert.equal(normalizeNameKey('Val-cade'), normalizeNameKey('Valcade'));
  assert.equal(normalizeNameKey('Anne Marie'), normalizeNameKey('Anne-Marie'));
  assert.equal(normalizeNameKey("O'Brien"), normalizeNameKey('OBrien'));
});

test('still distinguishes genuinely different names', () => {
  assert.notEqual(normalizeNameKey('Jane Smith'), normalizeNameKey('John Smith'));
});

test('handles empty and non-string input', () => {
  assert.equal(normalizeNameKey(''), '');
  assert.equal(normalizeNameKey(null), '');
  assert.equal(normalizeNameKey(undefined), '');
});

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { buildUpdateAssignments, changedFields, collectUpdates } from './sqlUpdate.js';

const EMPLOYEE_FIELDS = ['manager_id', 'department_code', 'join_date', 'reviewer_id', 'status', 'leave_entitled'];

describe('collectUpdates', () => {
  test('keeps only the fields the body carries', () => {
    const updates = collectUpdates({ manager_id: 'm1', status: 'active' }, EMPLOYEE_FIELDS);
    assert.deepEqual(updates, { manager_id: 'm1', status: 'active' });
  });

  test('keeps an explicit null — this is the whole point', () => {
    // The bug this replaced: COALESCE treated null as "not supplied", so a
    // manager could be set but never removed.
    const updates = collectUpdates({ manager_id: null }, EMPLOYEE_FIELDS);
    assert.ok(Object.hasOwn(updates, 'manager_id'));
    assert.equal(updates.manager_id, null);
  });

  test('treats an explicit undefined as absent', () => {
    assert.deepEqual(collectUpdates({ manager_id: undefined }, EMPLOYEE_FIELDS), {});
  });

  test('ignores fields outside the allowlist', () => {
    const updates = collectUpdates({ id: 'x', display_name: 'Mallory', manager_id: 'm1' }, EMPLOYEE_FIELDS);
    assert.deepEqual(updates, { manager_id: 'm1' });
  });

  test('survives a missing or non-object body', () => {
    assert.deepEqual(collectUpdates(undefined, EMPLOYEE_FIELDS), {});
    assert.deepEqual(collectUpdates(null, EMPLOYEE_FIELDS), {});
    assert.deepEqual(collectUpdates('nope', EMPLOYEE_FIELDS), {});
  });

  test('is not fooled by inherited properties', () => {
    const body = Object.create({ manager_id: 'inherited' });
    assert.deepEqual(collectUpdates(body, EMPLOYEE_FIELDS), {});
  });

  test('keeps falsy values that are real values', () => {
    const updates = collectUpdates({ leave_entitled: false, department_code: '' }, EMPLOYEE_FIELDS);
    assert.deepEqual(updates, { leave_entitled: false, department_code: '' });
  });
});

describe('buildUpdateAssignments', () => {
  test('numbers placeholders after the ones already used', () => {
    const { clause, values } = buildUpdateAssignments({ manager_id: 'm1', status: 'active' }, 1);
    assert.equal(clause, 'manager_id = $2, status = $3');
    assert.deepEqual(values, ['m1', 'active']);
  });

  test('starts at $1 when nothing precedes it', () => {
    const { clause } = buildUpdateAssignments({ status: 'active' }, 0);
    assert.equal(clause, 'status = $1');
  });

  test('passes null through as a bound value, not as SQL', () => {
    const { clause, values } = buildUpdateAssignments({ manager_id: null }, 1);
    assert.equal(clause, 'manager_id = $2');
    assert.deepEqual(values, [null]);
  });

  test('gives an empty clause for no updates', () => {
    assert.deepEqual(buildUpdateAssignments({}, 1), { clause: '', values: [] });
  });

  test('composes with collectUpdates into a valid statement', () => {
    const updates = collectUpdates({ join_date: null, leave_entitled: false }, EMPLOYEE_FIELDS);
    const { clause, values } = buildUpdateAssignments(updates, 1);
    assert.equal(
      `UPDATE hr_employees SET ${clause}, updated_at = NOW() WHERE id = $1`,
      'UPDATE hr_employees SET join_date = $2, leave_entitled = $3, updated_at = NOW() WHERE id = $1'
    );
    assert.deepEqual(['an-id', ...values], ['an-id', null, false]);
  });
});

describe('changedFields', () => {
  test('reports only what actually moved', () => {
    const before = { manager_id: 'm1', status: 'active' };
    const after = { manager_id: 'm2', status: 'active' };
    assert.deepEqual(changedFields(before, after, ['manager_id', 'status']), ['manager_id']);
  });

  test('does not report a NUMERIC that pg returned as a string', () => {
    // pg hands NUMERIC back as '20.00'; a raw !== against 20 would report a
    // change that never happened and write a misleading audit row.
    assert.deepEqual(changedFields({ days: 20 }, { days: '20' }, ['days']), []);
  });

  test('sees a field being cleared', () => {
    assert.deepEqual(changedFields({ manager_id: 'm1' }, { manager_id: null }, ['manager_id']), ['manager_id']);
  });

  test('sees a field being set from empty', () => {
    assert.deepEqual(changedFields({ manager_id: null }, { manager_id: 'm1' }, ['manager_id']), ['manager_id']);
  });
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, beforeEach, describe, test } from 'node:test';
import { connectTestDatabase, resetLeaveTables, skipWithoutDatabase } from '../test-support/database.js';
import { DEFAULT_RULES } from '../lib/governmentLeaveRules.js';

describe('Special leave balances above the yearly allowance', { skip: skipWithoutDatabase }, () => {
  let pool, service, hr, policy;
  before(async () => { pool = await connectTestDatabase(); service = await import('./governmentLeaveSpecialAllowance.js'); });
  after(async () => { await pool?.end(); });

  async function employee(name, { regime = 'government', status = 'active' } = {}) {
    return (await pool.query('INSERT INTO hr_employees(display_name,leave_policy_regime,status) VALUES($1,$2,$3) RETURNING *', [name, regime, status])).rows[0];
  }
  // A Special account whose leave year runs from `start` to `end` days from today.
  async function special(employeeId, amount, { start = -100, end = 264 } = {}) {
    const opening = (await pool.query(`INSERT INTO hr_gov_openings(employee_id,code,policy_version_id,period_start,period_end,as_of,amount,source_reference,payroll_reference,snapshot_hash,historical_snapshot,status,prepared_by,reason)
      SELECT $1,'special',$2,d+$3::int,d+$4::int,d+$3::int,$5,'Test register','Test payroll','test','[]','certified',$6,'Verified opening test'
      FROM (SELECT (NOW() AT TIME ZONE 'Pacific/Nauru')::date AS d) today RETURNING *`, [employeeId, policy.id, start, end, amount, hr.id])).rows[0];
    const account = (await pool.query(`INSERT INTO hr_gov_entitlements(employee_id,code,policy_version_id,period_start,period_end,as_of,opening_id)
      VALUES($1,'special',$2,$3,$4,$5,$6) RETURNING *`, [employeeId, policy.id, opening.period_start, opening.period_end, opening.as_of, opening.id])).rows[0];
    await movement(account, 'opening', amount);
    return account;
  }
  async function movement(account, kind, amount, reversesId = null) {
    return (await pool.query(`INSERT INTO hr_gov_ledger(entitlement_id,kind,amount,effective_date,event_key,reverses_id,source_reference,reason)
      VALUES($1,$2,$3,$4,$5,$6,'Test register','Verified balance movement') RETURNING *`, [account.id, kind, amount, account.as_of, randomUUID(), reversesId])).rows[0];
  }
  async function hold(account, amount) {
    const request = randomUUID();
    await pool.query("INSERT INTO hr_gov_reservation_requests(id,employee_id,payload_hash,evaluation_snapshot,status) VALUES($1,$2,'test','{}','held')", [request, account.employee_id]);
    await pool.query('INSERT INTO hr_gov_reservations(request_id,entitlement_id,amount) VALUES($1,$2,$3)', [request, account.id, amount]);
  }
  const balance = async account => (await pool.query('SELECT COALESCE(sum(amount),0)::numeric(18,2)::text AS balance FROM hr_gov_ledger WHERE entitlement_id=$1', [account.id])).rows[0].balance;
  const movements = async () => (await pool.query('SELECT count(*)::int AS n FROM hr_gov_ledger')).rows[0].n;
  const named = (report, name) => report.rows.find(row => row.display_name === name);

  beforeEach(async () => {
    await resetLeaveTables(pool); await pool.query('TRUNCATE hr_gov_policy_versions CASCADE');
    hr = (await pool.query("INSERT INTO reviewers(email,display_name,role,password_hash,permissions) VALUES($1,'Special test','user','x',$2) RETURNING *", [`${randomUUID()}@example.test`, { hr_admin: true }])).rows[0];
    policy = (await pool.query(`INSERT INTO hr_gov_policy_versions(label,effective_from,effective_to,rules,source_reference,status,reason)
      VALUES('Special test policy','2020-01-01','2099-12-31',$1,'signed test','published','Verified policy test') RETURNING *`, [DEFAULT_RULES])).rows[0];
  });

  test('the preview lists who is above the allowance and changes nothing', async () => {
    const five = await special((await employee('Five untouched')).id, '5');
    await special((await employee('Three already')).id, '3');
    await special((await employee('Inactive five', { status: 'inactive' })).id, '5');
    await employee('Earlier setup', { regime: 'legacy' });
    await pool.query("UPDATE hr_leave_types SET default_days=5,is_active=TRUE WHERE name='Special'");
    const before = await movements(), report = await service.alignSpecialLeave(pool);
    assert.equal(report.allowance, '3'); assert.equal(report.applied, false); assert.deepEqual(report.corrected, []);
    assert.deepEqual(report.rows.map(row => [row.display_name, row.status]), [['Five untouched', 'reduce'], ['Three already', 'within']]);
    const row = named(report, 'Five untouched');
    assert.equal(row.credited, '5.000000'); assert.equal(row.remove, '2.000000'); assert.equal(row.balance_after, '3.000000'); assert.equal(row.scheduled, false);
    assert.deepEqual(report.earlier_setup.map(row => [row.display_name, Number(row.balance)]), [['Earlier setup', 5]]);
    assert.equal(await movements(), before); assert.equal(await balance(five), '5.00');
  });

  test('applying keeps leave already taken or pending and never takes a balance below zero', async () => {
    const untouched = await special((await employee('Five untouched')).id, '5');
    const usedOne = await special((await employee('Five used one')).id, '5'); await movement(usedOne, 'use', '-1');
    const usedFour = await special((await employee('Five used four')).id, '5'); await movement(usedFour, 'use', '-4');
    const usedAll = await special((await employee('Five used all')).id, '5'); await movement(usedAll, 'use', '-5');
    const pending = await special((await employee('Five with pending')).id, '5'); await hold(pending, '4');
    const refunded = await special((await employee('Five with refund')).id, '5');
    const taken = await movement(refunded, 'use', '-2'); await movement(refunded, 'reversal', '1', taken.id);
    const three = await special((await employee('Three already')).id, '3'); await movement(three, 'use', '-1');
    const ended = await special((await employee('Year ended')).id, '5', { start: -400, end: -36 });

    const report = await service.alignSpecialLeave(pool, { apply: true });
    assert.deepEqual(report.corrected.map(row => [row.display_name, row.remove]), [['Five untouched', '2.000000'], ['Five used four', '1.000000'],
      ['Five used one', '2.000000'], ['Five with pending', '1.000000'], ['Five with refund', '2.000000']]);
    assert.equal(await balance(untouched), '3.00'); assert.equal(await balance(usedOne), '2.00'); assert.equal(await balance(usedFour), '0.00');
    assert.equal(await balance(usedAll), '0.00'); assert.equal(await balance(pending), '4.00'); assert.equal(await balance(refunded), '2.00');
    assert.equal(await balance(three), '2.00'); assert.equal(await balance(ended), '5.00');
    assert.equal(named(report, 'Five used all').status, 'nothing_left'); assert.equal(named(report, 'Year ended').status, 'year_ended');
    assert.equal(named(report, 'Five with refund').used, '1.000000');

    const { rows: [posted] } = await pool.query("SELECT kind,amount::text,source_reference,reason,actor_id FROM hr_gov_ledger WHERE entitlement_id=$1 AND kind='correction'", [untouched.id]);
    assert.deepEqual(posted, { kind: 'correction', amount: '-2.000000', source_reference: 'Special leave allowance review',
      reason: 'Special leave is 3 days a service year. Removed 2 days kept from the earlier leave setup.', actor_id: null });

    // Running it again finds nothing more to remove.
    const after = await movements(), again = await service.alignSpecialLeave(pool, { apply: true });
    assert.deepEqual(again.corrected, []); assert.equal(await movements(), after);
    assert.deepEqual(again.rows.filter(row => row.status === 'reduce'), []);
  });
});

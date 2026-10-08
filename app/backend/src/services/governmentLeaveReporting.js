import {withTransaction} from '../lib/transaction.js';
import {employeeScopeSql} from './hrAccess.js';
import {dayNumber} from '../lib/governmentLeaveRules.js';
import {effectiveAbsenceSql,effectiveEndSql,isAbsenceSql} from './governmentLeaveCases.js';
import {ServiceError} from '../lib/serviceError.js';
// Report scope is enforced before aggregation; evidence, reasons and pay rates
// never enter the reporting projection. Days use the immutable grant segments.
export async function governmentActivity(pool,{user,from,to,page=1}){
 dayNumber(from);dayNumber(to);if(to<from)throw new ServiceError(400,'Report dates are reversed.');
 return withTransaction(pool,async client=>{
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  const scope=employeeScopeSql(user,'hr_report_read','$1','e');
  const params=[user.id,from,to];
  const common=`FROM hr_gov_requests r JOIN hr_employees e ON e.id=r.employee_id WHERE ${scope}`;
  const summary=(await client.query(`SELECT count(*) FILTER(WHERE r.start_date<=$3 AND r.end_date>=$2)::int AS total,count(*) FILTER(WHERE r.status='pending')::int AS pending,
   count(*) FILTER(WHERE r.status='approved' AND r.start_date<=$3 AND r.end_date>=$2)::int AS approved,count(*) FILTER(WHERE r.status='rejected' AND r.start_date<=$3 AND r.end_date>=$2)::int AS rejected,
   count(*) FILTER(WHERE r.status='cancelled' AND r.start_date<=$3 AND r.end_date>=$2)::int AS cancelled,
   count(*) FILTER(WHERE r.status='pending' AND r.submitted_at<NOW()-INTERVAL '5 days')::int AS overdue,
   count(*) FILTER(WHERE r.status='approved' AND NOT EXISTS(SELECT 1 FROM hr_gov_salary_acknowledgements a WHERE a.request_id=r.id))::int AS salary_unacknowledged
   ${common}`,params)).rows[0];
  const queue=(await client.query(`SELECT s.level,count(*)::int AS applications
   FROM hr_gov_requests r JOIN hr_employees e ON e.id=r.employee_id
   JOIN hr_gov_request_stages s ON s.request_id=r.id AND s.ordinal=r.stage_index
   WHERE ${scope} AND r.status='pending' GROUP BY s.level ORDER BY s.level`,[user.id])).rows;
  const balances=(await client.query(`SELECT t.code,sum(t.balance)::text AS committed,sum(t.held)::text AS held,sum(t.balance-t.held)::text AS available FROM (
   SELECT a.code,COALESCE((SELECT sum(l.amount) FROM hr_gov_ledger l WHERE l.entitlement_id=a.id),0) AS balance,
   COALESCE((SELECT sum(h.amount) FROM hr_gov_reservations h JOIN hr_gov_reservation_requests rq ON rq.id=h.request_id WHERE h.entitlement_id=a.id AND rq.status='held'),0)+
   COALESCE((SELECT sum(h.amount) FROM hr_gov_case_credit_holds h JOIN hr_gov_requests rq ON rq.id=h.request_id WHERE h.entitlement_id=a.id AND rq.status='pending' AND h.determination_id=(SELECT cd.id FROM hr_gov_case_determinations cd WHERE cd.request_id=rq.id ORDER BY version DESC LIMIT 1)),0) AS held
   FROM hr_gov_entitlements a JOIN hr_employees e ON e.id=a.employee_id WHERE ${scope} AND e.status='active'
   AND (NOW() AT TIME ZONE 'Pacific/Nauru')::date BETWEEN a.as_of AND a.period_end)t GROUP BY t.code ORDER BY t.code`,[user.id])).rows;
  const approved=`SELECT r.id,e.display_name AS employee_name,d.name AS department_name,r.code,r.start_date,
   ${effectiveEndSql()} AS effective_end,
   COALESCE(r.grant_snapshot->'evaluation'->'segments',r.grant_snapshot->'case_determination'->'evaluation'->'segments','[]'::jsonb) AS segments
   FROM hr_gov_requests r JOIN hr_employees e ON e.id=r.employee_id LEFT JOIN hr_departments d ON d.id=e.department_id
   WHERE ${scope} AND r.status='approved' AND ${isAbsenceSql()} AND ${effectiveAbsenceSql()} AND r.start_date<=$3 AND ${effectiveEndSql()}>=$2`;
  const rows=(await client.query(`SELECT a.id,a.employee_name,a.department_name,a.code,to_char(a.start_date,'YYYY-MM-DD') AS start_date,
   to_char(a.effective_end,'YYYY-MM-DD') AS end_date,
   COALESCE((SELECT sum((s->>'charge')::numeric) FROM jsonb_array_elements(a.segments)s
    WHERE (s->>'date')::date BETWEEN $2 AND LEAST($3,a.effective_end)),0)::text AS policy_days
   FROM (${approved})a ORDER BY a.employee_name,a.id LIMIT 100 OFFSET $4`,[...params,(page-1)*100])).rows;
  const total=Number((await client.query(`SELECT count(*)::int AS count FROM (${approved})a`,params)).rows[0].count);
  return {from,to,summary,queue,balances,rows,total,page,page_size:100,semantics:'Approved absences overlapping the period. Policy days count dated grant segments within the selected period after approved shortening or cancellation. Financial commitments and attendance cases remain in the Payroll register.'};
 });
}

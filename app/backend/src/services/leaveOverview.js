import {withTransaction} from '../lib/transaction.js';
import {dayNumber} from '../lib/governmentLeaveRules.js';
import {monthsBetween} from '../lib/leaveDates.js';
import {isCentralHr} from './hrAccess.js';
import {ServiceError} from '../lib/serviceError.js';
import {effectiveAbsenceSql,effectiveEndSql,isAbsenceSql} from './governmentLeaveCases.js';

const todaySql="(NOW() AT TIME ZONE 'Pacific/Nauru')::date";
const labelSql=code=>`initcap(replace(${code},'_',' '))`;
// Transfer sources remain immutable. Once imported, only the Government grant
// (including its amendments/cancellation) contributes to the dashboard.
const requestsSql=`requests AS (
 SELECT a.id,a.employee_id,t.name AS leave_type,a.status,a.start_date,a.end_date,
 a.applied_at AS submitted_at,a.reviewed_at AS completed_at,true AS absence,NULL::jsonb AS segments
 FROM hr_leave_applications a JOIN hr_leave_types t ON t.id=a.leave_type_id
 WHERE NOT EXISTS(SELECT 1 FROM hr_gov_legacy_transfers tr JOIN hr_gov_requests gr ON gr.id=tr.request_id WHERE tr.legacy_request_id=a.id)
 UNION ALL
 SELECT r.id,r.employee_id,${labelSql('r.code')},r.status,r.start_date,${effectiveEndSql()},
 r.submitted_at,r.completed_at,(${isAbsenceSql()} AND ${effectiveAbsenceSql()}),
 COALESCE(r.grant_snapshot->'evaluation'->'segments',r.grant_snapshot->'case_determination'->'evaluation'->'segments','[]'::jsonb)
 FROM hr_gov_requests r
), days AS (
 SELECT r.id,r.employee_id,r.leave_type,day::date AS day,1::numeric AS charge
 FROM requests r CROSS JOIN LATERAL generate_series(GREATEST(r.start_date,LEAST($1::date,${todaySql})),LEAST(r.end_date,GREATEST($2::date,${todaySql}+30)),INTERVAL '1 day') day
 WHERE r.status='approved' AND r.absence AND r.segments IS NULL AND EXTRACT(ISODOW FROM day)<6
 AND NOT EXISTS(SELECT 1 FROM hr_public_holidays h WHERE h.holiday_date=day::date)
 UNION ALL
 SELECT r.id,r.employee_id,r.leave_type,(s->>'date')::date,COALESCE((s->>'charge')::numeric,0)
 FROM requests r CROSS JOIN LATERAL jsonb_array_elements(r.segments) s
 WHERE r.status='approved' AND r.absence AND (s->>'date')::date BETWEEN r.start_date AND r.end_date
 AND (s->>'date')::date BETWEEN LEAST($1::date,${todaySql}) AND GREATEST($2::date,${todaySql}+30)
 AND (COALESCE((s->>'charge')::numeric,0)>0 OR (COALESCE((s->>'scheduled_hours')::numeric,0)>0 AND NOT COALESCE((s->>'holiday')::boolean,false)))
)`;

// Stock is read from the current service-year accounts, not the retained legacy
// balance of migrated staff. Held credit includes both requests and cash cases.
const balancesSql=`balances AS (
 SELECT e.id AS employee_id,t.name AS leave_type,
 COALESCE(b.balance,CASE WHEN t.is_accruable THEN 0 ELSE t.default_days END)::numeric AS balance,
 COALESCE(b.pending,0)::numeric AS pending,t.is_accruable,t.default_days
 FROM hr_employees e CROSS JOIN hr_leave_types t
 LEFT JOIN hr_leave_balances b ON b.employee_id=e.id AND b.leave_type_id=t.id AND b.year=EXTRACT(YEAR FROM ${todaySql})
 WHERE e.status='active' AND e.leave_entitled AND e.leave_policy_regime<>'government' AND t.is_active
 UNION ALL
 SELECT e.id,${labelSql('a.code')},COALESCE((SELECT sum(l.amount) FROM hr_gov_ledger l WHERE l.entitlement_id=a.id),0),
 COALESCE((SELECT sum(h.amount) FROM hr_gov_reservations h JOIN hr_gov_reservation_requests rq ON rq.id=h.request_id WHERE h.entitlement_id=a.id AND rq.status='held'),0)+
 COALESCE((SELECT sum(h.amount) FROM hr_gov_case_credit_holds h JOIN hr_gov_requests rq ON rq.id=h.request_id WHERE h.entitlement_id=a.id AND rq.status='pending' AND h.determination_id=(SELECT cd.id FROM hr_gov_case_determinations cd WHERE cd.request_id=rq.id ORDER BY version DESC LIMIT 1)),0),
 a.code='recreation',(p.rules->>(a.code||'_annual_days'))::numeric
 FROM hr_gov_entitlements a JOIN hr_employees e ON e.id=a.employee_id JOIN hr_gov_policy_versions p ON p.id=a.policy_version_id
 WHERE e.status='active' AND e.leave_entitled AND e.leave_policy_regime='government' AND ${todaySql} BETWEEN a.as_of AND a.period_end
)`;
function central(user){if(!isCentralHr(user))throw new ServiceError(403,'Central HR authority is required.');}
function dates(from,to){
 try{dayNumber(from);dayNumber(to);}catch(error){throw new ServiceError(400,error.message);}
 if(to<from)throw new ServiceError(400,'Overview dates are reversed.');
}
const numericRows=(rows,keys)=>rows.map(row=>({...row,...Object.fromEntries(keys.map(key=>[key,Number(row[key])]))}));

export async function leavePlanning(pool,{user}){
 central(user);
 const {rows}=await pool.query(`WITH ${balancesSql} SELECT e.id,e.display_name,e.department_code,e.division_code,
 COALESCE(jsonb_object_agg(b.leave_type,jsonb_build_object('balance',b.balance,'pending',b.pending)) FILTER(WHERE b.leave_type IS NOT NULL),'{}'::jsonb) AS balances
 FROM hr_employees e LEFT JOIN balances b ON b.employee_id=e.id WHERE e.status='active' AND e.leave_entitled
 GROUP BY e.id ORDER BY e.display_name`);
 return {year:Number(new Date(Date.now()+12*3600000).getUTCFullYear()),employees:rows};
}

export async function leaveOverview(pool,{user,from,to}){
 central(user);dates(from,to);
 return withTransaction(pool,async client=>{
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const params=[from,to];
  const query=sql=>client.query(`WITH ${requestsSql} ${sql}`,params);
  const head=(await query(`SELECT
   (SELECT count(*)::int FROM hr_employees WHERE status='active') AS active_employees,
   (SELECT count(DISTINCT employee_id)::int FROM (
    SELECT r.employee_id FROM requests r JOIN hr_employees e ON e.id=r.employee_id WHERE e.status='active' AND r.status='approved' AND r.absence AND ${todaySql} BETWEEN r.start_date AND r.end_date
    UNION SELECT id FROM hr_employees WHERE status='active' AND NOT leave_entitled AND ineligible_reason='study_leave' AND study_leave_start<=${todaySql} AND (study_leave_end IS NULL OR study_leave_end>=${todaySql})
   ) away) AS on_leave_today,
   (SELECT count(*)::int FROM hr_employees WHERE status='active' AND NOT leave_entitled AND ineligible_reason='study_leave' AND study_leave_start<=${todaySql} AND (study_leave_end IS NULL OR study_leave_end>=${todaySql})) AS on_study_leave`)).rows[0];
  const apps=(await query(`SELECT count(*)::int AS total,
   count(*) FILTER(WHERE status='pending')::int AS pending,count(*) FILTER(WHERE status='approved')::int AS approved,
   count(*) FILTER(WHERE status='rejected')::int AS rejected,count(*) FILTER(WHERE status='cancelled')::int AS cancelled,
   AVG(EXTRACT(EPOCH FROM(completed_at-submitted_at))/3600) AS avg_turnaround_hours
   FROM requests WHERE (submitted_at AT TIME ZONE 'Pacific/Nauru')::date BETWEEN $1 AND $2`)).rows[0];
  const usage=`FROM days d JOIN hr_employees e ON e.id=d.employee_id WHERE d.day BETWEEN $1 AND $2`;
  const types=(await query(`SELECT leave_type,sum(charge) AS days,count(DISTINCT d.id) FILTER(WHERE charge>0)::int AS count ${usage} GROUP BY leave_type HAVING sum(charge)>0 ORDER BY days DESC,leave_type`)).rows;
  const departments=(await query(`SELECT COALESCE(e.department_code,'Unassigned') AS department_code,sum(charge) AS days,count(DISTINCT d.id) FILTER(WHERE charge>0)::int AS count ${usage} GROUP BY 1 HAVING sum(charge)>0 ORDER BY days DESC,department_code`)).rows;
  const monthly=(await query(`SELECT to_char(d.day,'YYYY-MM') AS month,sum(charge) AS days,count(DISTINCT d.id) FILTER(WHERE charge>0)::int AS count ${usage} GROUP BY 1 ORDER BY 1`)).rows;
  const upcoming=(await query(`SELECT e.display_name AS employee_name,r.leave_type AS leave_type_name,to_char(r.start_date,'YYYY-MM-DD') AS start_date,to_char(r.end_date,'YYYY-MM-DD') AS end_date,
   CASE WHEN r.segments IS NULL THEN (SELECT count(*) FROM generate_series(r.start_date,r.end_date,INTERVAL '1 day') day WHERE EXTRACT(ISODOW FROM day)<6 AND NOT EXISTS(SELECT 1 FROM hr_public_holidays h WHERE h.holiday_date=day::date))
   ELSE COALESCE((SELECT sum((s->>'charge')::numeric) FROM jsonb_array_elements(r.segments)s WHERE (s->>'date')::date BETWEEN r.start_date AND r.end_date),0) END AS days
   FROM requests r JOIN hr_employees e ON e.id=r.employee_id WHERE e.status='active' AND r.status='approved' AND r.absence AND r.start_date BETWEEN ${todaySql}+1 AND ${todaySql}+30 ORDER BY r.start_date,e.display_name LIMIT 10`)).rows;
  const pending=(await query(`SELECT count(*)::int AS pending_approvals,count(*) FILTER(WHERE submitted_at<NOW()-INTERVAL '5 days')::int AS pending_over_five_days,
   COALESCE(max(EXTRACT(EPOCH FROM(NOW()-submitted_at))/86400),0) AS oldest_pending_days FROM requests WHERE status='pending'`)).rows[0];
  const stock=await client.query(`WITH ${balancesSql} SELECT leave_type,sum(GREATEST(balance-pending,0)) AS available_days FROM balances GROUP BY leave_type ORDER BY available_days DESC`);
  const negative=await client.query(`WITH ${balancesSql} SELECT count(DISTINCT employee_id)::int AS count FROM balances WHERE balance-pending<0`);
  // Retain the established API fields for older reporting clients. They use
  // the same current accounts; the dashboard presents recreation planning KPIs.
  const excess=await client.query(`WITH ${balancesSql}, excess_people AS(
   SELECT DISTINCT e.id,e.display_name FROM balances b JOIN hr_employees e ON e.id=b.employee_id
   WHERE b.is_accruable AND b.default_days>0 AND b.balance-b.pending>2*b.default_days)
   SELECT count(*)::int AS count,COALESCE((SELECT jsonb_agg(display_name ORDER BY display_name) FROM(SELECT display_name FROM excess_people ORDER BY display_name LIMIT 3) sample),'[]'::jsonb) AS names FROM excess_people`);
  const liability=await client.query(`WITH ${balancesSql} SELECT
   COALESCE(sum(GREATEST(b.balance-b.pending,0)*e.daily_rate),0) AS value,
   COALESCE(sum(GREATEST(b.balance-b.pending,0)) FILTER(WHERE e.daily_rate IS NOT NULL),0) AS days,
   count(DISTINCT e.id) FILTER(WHERE e.daily_rate IS NULL)::int AS staff_without_rate,count(DISTINCT e.id)::int AS staff_total
   FROM balances b JOIN hr_employees e ON e.id=b.employee_id WHERE b.is_accruable`);
  const study=await client.query(`SELECT count(*)::int AS count,COALESCE((jsonb_agg(display_name ORDER BY display_name))->0,'null'::jsonb) AS first_name FROM hr_employees WHERE status='active' AND NOT leave_entitled AND ineligible_reason='study_leave' AND study_leave_end<${todaySql}`);
  const coverage=(await query(`, sizes AS(SELECT COALESCE(department_code,'Unassigned') AS department_code,count(*) AS headcount FROM hr_employees WHERE status='active' GROUP BY 1),
   away AS(SELECT employee_id,day FROM days WHERE day BETWEEN ${todaySql} AND ${todaySql}+30
    UNION SELECT e.id,day::date FROM hr_employees e CROSS JOIN LATERAL generate_series(GREATEST(e.study_leave_start,${todaySql}),LEAST(COALESCE(e.study_leave_end,${todaySql}+30),${todaySql}+30),INTERVAL '1 day') day
    WHERE e.status='active' AND NOT e.leave_entitled AND e.ineligible_reason='study_leave' AND EXTRACT(ISODOW FROM day)<6),
   counts AS(SELECT COALESCE(e.department_code,'Unassigned') AS department_code,a.day,count(DISTINCT e.id) AS people_out FROM away a JOIN hr_employees e ON e.id=a.employee_id WHERE e.status='active' GROUP BY 1,2)
   SELECT c.department_code,to_char(c.day,'YYYY-MM-DD') AS day,c.people_out,s.headcount,round(c.people_out*100.0/s.headcount) AS percent_out FROM counts c JOIN sizes s USING(department_code) WHERE c.people_out*3>s.headcount ORDER BY percent_out DESC,c.day,c.department_code LIMIT 5`)).rows;
  const byType=numericRows(types,['days','count']);
  const monthlyMap=new Map(numericRows(monthly,['days','count']).map(r=>[r.month,r]));
  return {from,to,headcount:head,applications:{...apps,avg_turnaround_hours:apps.avg_turnaround_hours===null?null:Number(apps.avg_turnaround_hours)},days_taken:byType.reduce((n,r)=>n+r.days,0),
   by_type:byType,by_department:numericRows(departments,['days','count']),monthly_trend:monthsBetween(from,to).map(month=>({month,days:monthlyMap.get(month)?.days||0,count:monthlyMap.get(month)?.count||0})),
   liability:numericRows(liability.rows,['value','days','staff_without_rate','staff_total'])[0],
   upcoming:numericRows(upcoming,['days']),balance_by_type:numericRows(stock.rows,['available_days']),
   exceptions:{...pending,oldest_pending_days:Number(pending.oldest_pending_days),negative_balances:negative.rows[0].count,excess_balances:excess.rows[0].count,excess_employee_names:excess.rows[0].names,study_leave_return_due:study.rows[0].count,study_leave_return_names:study.rows[0].first_name?[study.rows[0].first_name]:[],coverage_risks:numericRows(coverage,['people_out','headcount','percent_out'])}};
 });
}
export async function leaveOverviewBreakdown(pool,{user,from,to,dimension,value}){
 central(user);dates(from,to);
 if(!['department','leave_type'].includes(dimension))throw new ServiceError(400,'Choose a valid overview dimension.');
 const {rows}=await pool.query(`WITH ${requestsSql} SELECT e.display_name AS employee_name,COALESCE(e.department_code,'Unassigned') AS department_code,d.leave_type AS leave_type_name,
 sum(d.charge) AS days,count(DISTINCT d.id) FILTER(WHERE d.charge>0)::int AS applications
 FROM days d JOIN hr_employees e ON e.id=d.employee_id WHERE d.day BETWEEN $1 AND $2 AND ${dimension==='department'?"COALESCE(e.department_code,'Unassigned')":'d.leave_type'}=$3
 GROUP BY e.id,d.leave_type HAVING sum(d.charge)>0 ORDER BY days DESC,e.display_name`,[from,to,value]);
 return {dimension,value,rows:numericRows(rows,['days'])};
}

import { ServiceError } from '../lib/serviceError.js';
import { isCentralHr } from './hrAccess.js';

/**
 * The leave calendar has two views.
 *
 * - `team` (everyone): the caller's own team, which is their division and the
 *   divisions under it, or their whole department when they have no division.
 *   Colleagues' leave shows dates and status but not its type ("On leave"), so
 *   sick or medical leave is not disclosed. Study leave is not private and
 *   shows as study leave. The caller's own leave keeps its type.
 * - `all` (Central HR only): every department, with leave types.
 *
 * Both calendar endpoints use this, so the rule lives in one place.
 */
export const CALENDAR_VIEWS = ['team', 'all'];
export const MASKED_LEAVE_LABEL = 'On leave';

/** Whether employee `other` is in the team of employee `me`. */
const teamMatchSql = (me, other) => `${me}.department_id IS NOT NULL AND ${me}.department_id=${other}.department_id
  AND (${me}.division_id IS NULL OR ${me}.division_id=${other}.division_id
    OR ${me}.division_id=(SELECT v.parent_division_id FROM hr_divisions v WHERE v.id=${other}.division_id))`;

/** The person's department and division names, for grouping rows. */
export const unitNamesSql = (alias = 'e') =>
  `(SELECT d.name FROM hr_departments d WHERE d.id=${alias}.department_id) AS department_name,
   (SELECT v.name FROM hr_divisions v WHERE v.id=${alias}.division_id) AS division_name`;

/**
 * SQL for one view. `where` limits the rows; `own` is true for the caller's
 * own employee record; `masked` is true where an application's type must be
 * hidden. Every parameter is referenced in every view, so callers pass the
 * same list whichever view was asked for.
 */
export function calendarAudienceSql(user, view, { userParam, departmentParam, divisionParam, alias = 'e' }) {
  if (view === 'all' && !isCentralHr(user)) throw new ServiceError(403, 'All departments is for Central HR.');
  const me = `SELECT 1 FROM hr_employees me WHERE me.reviewer_id=${userParam} AND me.status='active'`;
  const own = `EXISTS(${me} AND me.id=${alias}.id)`;
  const unitFilter = `(${departmentParam}::uuid IS NULL OR ${alias}.department_id=${departmentParam})
    AND (${divisionParam}::uuid IS NULL OR ${alias}.division_id=${divisionParam})`;
  const audience = view === 'all'
    ? `(${userParam}::uuid IS NOT NULL)`
    : `(${own} OR (${alias}.status='active' AND EXISTS(${me} AND ${teamMatchSql('me', alias)})))`;
  return {
    where: `(${audience} AND ${unitFilter})`,
    own,
    masked: view === 'team' ? `NOT ${own}` : 'FALSE',
  };
}

/**
 * The caller's team for the team calendar: its name and every active member,
 * so people with no leave show as available. Names and units only.
 */
export async function teamRoster(pool, reviewerId) {
  const { rows: [me] } = await pool.query(
    `SELECT e.id, e.display_name, e.department_id, d.name AS department_name, v.name AS division_name
       FROM hr_employees e LEFT JOIN hr_departments d ON d.id = e.department_id LEFT JOIN hr_divisions v ON v.id = e.division_id
      WHERE e.reviewer_id = $1 AND e.status = 'active' ORDER BY e.id LIMIT 1`, [reviewerId]);
  if (!me) return { name: null, members: [] };
  const { rows } = await pool.query(
    `SELECT o.id AS employee_id, o.display_name AS name, o.id = me.id AS own, ${unitNamesSql('o')}
       FROM hr_employees o JOIN hr_employees me ON me.id = $1
      WHERE o.status = 'active' AND (o.id = me.id OR (${teamMatchSql('me', 'o')}))
      ORDER BY lower(o.display_name)`, [me.id]);
  return { name: me.division_name || me.department_name, members: rows };
}

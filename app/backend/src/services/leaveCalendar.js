import { employeeReadSql } from './hrAccess.js';

/**
 * The leave calendar's three audiences.
 *
 * - `mine`: the caller's own leave, with its real leave type.
 * - `team`: everyone in the caller's own unit (their division, or their whole
 *   department when they have no division), open to every member of staff so
 *   a team can plan around each other. Only dates and status are shared:
 *   anyone else's leave reads "On leave", never its type, so sick or medical
 *   leave is not disclosed to colleagues.
 * - `scope`: the people the caller is responsible for (direct reports, an HR
 *   scope, or everyone for central HR) plus themselves. This was the only
 *   view before, and stays the default for existing callers.
 */
export const CALENDAR_VIEWS = ['mine', 'team', 'scope'];
export const MASKED_LEAVE_LABEL = 'On leave';

/**
 * SQL for one view. `where` limits the rows; `own` is true for the caller's
 * own employee record; `masked` is true where the leave type must be hidden.
 * Every parameter is referenced in every view, so callers can pass the same
 * list whichever view was asked for.
 */
export function calendarAudienceSql(user, view, { userParam, departmentParam, divisionParam, alias = 'e' }) {
  const me = `SELECT 1 FROM hr_employees me WHERE me.reviewer_id=${userParam} AND me.status='active'`;
  const own = `EXISTS(${me} AND me.id=${alias}.id)`;
  const unitFilter = `(${departmentParam}::uuid IS NULL OR ${alias}.department_id=${departmentParam})
    AND (${divisionParam}::uuid IS NULL OR ${alias}.division_id=${divisionParam})`;
  let audience;
  if (view === 'mine') {
    audience = own;
  } else if (view === 'team') {
    audience = `(${own} OR (${alias}.status='active' AND EXISTS(${me} AND me.department_id IS NOT NULL
      AND me.department_id=${alias}.department_id AND (me.division_id IS NULL OR me.division_id=${alias}.division_id))))`;
  } else {
    audience = employeeReadSql(user, userParam, alias, true);
  }
  return {
    where: `(${audience} AND ${unitFilter})`,
    own,
    masked: view === 'team' ? `NOT ${own}` : 'FALSE',
  };
}

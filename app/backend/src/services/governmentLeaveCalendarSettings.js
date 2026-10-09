import {withTransaction} from '../lib/transaction.js';
import {ServiceError} from '../lib/serviceError.js';
import {isCentralHr} from './hrAccess.js';
import {recordAudit} from './auditService.js';

export async function calendarSettings(client){
 return (await client.query('SELECT require_calendar_coverage,revision FROM hr_gov_calendar_settings WHERE id=TRUE')).rows[0];
}
export async function updateCalendarSettings(pool,{user,actor,data}){
 if(!isCentralHr(user))throw new ServiceError(403,'Only an administrator can change calendar requirements.');
 if(typeof data.require_calendar_coverage!=='boolean'||!Number.isInteger(data.expected_revision))throw new ServiceError(400,'Choose the calendar requirement and reload its current setting.');
 return withTransaction(pool,async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext('hr-gov-calendars'))");
  const before=(await client.query('SELECT * FROM hr_gov_calendar_settings WHERE id=TRUE FOR UPDATE')).rows[0];
  if(before.revision!==data.expected_revision)throw new ServiceError(409,'The calendar setting changed. Refresh and choose again.');
  if(before.require_calendar_coverage===data.require_calendar_coverage)return calendarSettings(client);
  await client.query('UPDATE hr_gov_calendar_settings SET require_calendar_coverage=$1,revision=revision+1,updated_by=$2,updated_at=NOW() WHERE id=TRUE',[data.require_calendar_coverage,actor.id]);
  const after=await calendarSettings(client);
  await recordAudit({client,actor,action:'hr.gov.calendar_requirement.changed',entityType:'hr_gov_calendar_settings',entityId:'shared',before:{require_calendar_coverage:before.require_calendar_coverage,revision:before.revision},after});
  return after;
 });
}

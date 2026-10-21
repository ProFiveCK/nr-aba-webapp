import {pool} from '../src/db.js';
import {repairApprovedLwopRoute} from '../src/services/governmentLeaveRouteRepair.js';

const [id,expectedRouteId,...flags]=process.argv.slice(2);
try{
 if(!/^[0-9a-f-]{36}$/i.test(id||'')||!/^[0-9a-f-]{36}$/i.test(expectedRouteId||'')||flags.some(flag=>flag!=='--apply'))throw new Error('Usage: node scripts/repair-lwop-route.js REQUEST_ID EXPECTED_ROUTE_ID [--apply]');
 console.log(JSON.stringify(await repairApprovedLwopRoute(pool,{id,expectedRouteId,apply:flags.includes('--apply')}),null,2));
}catch(error){console.error(error.message);process.exitCode=1;}finally{await pool.end();}

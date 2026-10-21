import {readFile} from 'node:fs/promises';
import {pool} from '../src/db.js';
import {simplifyPendingApprovals} from '../src/services/governmentLeavePendingSimplification.js';
try{
 const flags=process.argv.slice(2);
 if(flags.length&&!(flags.length===2&&flags[0]==='--apply'))throw new Error('Usage: node scripts/simplify-pending-approvals.js [--apply DRY_RUN_JSON]');
 const expected=flags.length?JSON.parse(await readFile(flags[1],'utf8')).manifest:null;
 console.log(JSON.stringify(await simplifyPendingApprovals(pool,{apply:!!flags.length,expected}),null,2));
}catch(error){console.error(error.message);process.exitCode=1;}finally{await pool.end();}

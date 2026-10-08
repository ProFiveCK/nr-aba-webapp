// Only the isolated production COPY mounts this gateway. No demo personnel seed.
import express from 'express';
import {randomUUID} from 'node:crypto';
import {pool} from './src/db.js';
import * as auth from './src/services/authService.js';
import {localProductionReview} from './src/services/localReviewMode.js';
if(!localProductionReview)throw new Error('Isolated production-copy review required.');
if((await pool.query('SELECT current_database() AS name')).rows[0].name!=='leave_production_review')throw new Error('Actual database must be the local copy.');
const email='local-migration-review@localhost.invalid';
const permissions={hr_access:true,hr_admin:true,hr_staff_manage:true,hr_balance_manage:true,hr_leave_approve:true,hr_report_read:true,hr_evidence_read:true};
await pool.query("INSERT INTO reviewers(email,display_name,role,password_hash,permissions) VALUES ($1,'Local migration reviewer','user',$2,$3) ON CONFLICT(email) DO NOTHING",[email,`!local-copy-only:${randomUUID()}`,permissions]);
const app=express();
app.get('/health',(_req,res)=>res.json({ok:true}));
app.get('/review/local',async(_req,res,next)=>{try{
  const {rows:[account]}=await pool.query("SELECT * FROM reviewers WHERE email=$1 AND status='active'",[email]);
  if(!account)return res.status(409).send('Local reviewer inactive.');
  const session=await auth.createSession(account.id);
  auth.setAuthCookie(res,auth.buildTokenPayload(account,session.tokenId,session.expiresAt),session.expiresAt);
  const user=auth.reviewerSummary(account,undefined,await auth.loadCapabilities(account.id));
  res.set('Cache-Control','no-store').type('html').send(`<script>localStorage.setItem('auth_token',${JSON.stringify(JSON.stringify({user,expiresAt:session.expiresAt}))});localStorage.setItem('auth_user',${JSON.stringify(JSON.stringify(user))});localStorage.setItem('auth_expires_at',${JSON.stringify(session.expiresAt.toISOString())});location.replace('/leave/employees');</script>`);
}catch(error){next(error);}});
app.use((_err,_req,res,_next)=>res.status(500).send('Local review sign-in unavailable.'));
app.listen(4001,'0.0.0.0',()=>console.log('Isolated production-copy review gateway ready.'));

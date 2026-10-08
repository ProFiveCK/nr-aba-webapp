// Development-only synthetic login gateway. Never mounted by production Compose.
import express from 'express';
import {seedReview} from './leave-review-seed.mjs';
import {pool} from './src/db.js';
import * as auth from './src/services/authService.js';
if(process.env.NODE_ENV!=='development' || process.env.LEAVE_REVIEW_ONLY!=='synthetic' || process.env.DB_NAME!=='leave_review')throw new Error('Synthetic review configuration required.');
if((await pool.query('SELECT current_database() AS name')).rows[0].name!=='leave_review')throw new Error('The actual database is not the isolated review database.');
await seedReview();
const app=express();
app.get('/review/:persona',async(req,res,next)=>{try {
  const personas={division:{email:'local-government-division@example.test',path:'/leave/approvals'},hod:{email:'local-government-hod@example.test',path:'/leave/approvals'},secretary:{email:'local-government-secretary@example.test',path:'/leave/approvals'},chief:{office:'chief_secretary',path:'/leave/approvals'},certifier:{email:'local-certifier@example.test',path:'/leave/staff'},hr:{email:'local-hr@example.test',path:'/leave/staff'},employee:{alias:'DEMO-1E-00001-A',path:'/leave/my-leave'},scoped:{email:'local-scoped-hr@example.test',path:'/leave/staff'}};
  const persona=personas[req.params.persona];if(!persona)return res.status(404).send('Unknown synthetic persona.');
  const {rows:[account]}=await pool.query("SELECT r.* FROM reviewers r WHERE ($1::text IS NOT NULL AND email=$1 OR $2::text IS NOT NULL AND login_alias=$2 OR $3::text IS NOT NULL AND r.id=(SELECT e.reviewer_id FROM hr_approval_assignments a JOIN hr_employees e ON e.id=a.approver_employee_id WHERE a.level=$3 AND e.status='active' AND a.effective_from<=(NOW() AT TIME ZONE 'Pacific/Nauru')::date AND (a.effective_to IS NULL OR a.effective_to>=(NOW() AT TIME ZONE 'Pacific/Nauru')::date) LIMIT 1)) AND status='active' AND onboarding_state='ready'",[persona.email||null,persona.alias||null,persona.office||null]);
  if(!account)return res.status(409).send('The synthetic account is not active. Restore/activate it using the review HR account.');
  if(account.account_type==='employee' && !(await pool.query("SELECT 1 FROM hr_employees WHERE reviewer_id=$1 AND status='active'",[account.id])).rowCount)return res.status(409).send('The synthetic employee record is inactive.');
  const session=await auth.createSession(account.id);auth.setAuthCookie(res,auth.buildTokenPayload(account,session.tokenId,session.expiresAt),session.expiresAt);
  const user=auth.reviewerSummary(account,undefined,await auth.loadCapabilities(account.id));
  res.set('Cache-Control','no-store').type('html').send(`<script>localStorage.setItem('auth_token',${JSON.stringify(JSON.stringify({user,expiresAt:session.expiresAt}))});localStorage.setItem('auth_user',${JSON.stringify(JSON.stringify(user))});localStorage.setItem('auth_expires_at',${JSON.stringify(session.expiresAt.toISOString())});location.replace(${JSON.stringify(persona.path)});</script>`);
}catch(err){next(err);}});
app.use((_err,_req,res,_next)=>res.status(500).send('Synthetic review sign-in unavailable.'));
app.listen(4001,'0.0.0.0',()=>console.log('Synthetic review login gateway ready.'));

import type {Database} from '../db/client';
import {requireId} from './studio';
// PROT-2: limits on how fast one account can pull question bodies. These are technical safety
// defaults (a student reading at 15 seconds per question), editable by a Super Admin.
export type ProtectionSettings={hourlyQuestionBudget:number;burstQuestions:number;burstMinutes:number};
export const PROTECTION_DEFAULTS:ProtectionSettings={hourlyQuestionBudget:240,burstQuestions:60,burstMinutes:5};
export class QuestionBudgetError extends Error {
 constructor(public retryInMinutes:number){super(`You have reached the hourly question limit. Please take a short break and try again in about ${retryInMinutes} minute${retryInMinutes===1?'':'s'}.`);this.name='QuestionBudgetError';}
}
async function requireSuperAdmin(db:Database,actorId:string) {
 const [actor]=await db.query(`SELECT 1 FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1 AND a.role='super_admin' AND a.status='active' AND u.email_verified=true AND u.two_factor_enabled=true`,[actorId]);
 if(!actor)throw new Error('Only a Super Admin can manage content protection.');
}
async function audit(db:Database,actorId:string,entityId:string,action:string,after:unknown) {
 await db.query('INSERT INTO audit_log(actor_id,entity_id,action,after_json) VALUES($1,$2,$3,$4::jsonb)',[actorId,entityId,action,JSON.stringify(after)]);
}
export async function getProtectionSettings(db:Database):Promise<ProtectionSettings> {
 const [row]=await db.query<{value:Partial<ProtectionSettings>}>(`SELECT value FROM app_settings WHERE key='protection'`);
 return {...PROTECTION_DEFAULTS,...(row?.value??{})};
}
export async function updateProtectionSettings(db:Database,actorId:string,input:ProtectionSettings) {
 const check=(n:number,min:number,max:number,label:string)=>{if(!Number.isInteger(n)||n<min||n>max)throw new Error(`${label} must be between ${min} and ${max}.`);};
 check(input.hourlyQuestionBudget,10,5000,'Hourly question limit');check(input.burstQuestions,5,1000,'Burst question count');check(input.burstMinutes,1,60,'Burst window');
 return db.transaction(async tx=>{
  await requireSuperAdmin(tx,actorId);
  const value={hourlyQuestionBudget:input.hourlyQuestionBudget,burstQuestions:input.burstQuestions,burstMinutes:input.burstMinutes};
  await tx.query(`INSERT INTO app_settings(key,value,updated_by) VALUES('protection',$1::jsonb,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`,[JSON.stringify(value),actorId]);
  await audit(tx,actorId,actorId,'protection.settings_updated',value);
 });
}
// Raises at most one open alert of each kind per account per hour so a scraper cannot flood the queue.
async function raiseAlert(db:Database,userId:string,kind:'hourly_limit'|'burst',details:object) {
 const recent=await db.query(`SELECT 1 FROM security_alerts WHERE user_id=$1 AND kind=$2 AND created_at>now()-interval '1 hour' LIMIT 1`,[userId,kind]);
 if(recent.length)return;
 await db.query('INSERT INTO security_alerts(user_id,kind,details) VALUES($1,$2,$3::jsonb)',[userId,kind,JSON.stringify(details)]);
 console.warn(`[security] ${kind} alert for account ${userId}`);
}
// Called before a question body is returned. Re-opening a question already seen this hour is free;
// each new question counts against the rolling hourly budget.
export async function recordQuestionView(db:Database,userId:string,questionId:string,attemptId:string) {
 const settings=await getProtectionSettings(db);
 const [usage]=await db.query<{distinct_hour:number;seen:boolean;oldest:string|null}>(`SELECT count(DISTINCT question_id)::int AS distinct_hour,bool_or(question_id=$2) AS seen,min(viewed_at)::text AS oldest FROM question_views WHERE user_id=$1 AND viewed_at>now()-interval '1 hour'`,[userId,questionId]);
 if(!usage.seen&&usage.distinct_hour>=settings.hourlyQuestionBudget) {
  await raiseAlert(db,userId,'hourly_limit',{limit:settings.hourlyQuestionBudget,questionsLastHour:usage.distinct_hour});
  const retry=usage.oldest?Math.max(1,Math.ceil((Date.parse(usage.oldest)+3600000-Date.now())/60000)):60;
  throw new QuestionBudgetError(retry);
 }
 await db.query('INSERT INTO question_views(user_id,question_id,attempt_id) VALUES($1,$2,$3)',[userId,questionId,attemptId]);
 if(usage.seen)return;
 const [burst]=await db.query<{n:number}>(`SELECT count(DISTINCT question_id)::int AS n FROM question_views WHERE user_id=$1 AND viewed_at>now()-make_interval(mins=>$2)`,[userId,settings.burstMinutes]);
 if(burst.n>settings.burstQuestions)await raiseAlert(db,userId,'burst',{questions:burst.n,minutes:settings.burstMinutes,threshold:settings.burstQuestions});
}
export type SecurityAlert={id:string;userId:string;email:string;name:string;status:string;kind:string;details:Record<string,number>;createdAt:string;resolvedAt:string|null;resolution:string|null};
export async function listSecurityAlerts(db:Database,actorId:string,includeResolved=false):Promise<SecurityAlert[]> {
 await requireSuperAdmin(db,actorId);
 return db.query<SecurityAlert>(`SELECT s.id,s.user_id AS "userId",u.email,u.name,a.status,s.kind,s.details,s.created_at::text AS "createdAt",s.resolved_at::text AS "resolvedAt",s.resolution FROM security_alerts s JOIN app_users a ON a.id=s.user_id JOIN auth_users u ON u.id=a.auth_id ${includeResolved?'':'WHERE s.resolved_at IS NULL'} ORDER BY s.created_at DESC LIMIT 100`);
}
export async function resolveSecurityAlert(db:Database,actorId:string,alertId:string,resolution:string) {
 requireId(alertId);
 if(!resolution.trim()||resolution.length>500)throw new Error('Record what was decided (up to 500 characters).');
 return db.transaction(async tx=>{
  await requireSuperAdmin(tx,actorId);
  const rows=await tx.query('UPDATE security_alerts SET resolved_at=now(),resolved_by=$2,resolution=$3 WHERE id=$1 AND resolved_at IS NULL RETURNING id',[alertId,actorId,resolution.trim()]);
  if(!rows.length)throw new Error('This alert is already resolved.');
  await audit(tx,actorId,alertId,'security_alert.resolved',{resolution:resolution.trim()});
 });
}
export type TracedAccount={id:string;email:string;name:string;role:string;status:string;suspendedReason:string|null;createdAt:string;viewsLast24h:number;viewsLast7d:number;attempts:number;openAlerts:number;lastViewAt:string|null};
// PROT-5 leak tracing: the watermark shows the account email and the first 8 characters of its ID.
export async function traceAccount(db:Database,actorId:string,query:string):Promise<TracedAccount[]> {
 await requireSuperAdmin(db,actorId);
 const q=query.trim().toLowerCase().replace(/^.*·\s*/,'');
 const byId=/^[0-9a-f]{8}(?:-[0-9a-f-]{0,28})?$/.test(q),byEmail=q.includes('@');
 if(!byId&&!byEmail)throw new Error('Enter an email address or the 8-character account ID from a watermark.');
 return db.query<TracedAccount>(`SELECT a.id,u.email,u.name,a.role,a.status,a.suspended_reason AS "suspendedReason",a.created_at::text AS "createdAt",
  (SELECT count(*)::int FROM question_views v WHERE v.user_id=a.id AND v.viewed_at>now()-interval '1 day') AS "viewsLast24h",
  (SELECT count(*)::int FROM question_views v WHERE v.user_id=a.id AND v.viewed_at>now()-interval '7 days') AS "viewsLast7d",
  (SELECT count(*)::int FROM practice_attempts p WHERE p.user_id=a.id) AS attempts,
  (SELECT count(*)::int FROM security_alerts s WHERE s.user_id=a.id AND s.resolved_at IS NULL) AS "openAlerts",
  (SELECT max(viewed_at)::text FROM question_views v WHERE v.user_id=a.id) AS "lastViewAt"
  FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE ${byId?`a.id::text LIKE $1||'%'`:'lower(u.email)=$1'} ORDER BY a.created_at LIMIT 10`,[q]);
}
export async function suspendAccount(db:Database,actorId:string,userId:string,reason:string) {
 requireId(userId);
 if(!reason.trim()||reason.length>500)throw new Error('Give a reason for the suspension (up to 500 characters).');
 if(userId===actorId)throw new Error('You cannot suspend your own account.');
 return db.transaction(async tx=>{
  await requireSuperAdmin(tx,actorId);
  const [user]=await tx.query<{auth_id:string;status:string;role:string}>('SELECT auth_id,status,role FROM app_users WHERE id=$1 FOR UPDATE',[userId]);
  if(!user)throw new Error('Account not found.');
  if(user.status==='suspended')throw new Error('This account is already suspended.');
  if(user.role==='super_admin')throw new Error('Super Admin accounts cannot be suspended here.');
  await tx.query(`UPDATE app_users SET status='suspended',suspended_at=now(),suspended_reason=$2 WHERE id=$1`,[userId,reason.trim()]);
  // Ending every session signs the account out everywhere immediately.
  await tx.query('DELETE FROM auth_sessions WHERE user_id=$1',[user.auth_id]);
  await audit(tx,actorId,userId,'account.suspended',{reason:reason.trim()});
 });
}
export async function reinstateAccount(db:Database,actorId:string,userId:string) {
 requireId(userId);
 return db.transaction(async tx=>{
  await requireSuperAdmin(tx,actorId);
  const rows=await tx.query(`UPDATE app_users SET status='active',suspended_at=NULL,suspended_reason=NULL WHERE id=$1 AND status='suspended' RETURNING id`,[userId]);
  if(!rows.length)throw new Error('This account is not suspended.');
  await audit(tx,actorId,userId,'account.reinstated',{});
 });
}
export async function isSuspendedAuthUser(db:Database,authId:string) {
 return (await db.query(`SELECT 1 FROM app_users WHERE auth_id=$1 AND status IN ('suspended','deleted')`,[authId])).length>0;
}

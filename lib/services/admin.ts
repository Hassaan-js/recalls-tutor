import type {Database} from '../db/client';
import {requireId,requireStaff} from './studio';
// Admin portal: the overview (ADM-1), students (ADM-3), and team, roles and the audit log (ADM-4).
// Money and personal data are Super Admin only, with the same MFA rule as Billing and Content protection.
export type Role='student'|'reviewer'|'content_manager'|'super_admin';
const ROLES:Role[]=['student','reviewer','content_manager','super_admin'];
const LIVE_SUB=`s.status IN ('active','trialing','past_due') AND s.access_hold IS NULL`;
// Paid and granted access, as the practice engine reads it; trials are their own path.
const ACCESS_SOURCES=`('subscription','partner','complimentary')`;
export async function requireSuperAdmin(db:Database,actorId:string) {
 const [actor]=await db.query(`SELECT 1 FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1 AND a.role='super_admin' AND a.status='active' AND u.email_verified=true AND u.two_factor_enabled=true FOR SHARE OF a`,[actorId]);
 if(!actor)throw new Error('Only a Super Admin can do this.');
}
async function audit(db:Database,actorId:string,entityId:string,action:string,before:unknown,after:unknown) {
 await db.query('INSERT INTO audit_log(actor_id,entity_id,action,before_json,after_json) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',[actorId,entityId,action,JSON.stringify(before),JSON.stringify(after)]);
}
export type Overview={
 students:{total:number;verified:number;new7d:number;new30d:number;active7d:number};
 access:{paying:number;trials:number;complimentary:number;renewalsDue14d:number;pastDue:number};
 money:{mrrCents:number;newValue30dCents:number;refunds30d:number}|null;
 content:{inReview:number;approved:number;published:number;jobsRunning:number;jobsFailed7d:number};
 attention:{reports:number;securityAlerts:number;billingAlerts:number;failedWebhooks:number};
 signups:{day:string;n:number}[]};
export async function getOverview(db:Database,actorId:string):Promise<Overview> {
 const role=await requireStaff(db,actorId);
 const one=async<T extends Record<string,unknown>>(sql:string,params:unknown[]=[])=>(await db.query<T>(sql,params))[0];
 const [students,access,content,attention,signups]=await Promise.all([
  one<Overview['students']>(`SELECT count(*)::int AS total,count(*) FILTER (WHERE u.email_verified)::int AS verified,count(*) FILTER (WHERE a.created_at>now()-interval '7 days')::int AS new7d,count(*) FILTER (WHERE a.created_at>now()-interval '30 days')::int AS new30d,
   count(*) FILTER (WHERE EXISTS(SELECT 1 FROM practice_items i JOIN practice_attempts p ON p.id=i.attempt_id WHERE p.user_id=a.id AND i.answered_at>now()-interval '7 days'))::int AS active7d
   FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.role='student' AND a.status<>'deleted'`),
  one<Overview['access']>(`SELECT (SELECT count(DISTINCT s.user_id)::int FROM subscriptions s WHERE ${LIVE_SUB}) AS paying,
   (SELECT count(*)::int FROM trials t WHERE t.ends_at>now()) AS trials,
   (SELECT count(DISTINCT n.user_id)::int FROM entitlements n WHERE n.source='complimentary' AND n.revoked_at IS NULL AND n.starts_at<=now() AND n.ends_at>now()) AS complimentary,
   (SELECT count(*)::int FROM subscriptions s WHERE ${LIVE_SUB} AND NOT s.cancel_at_period_end AND s.current_period_end BETWEEN now() AND now()+interval '14 days') AS "renewalsDue14d",
   (SELECT count(*)::int FROM subscriptions s WHERE s.status='past_due') AS "pastDue"`),
  one<Overview['content']>(`SELECT count(*) FILTER (WHERE status='in_review')::int AS "inReview",count(*) FILTER (WHERE status='approved')::int AS approved,count(*) FILTER (WHERE status='published')::int AS published,
   (SELECT count(*)::int FROM studio_jobs WHERE status NOT IN ('ready','failed')) AS "jobsRunning",(SELECT count(*)::int FROM studio_jobs WHERE status='failed' AND created_at>now()-interval '7 days') AS "jobsFailed7d" FROM questions`),
  one<Overview['attention']>(`SELECT (SELECT count(*)::int FROM question_reports WHERE status='open') AS reports,(SELECT count(*)::int FROM security_alerts WHERE resolved_at IS NULL) AS "securityAlerts",
   (SELECT count(*)::int FROM billing_alerts WHERE resolved_at IS NULL) AS "billingAlerts",(SELECT count(*)::int FROM webhook_events WHERE processed_at IS NULL) AS "failedWebhooks"`),
  db.query<{day:string;n:number}>(`SELECT d::date::text AS day,(SELECT count(*)::int FROM app_users a WHERE a.role='student' AND a.created_at::date=d::date) AS n FROM generate_series(current_date-13,current_date,interval '1 day') d ORDER BY d`),
 ]);
 // Plan prices are the only money the app holds; Stripe stays the source of truth for collected revenue.
 const money=role==='super_admin'?await one<NonNullable<Overview['money']>>(`SELECT COALESCE(sum(round(p.price_cents::numeric/p.months)) FILTER (WHERE ${LIVE_SUB} AND NOT s.cancel_at_period_end),0)::int AS "mrrCents",
  COALESCE(sum(p.price_cents) FILTER (WHERE s.created_at>now()-interval '30 days' AND s.access_hold IS NULL),0)::int AS "newValue30dCents",
  count(*) FILTER (WHERE s.access_hold='refunded' AND s.updated_at>now()-interval '30 days')::int AS "refunds30d" FROM subscriptions s JOIN plans p ON p.id=s.plan_id`):null;
 return {students,access,money,content,attention,signups};
}
export type StudentFilter='all'|'paying'|'trial'|'complimentary'|'none'|'suspended';
export type StudentRow={id:string;name:string;email:string;verified:boolean;status:string;joinedAt:string;lastActiveAt:string|null;access:string|null;accessUntil:string|null;answered:number};
export const STUDENT_PAGE=50;
export async function listStudents(db:Database,actorId:string,options:{query?:string;filter?:StudentFilter;page?:number}={}) {
 await requireSuperAdmin(db,actorId);
 const q=(options.query??'').trim().toLowerCase().slice(0,200),filter=options.filter??'all',page=Math.max(1,Math.floor(options.page??1));
 const current=`(SELECT n.source FROM entitlements n WHERE n.user_id=a.id AND n.revoked_at IS NULL AND n.starts_at<=now() AND n.ends_at>now() ORDER BY (n.source='subscription') DESC,(n.source='trial'),n.ends_at DESC LIMIT 1)`;
 const where={all:'true',paying:`access='subscription'`,trial:`access='trial'`,complimentary:`access IN ('complimentary','partner')`,none:'access IS NULL',suspended:`status='suspended'`}[filter]??'true';
 const rows=await db.query<StudentRow&{total:number}>(`WITH s AS (SELECT a.id,u.name,u.email,u.email_verified AS verified,a.status,a.created_at AS joined,${current} AS access,
   (SELECT max(n.ends_at) FROM entitlements n WHERE n.user_id=a.id AND n.revoked_at IS NULL AND n.ends_at>now()) AS until,
   (SELECT max(i.answered_at) FROM practice_items i JOIN practice_attempts p ON p.id=i.attempt_id WHERE p.user_id=a.id) AS last,
   (SELECT count(*)::int FROM practice_items i JOIN practice_attempts p ON p.id=i.attempt_id WHERE p.user_id=a.id AND i.selected IS NOT NULL) AS answered
   FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.role='student' AND a.status<>'deleted' AND ($1='' OR lower(u.email) LIKE '%'||$1||'%' OR lower(u.name) LIKE '%'||$1||'%' OR a.id::text LIKE $1||'%'))
  SELECT id,name,email,verified,status,joined::text AS "joinedAt",last::text AS "lastActiveAt",access,until::text AS "accessUntil",answered,count(*) OVER()::int AS total FROM s WHERE ${where} ORDER BY joined DESC LIMIT ${STUDENT_PAGE} OFFSET ${(page-1)*STUDENT_PAGE}`,[q]);
 return {page,total:rows[0]?.total??0,rows:rows.map(({total:_,...r})=>r)};
}
export type StudentDetail={id:string;name:string;email:string;verified:boolean;twoFactor:boolean;status:string;suspendedReason:string|null;joinedAt:string;country:string;timezone:string;examDate:string|null;
 access:{id:string;examId:string;exam:string;source:string;startsAt:string;endsAt:string;revokedAt:string|null;live:boolean}[];
 subscriptions:{exam:string;months:number;priceCents:number;status:string;periodEnd:string|null;autoRenew:boolean;hold:string|null;createdAt:string}[];
 trials:{exam:string;endsAt:string;limit:number;used:number}[];
 progress:{exam:string;sessions:number;answered:number;correct:number;lastActiveAt:string|null}[];
 recent:{id:string;exam:string;mode:string;startedAt:string;finished:boolean;answered:number;total:number;correct:number}[];
 views24h:number;openReports:number;openAlerts:number};
export async function getStudent(db:Database,actorId:string,userId:string):Promise<StudentDetail|null> {
 await requireSuperAdmin(db,actorId);requireId(userId);
 const [base]=await db.query<Omit<StudentDetail,'access'|'subscriptions'|'trials'|'progress'|'recent'>>(`SELECT a.id,u.name,u.email,u.email_verified AS verified,u.two_factor_enabled AS "twoFactor",a.status,a.suspended_reason AS "suspendedReason",a.created_at::text AS "joinedAt",
  COALESCE(p.country,'') AS country,COALESCE(p.timezone,'') AS timezone,p.exam_date::text AS "examDate",
  (SELECT count(*)::int FROM question_views v WHERE v.user_id=a.id AND v.viewed_at>now()-interval '24 hours') AS "views24h",
  (SELECT count(*)::int FROM question_reports r WHERE r.user_id=a.id AND r.status='open') AS "openReports",
  (SELECT count(*)::int FROM security_alerts s WHERE s.user_id=a.id AND s.resolved_at IS NULL) AS "openAlerts"
  FROM app_users a JOIN auth_users u ON u.id=a.auth_id LEFT JOIN student_profiles p ON p.user_id=a.id WHERE a.id=$1 AND a.role='student' AND a.status<>'deleted'`,[userId]);
 if(!base)return null;
 const [access,subscriptions,trials,progress,recent]=await Promise.all([
  db.query<StudentDetail['access'][number]>(`SELECT n.id,n.exam_id AS "examId",e.name AS exam,n.source,n.starts_at::text AS "startsAt",n.ends_at::text AS "endsAt",n.revoked_at::text AS "revokedAt",(n.revoked_at IS NULL AND n.starts_at<=now() AND n.ends_at>now()) AS live FROM entitlements n JOIN exams e ON e.id=n.exam_id WHERE n.user_id=$1 ORDER BY n.ends_at DESC LIMIT 30`,[userId]),
  db.query<StudentDetail['subscriptions'][number]>(`SELECT e.name AS exam,p.months,p.price_cents AS "priceCents",s.status,s.current_period_end::text AS "periodEnd",NOT s.cancel_at_period_end AS "autoRenew",s.access_hold AS hold,s.created_at::text AS "createdAt" FROM subscriptions s JOIN exams e ON e.id=s.exam_id JOIN plans p ON p.id=s.plan_id WHERE s.user_id=$1 ORDER BY s.created_at DESC`,[userId]),
  db.query<StudentDetail['trials'][number]>(`SELECT e.name AS exam,t.ends_at::text AS "endsAt",t.question_limit AS limit,(SELECT count(*)::int FROM practice_items i JOIN practice_attempts p ON p.id=i.attempt_id WHERE p.user_id=t.user_id AND p.exam_id=t.exam_id AND p.access='trial' AND i.selected IS NOT NULL) AS used FROM trials t JOIN exams e ON e.id=t.exam_id WHERE t.user_id=$1`,[userId]),
  db.query<StudentDetail['progress'][number]>(`SELECT e.name AS exam,count(DISTINCT p.id)::int AS sessions,count(i.selected)::int AS answered,count(*) FILTER (WHERE i.correct)::int AS correct,max(i.answered_at)::text AS "lastActiveAt" FROM practice_attempts p JOIN exams e ON e.id=p.exam_id JOIN practice_items i ON i.attempt_id=p.id WHERE p.user_id=$1 GROUP BY e.name ORDER BY e.name`,[userId]),
  db.query<StudentDetail['recent'][number]>(`SELECT p.id,e.name AS exam,p.mode,p.started_at::text AS "startedAt",(p.submitted_at IS NOT NULL OR (p.mode='exam' AND p.deadline_at<=now())) AS finished,count(i.selected)::int AS answered,count(i.*)::int AS total,count(*) FILTER (WHERE i.correct)::int AS correct FROM practice_attempts p JOIN exams e ON e.id=p.exam_id JOIN practice_items i ON i.attempt_id=p.id WHERE p.user_id=$1 GROUP BY p.id,e.name ORDER BY p.started_at DESC LIMIT 10`,[userId]),
 ]);
 return {...base,access,subscriptions,trials,progress,recent};
}
// ADM-3: grant or extend complimentary access. Extra days start from the latest paid or granted end date, so an
// extension never shortens or overlaps what the student already has.
export async function extendAccess(db:Database,actorId:string,input:{userId:string;examId:string;days:number;note:string}) {
 requireId(input.userId);requireId(input.examId);
 if(!Number.isInteger(input.days)||input.days<1||input.days>366)throw new Error('Choose between 1 and 366 days.');
 const note=input.note.trim();
 if(!note||note.length>300)throw new Error('Give a reason (up to 300 characters). It goes in the audit log.');
 return db.transaction(async tx=>{
  await requireSuperAdmin(tx,actorId);
  const [user]=await tx.query(`SELECT 1 FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1 AND a.status='active' AND u.email_verified FOR UPDATE OF a`,[input.userId]);
  if(!user)throw new Error('Only an active, verified account can be given access.');
  if(!(await tx.query('SELECT 1 FROM exams WHERE id=$1',[input.examId])).length)throw new Error('Exam not found.');
  const [{from}]=await tx.query<{from:string}>(`SELECT GREATEST(now(),COALESCE(max(ends_at),now()))::text AS from FROM entitlements WHERE user_id=$1 AND exam_id=$2 AND source IN ${ACCESS_SOURCES} AND revoked_at IS NULL`,[input.userId,input.examId]);
  const [row]=await tx.query<{id:string;ends_at:string}>(`INSERT INTO entitlements(user_id,exam_id,source,starts_at,ends_at) VALUES($1,$2,'complimentary',$3::timestamptz,$3::timestamptz+make_interval(days=>$4)) RETURNING id,ends_at::text`,[input.userId,input.examId,from,input.days]);
  await audit(tx,actorId,row.id,'entitlement.granted',null,{userId:input.userId,examId:input.examId,source:'complimentary',days:input.days,from,note});
  return row.ends_at;
 });
}
// Only complimentary grants are revoked here; paid access is changed through Billing so Stripe stays in step.
export async function revokeAccess(db:Database,actorId:string,entitlementId:string,note:string) {
 requireId(entitlementId);
 if(!note.trim()||note.length>300)throw new Error('Give a reason (up to 300 characters). It goes in the audit log.');
 return db.transaction(async tx=>{
  await requireSuperAdmin(tx,actorId);
  const rows=await tx.query<{user_id:string}>(`UPDATE entitlements SET revoked_at=now() WHERE id=$1 AND source='complimentary' AND revoked_at IS NULL AND ends_at>now() RETURNING user_id`,[entitlementId]);
  if(!rows.length)throw new Error('Only current complimentary access can be revoked here. Paid plans are managed in Billing.');
  await audit(tx,actorId,entitlementId,'entitlement.revoked',null,{userId:rows[0].user_id,note:note.trim()});
 });
}
// ADM-3 password reset: the student gets the normal reset email; staff never see or set a password.
export async function prepareResetFor(db:Database,actorId:string,userId:string) {
 requireId(userId);
 await requireSuperAdmin(db,actorId);
 const [user]=await db.query<{email:string}>(`SELECT u.email FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1 AND a.status<>'deleted'`,[userId]);
 if(!user)throw new Error('Account not found.');
 await audit(db,actorId,userId,'account.password_reset_sent',null,{});
 return user.email;
}
// ADM-4 team: everyone with a staff role, and role changes by a Super Admin.
export type TeamMember={id:string;name:string;email:string;role:Role;status:string;twoFactor:boolean;verified:boolean;joinedAt:string;lastActionAt:string|null};
export async function listTeam(db:Database,actorId:string):Promise<TeamMember[]> {
 await requireSuperAdmin(db,actorId);
 return db.query<TeamMember>(`SELECT a.id,u.name,u.email,a.role,a.status,u.two_factor_enabled AS "twoFactor",u.email_verified AS verified,a.created_at::text AS "joinedAt",(SELECT max(l.created_at)::text FROM audit_log l WHERE l.actor_id=a.id) AS "lastActionAt"
  FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.role<>'student' AND a.status<>'deleted' ORDER BY array_position(ARRAY['super_admin','content_manager','reviewer'],a.role),u.name`);
}
export async function setRole(db:Database,actorId:string,input:{email?:string;userId?:string;role:string}) {
 if(!ROLES.includes(input.role as Role))throw new Error('Choose a valid role.');
 const role=input.role as Role;
 return db.transaction(async tx=>{
  await requireSuperAdmin(tx,actorId);
  if(input.userId)requireId(input.userId);
  const [user]=await tx.query<{id:string;role:Role;email:string;verified:boolean}>(input.userId?`SELECT a.id,a.role,u.email,u.email_verified AS verified FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1 AND a.status='active' FOR UPDATE OF a`
   :`SELECT a.id,a.role,u.email,u.email_verified AS verified FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE lower(u.email)=lower($1) AND a.status='active' FOR UPDATE OF a`,[input.userId??(input.email??'').trim()]);
  if(!user)throw new Error('No active account uses that email. Ask them to create an account first.');
  if(user.id===actorId)throw new Error('You cannot change your own role.');
  if(!user.verified&&role!=='student')throw new Error('This account has not verified its email yet.');
  if(user.role===role)throw new Error(`This account is already ${role==='student'?'a student':`a ${role.replaceAll('_',' ')}`}.`);
  await tx.query('UPDATE app_users SET role=$2 WHERE id=$1',[user.id,role]);
  // A role change signs the account out, so the new permissions apply from the next sign-in.
  await tx.query('DELETE FROM auth_sessions WHERE user_id=(SELECT auth_id FROM app_users WHERE id=$1)',[user.id]);
  await audit(tx,actorId,user.id,'account.role_changed',{role:user.role},{role});
  return {email:user.email,from:user.role,to:role};
 });
}
export type AuditEntry={id:string;at:string;action:string;actor:string;entityId:string;before:unknown;after:unknown};
export async function listAuditLog(db:Database,actorId:string,options:{action?:string;before?:string}={}):Promise<AuditEntry[]> {
 await requireSuperAdmin(db,actorId);
 const prefix=(options.action??'').replace(/[^a-z_.]/g,'').slice(0,40);
 const before=options.before&&!Number.isNaN(Date.parse(options.before))?options.before:null;
 return db.query<AuditEntry>(`SELECT l.id,l.created_at::text AS at,l.action,COALESCE(u.email,'Unknown') AS actor,l.entity_id AS "entityId",l.before_json AS before,l.after_json AS after FROM audit_log l LEFT JOIN app_users a ON a.id=l.actor_id LEFT JOIN auth_users u ON u.id=a.auth_id
  WHERE ($1='' OR l.action LIKE $1||'%') AND ($2::timestamptz IS NULL OR l.created_at<$2::timestamptz) ORDER BY l.created_at DESC LIMIT 100`,[prefix,before]);
}

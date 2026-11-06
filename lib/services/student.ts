import type {Database} from '../db/client';
import {requireId,requireStaff} from './studio';
// Student tools (STU-5), the profile (AUTH-2), the home screen's daily figures (STU-6) and account export and
// deletion (AUTH-3). Tools act on a question through a session the student owns, never on a bare question id.
async function ownedItem(db:Database,userId:string,attemptId:string,position:number) {
 requireId(attemptId);
 if(!Number.isInteger(position)||position<1)throw new Error('Question not found in this session.');
 const [item]=await db.query<{questionId:string;versionId:string;status:string}>(`SELECT i.question_id AS "questionId",i.version_id AS "versionId",q.status FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id JOIN questions q ON q.id=i.question_id JOIN app_users u ON u.id=a.user_id WHERE i.attempt_id=$1 AND i.position=$2 AND a.user_id=$3 AND u.status='active'`,[attemptId,position,userId]);
 if(!item)throw new Error('Question not found in this session.');
 if(item.status!=='published')throw new Error('This question is no longer available.');
 return item;
}
export async function questionTools(db:Database,userId:string,questionId:string) {
 const [row]=await db.query<{bookmarked:boolean;note:string|null;reported:boolean}>(`SELECT EXISTS(SELECT 1 FROM question_bookmarks WHERE user_id=$1 AND question_id=$2) AS bookmarked,(SELECT body FROM question_notes WHERE user_id=$1 AND question_id=$2) AS note,EXISTS(SELECT 1 FROM question_reports WHERE user_id=$1 AND question_id=$2 AND status='open') AS reported`,[userId,questionId]);
 return {bookmarked:row.bookmarked,note:row.note??'',reported:row.reported};
}
export async function setBookmark(db:Database,userId:string,attemptId:string,position:number,bookmarked:boolean) {
 const item=await ownedItem(db,userId,attemptId,position);
 if(bookmarked)await db.query('INSERT INTO question_bookmarks(user_id,question_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[userId,item.questionId]);
 else await db.query('DELETE FROM question_bookmarks WHERE user_id=$1 AND question_id=$2',[userId,item.questionId]);
}
export const NOTE_LIMIT=2000;
export async function saveNote(db:Database,userId:string,attemptId:string,position:number,body:string) {
 const item=await ownedItem(db,userId,attemptId,position),text=body.trim();
 if(text.length>NOTE_LIMIT)throw new Error(`Keep notes under ${NOTE_LIMIT} characters.`);
 if(!text)await db.query('DELETE FROM question_notes WHERE user_id=$1 AND question_id=$2',[userId,item.questionId]);
 else await db.query('INSERT INTO question_notes(user_id,question_id,body) VALUES($1,$2,$3) ON CONFLICT(user_id,question_id) DO UPDATE SET body=EXCLUDED.body,updated_at=now()',[userId,item.questionId,text]);
}
export const REPORT_REASONS={wrong_answer:'The marked answer is wrong',unclear:'The question or options are unclear',typo:'Spelling or formatting',outdated:'Out of date with current guidance',other:'Something else'} as const;
export type ReportReason=keyof typeof REPORT_REASONS;
export async function reportQuestion(db:Database,userId:string,attemptId:string,position:number,input:{reason:string;details:string}) {
 if(!(input.reason in REPORT_REASONS))throw new Error('Choose what is wrong with this question.');
 const details=input.details.trim();
 if(details.length>2000)throw new Error('Keep the details under 2,000 characters.');
 const item=await ownedItem(db,userId,attemptId,position);
 // One open report per student and question; a second report adds to the first instead of duplicating it.
 await db.query(`INSERT INTO question_reports(user_id,question_id,version_id,reason,details) VALUES($1,$2,$3,$4,$5)
  ON CONFLICT(user_id,question_id) WHERE status='open' DO UPDATE SET reason=EXCLUDED.reason,details=EXCLUDED.details,version_id=EXCLUDED.version_id,created_at=now()`,[userId,item.questionId,item.versionId,input.reason,details]);
}
// Staff side of "Report an error" (ADM-6): the open reports, newest first, with the question they concern.
export type QuestionReport={id:string;questionId:string;examName:string;stem:string;reason:ReportReason;details:string;createdAt:string;version:number;currentVersion:number|null};
export async function listQuestionReports(db:Database,actorId:string,questionId?:string):Promise<QuestionReport[]> {
 await requireStaff(db,actorId);
 if(questionId)requireId(questionId);
 return db.query<QuestionReport>(`SELECT r.id,r.question_id AS "questionId",e.name AS "examName",left(v.stem,160) AS stem,r.reason,r.details,r.created_at::text AS "createdAt",v.version AS version,cv.version AS "currentVersion"
  FROM question_reports r JOIN questions q ON q.id=r.question_id JOIN exams e ON e.id=q.exam_id JOIN question_versions v ON v.id=r.version_id LEFT JOIN question_versions cv ON cv.id=q.current_version_id
  WHERE r.status='open' AND ($1::uuid IS NULL OR r.question_id=$1) ORDER BY r.created_at DESC LIMIT 100`,[questionId??null]);
}
export async function resolveQuestionReport(db:Database,actorId:string,reportId:string,outcome:'resolved'|'dismissed') {
 requireId(reportId);
 if(!['resolved','dismissed'].includes(outcome))throw new Error('Choose how to close this report.');
 return db.transaction(async tx=>{
  await requireStaff(tx,actorId);
  const rows=await tx.query<{id:string}>(`UPDATE question_reports SET status=$2,resolved_by=$3,resolved_at=now() WHERE id=$1 AND status='open' RETURNING id`,[reportId,outcome,actorId]);
  if(!rows.length)throw new Error('This report has already been closed.');
  await tx.query('INSERT INTO audit_log(actor_id,entity_id,action,after_json) VALUES($1,$2,$3,$4::jsonb)',[actorId,reportId,`question_report.${outcome}`,JSON.stringify({outcome})]);
 });
}
export type Profile={name:string;email:string;country:string;timezone:string;examIds:string[];examDate:string|null;dailyTarget:number|null};
export async function getProfile(db:Database,userId:string):Promise<Profile> {
 const [row]=await db.query<Profile>(`SELECT u.name,u.email,COALESCE(p.country,'') AS country,COALESCE(p.timezone,'') AS timezone,COALESCE(p.exam_ids,'{}') AS "examIds",p.exam_date::text AS "examDate",p.daily_target AS "dailyTarget" FROM app_users a JOIN auth_users u ON u.id=a.auth_id LEFT JOIN student_profiles p ON p.user_id=a.id WHERE a.id=$1`,[userId]);
 if(!row)throw new Error('Account not found.');
 return row;
}
export function validTimezone(zone:string) {try{new Intl.DateTimeFormat('en-GB',{timeZone:zone});return true;}catch{return false;}}
export async function saveProfile(db:Database,userId:string,input:{name:string;country:string;timezone:string;examIds:string[];examDate:string;dailyTarget:string}) {
 const name=input.name.trim().replace(/\s+/g,' '),country=input.country.trim(),timezone=input.timezone.trim();
 if(!name||name.length>80)throw new Error('Enter your name (up to 80 characters).');
 if(country.length>80)throw new Error('Enter a shorter country name.');
 if(timezone&&!validTimezone(timezone))throw new Error('Choose a timezone from the list.');
 const examIds=[...new Set(input.examIds)].slice(0,10);examIds.forEach(requireId);
 let examDate:string|null=null;
 if(input.examDate){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.examDate)||Number.isNaN(Date.parse(input.examDate)))throw new Error('Enter a valid exam date.');
  const year=Number(input.examDate.slice(0,4)),now=new Date().getUTCFullYear();
  if(year<now-1||year>now+5)throw new Error('Enter an exam date within the next five years.');
  examDate=input.examDate;
 }
 let dailyTarget:number|null=null;
 if(input.dailyTarget.trim()){dailyTarget=Number(input.dailyTarget);if(!Number.isInteger(dailyTarget)||dailyTarget<1||dailyTarget>500)throw new Error('Set a daily target between 1 and 500 questions.');}
 return db.transaction(async tx=>{
  if(examIds.length&&(await tx.query<{n:number}>('SELECT count(*)::int AS n FROM exams WHERE id=ANY($1::uuid[])',[examIds]))[0].n!==examIds.length)throw new Error('Choose exams from the list.');
  const [user]=await tx.query<{auth_id:string}>(`SELECT auth_id FROM app_users WHERE id=$1 AND status='active'`,[userId]);
  if(!user)throw new Error('Account not found.');
  await tx.query('UPDATE auth_users SET name=$2,updated_at=now() WHERE id=$1',[user.auth_id,name]);
  await tx.query(`INSERT INTO student_profiles(user_id,country,timezone,exam_ids,exam_date,daily_target) VALUES($1,$2,$3,$4::uuid[],$5::date,$6)
   ON CONFLICT(user_id) DO UPDATE SET country=EXCLUDED.country,timezone=EXCLUDED.timezone,exam_ids=EXCLUDED.exam_ids,exam_date=EXCLUDED.exam_date,daily_target=EXCLUDED.daily_target,updated_at=now()`,[userId,country,timezone,examIds,examDate,dailyTarget]);
 });
}
// STU-6: the countdown, today's answers against the daily target, and the three weakest topics.
export type StudyPlan={examDate:string|null;daysLeft:number|null;dailyTarget:number|null;answeredToday:number;weakest:{id:string;topic:string;correct:number;total:number}[]};
export async function studyPlan(db:Database,userId:string,examId:string):Promise<StudyPlan> {
 requireId(examId);
 const [profile]=await db.query<{examDate:string|null;dailyTarget:number|null;timezone:string}>(`SELECT exam_date::text AS "examDate",daily_target AS "dailyTarget",timezone FROM student_profiles WHERE user_id=$1`,[userId]);
 const zone=profile?.timezone&&validTimezone(profile.timezone)?profile.timezone:'UTC';
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const [{n}]=await db.query<{n:number}>(`SELECT count(*)::int AS n FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id WHERE a.user_id=$1 AND i.answered_at IS NOT NULL AND (i.answered_at AT TIME ZONE $2)::date=$3::date`,[userId,zone,today]);
 // Judged on the latest answer the student can see feedback for, grouped by the top-level topic.
 const weakest=await db.query<{id:string;topic:string;correct:number;total:number}>(`WITH last AS (SELECT DISTINCT ON (i.question_id) i.question_id,i.correct FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id WHERE a.user_id=$1 AND a.exam_id=$2 AND i.selected IS NOT NULL AND (a.mode='revision' OR a.submitted_at IS NOT NULL) ORDER BY i.question_id,i.answered_at DESC)
  SELECT COALESCE(p.id,t.id) AS id,COALESCE(p.name,t.name) AS topic,count(*) FILTER (WHERE l.correct)::int AS correct,count(*)::int AS total FROM last l JOIN questions q ON q.id=l.question_id AND q.status='published' JOIN topics t ON t.id=q.topic_id LEFT JOIN topics p ON p.id=t.parent_id
  GROUP BY 1,2 HAVING count(*) FILTER (WHERE NOT l.correct)>0 ORDER BY count(*) FILTER (WHERE l.correct)::float/count(*),count(*) DESC LIMIT 3`,[userId,examId]);
 const examDate=profile?.examDate??null;
 const daysLeft=examDate?Math.round((Date.parse(examDate)-Date.parse(today))/86400000):null;
 return {examDate,daysLeft,dailyTarget:profile?.dailyTarget??null,answeredToday:n,weakest};
}
// AUTH-3: everything held about the student, without question content (content is the asset, PROT).
export async function exportAccountData(db:Database,userId:string) {
 const profile=await getProfile(db,userId);
 const q=(sql:string)=>db.query(sql,[userId]);
 const [account]=await q(`SELECT a.id,a.role,a.created_at AS "createdAt",u.email_verified AS "emailVerified",u.two_factor_enabled AS "twoFactorEnabled" FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1`);
 return {exportedAt:new Date().toISOString(),account:{...account,name:profile.name,email:profile.email},profile:{country:profile.country,timezone:profile.timezone,examIds:profile.examIds,examDate:profile.examDate,dailyTarget:profile.dailyTarget},
  access:await q(`SELECT e.name AS exam,n.source,n.starts_at AS "startsAt",n.ends_at AS "endsAt",n.revoked_at AS "revokedAt" FROM entitlements n JOIN exams e ON e.id=n.exam_id WHERE n.user_id=$1 ORDER BY n.starts_at`),
  subscriptions:await q(`SELECT e.name AS exam,p.months,p.price_cents AS "priceCents",s.status,s.current_period_start AS "periodStart",s.current_period_end AS "periodEnd",s.cancel_at_period_end AS "cancelAtPeriodEnd",s.created_at AS "createdAt" FROM subscriptions s JOIN exams e ON e.id=s.exam_id JOIN plans p ON p.id=s.plan_id WHERE s.user_id=$1 ORDER BY s.created_at`),
  trials:await q(`SELECT e.name AS exam,t.ends_at AS "endsAt",t.question_limit AS "questionLimit" FROM trials t JOIN exams e ON e.id=t.exam_id WHERE t.user_id=$1`),
  sessions:await q(`SELECT a.id,e.name AS exam,a.mode,a.started_at AS "startedAt",a.submitted_at AS "submittedAt",(SELECT json_agg(json_build_object('position',i.position,'questionId',i.question_id,'selected',i.selected,'correct',i.correct,'confidence',i.confidence,'flagged',i.flagged,'timeMs',i.time_ms,'answeredAt',i.answered_at) ORDER BY i.position) FROM practice_items i WHERE i.attempt_id=a.id) AS answers FROM practice_attempts a JOIN exams e ON e.id=a.exam_id WHERE a.user_id=$1 ORDER BY a.started_at`),
  bookmarks:await q(`SELECT question_id AS "questionId",created_at AS "createdAt" FROM question_bookmarks WHERE user_id=$1 ORDER BY created_at`),
  notes:await q(`SELECT question_id AS "questionId",body,updated_at AS "updatedAt" FROM question_notes WHERE user_id=$1 ORDER BY updated_at`),
  reports:await q(`SELECT question_id AS "questionId",reason,details,status,created_at AS "createdAt" FROM question_reports WHERE user_id=$1 ORDER BY created_at`)};
}
// AUTH-3: the account is anonymised in place and every sign-in method removed. Payment and access records stay,
// unlinked from the person, for accounting and refunds. A plan that would renew must be turned off first.
export async function deleteAccount(db:Database,userId:string,confirmEmail:string) {
 return db.transaction(async tx=>{
  const [user]=await tx.query<{authId:string;email:string;role:string}>(`SELECT a.auth_id AS "authId",u.email,a.role FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1 AND a.status<>'deleted' FOR UPDATE OF a`,[userId]);
  if(!user)throw new Error('Account not found.');
  if(user.role!=='student')throw new Error('Staff accounts are removed by a Super Admin.');
  if(confirmEmail.trim().toLowerCase()!==user.email.toLowerCase())throw new Error('Type your email address exactly to confirm.');
  const renewing=await tx.query(`SELECT 1 FROM subscriptions WHERE user_id=$1 AND status IN ('active','trialing','past_due') AND NOT cancel_at_period_end LIMIT 1`,[userId]);
  if(renewing.length)throw new Error('Turn off auto-renew in My plans first, so you are not charged again.');
  await tx.query(`UPDATE auth_users SET name='Deleted account',email=$2,email_verified=false,image=NULL,two_factor_enabled=false,updated_at=now() WHERE id=$1`,[user.authId,`deleted+${userId}@deleted.invalid`]);
  for(const table of ['auth_sessions','auth_accounts','auth_two_factors'])await tx.query(`DELETE FROM ${table} WHERE user_id=$1`,[user.authId]);
  await tx.query('DELETE FROM auth_verifications WHERE identifier=$1 OR identifier LIKE $2',[user.email,`%${user.email}%`]);
  for(const table of ['question_bookmarks','question_notes','student_profiles'])await tx.query(`DELETE FROM ${table} WHERE user_id=$1`,[userId]);
  await tx.query(`UPDATE question_reports SET details='' WHERE user_id=$1`,[userId]);
  await tx.query(`UPDATE app_users SET status='deleted',deleted_at=now() WHERE id=$1`,[userId]);
  await tx.query('INSERT INTO audit_log(actor_id,entity_id,action,after_json) VALUES($1,$1,$2,$3::jsonb)',[userId,'account.deleted',JSON.stringify({by:'self'})]);
 });
}
export async function examOptions(db:Database) {
 return db.query<{id:string;name:string}>(`SELECT id,name FROM exams ORDER BY name`);
}

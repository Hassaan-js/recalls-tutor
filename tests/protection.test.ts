import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {embeddedDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {seedCatalogue} from '../lib/db/seed';
import {createAuth} from '../lib/auth/server';
import {actorFromSession,staffAccess} from '../lib/auth/actor';
import {getPracticeQuestion,startAttempt} from '../lib/services/practice';
import {listStudioQuestions} from '../lib/services/studio';
import {getProtectionSettings,listSecurityAlerts,QuestionBudgetError,reinstateAccount,resolveSecurityAlert,suspendAccount,traceAccount,updateProtectionSettings} from '../lib/services/protection';
import {listExams} from '../lib/services/catalogue';
test('Content protection: hourly budget, scraping alerts, leak tracing and suspension',async()=>{
 const db=embeddedDatabase(new PGlite());
 try {
  await migrate(db);await seedCatalogue(db);
  let link='';const auth=createAuth(db,{secret:randomBytes(48).toString('base64url'),baseURL:'http://localhost:3000',sendMail:async mail=>{link=mail.text.match(/https?:\/\/\S+/)![0];},rateLimit:false});
  async function account(role:string,twoFactor=false) {
   const email=`${randomUUID()}@example.test`,password='A-test-password-827!';
   const created=await auth.api.signUpEmail({body:{name:role,email,password}});await auth.handler(new Request(link));
   if(twoFactor)await db.query('UPDATE auth_users SET two_factor_enabled=true WHERE id=$1',[created.user.id]);
   const [row]=await db.query<{id:string}>('INSERT INTO app_users(auth_id,role) VALUES($1,$2) RETURNING id',[created.user.id,role]);
   return {id:row.id,authId:created.user.id,email,password};
  }
  const admin=await account('super_admin',true),reviewer=await account('reviewer'),student=await account('student'),other=await account('student');
  const exam=(await listExams(db))[0];
  // Twelve published questions, inserted directly: this test is about delivery, not authoring.
  for(let n=1;n<=12;n++) {
   const [q]=await db.query<{id:string}>(`INSERT INTO questions(exam_id,status) VALUES($1,'published') RETURNING id`,[exam.id]);
   const [v]=await db.query<{id:string}>(`INSERT INTO question_versions(question_id,version,stem,options,correct_answers,explanation) VALUES($1,1,$2,'["A","B","C","D","E"]','[0]','x') RETURNING id`,[q.id,`Protected stem ${n}`]);
   await db.query('UPDATE questions SET current_version_id=$1 WHERE id=$2',[v.id,q.id]);
  }
  for(const u of [student,other])await db.query("INSERT INTO entitlements(user_id,exam_id,source,starts_at,ends_at) VALUES($1,$2,'complimentary',now(),now()+interval '30 days')",[u.id,exam.id]);
  // Settings: technical defaults, Super Admin with two-factor only.
  assert.deepEqual(await getProtectionSettings(db),{hourlyQuestionBudget:240,burstQuestions:60,burstMinutes:5});
  await assert.rejects(updateProtectionSettings(db,reviewer.id,{hourlyQuestionBudget:10,burstQuestions:5,burstMinutes:5}),/Super Admin/);
  await assert.rejects(updateProtectionSettings(db,admin.id,{hourlyQuestionBudget:3,burstQuestions:5,burstMinutes:5}),/between/);
  await updateProtectionSettings(db,admin.id,{hourlyQuestionBudget:10,burstQuestions:5,burstMinutes:5});
  // Hourly budget: ten new questions, re-opening is free, the eleventh is refused with a friendly wait.
  const attempt=await startAttempt(db,student.id,{examId:exam.id,mode:'revision',pool:'all',count:12,requestId:randomUUID()});
  for(let p=1;p<=10;p++)await getPracticeQuestion(db,student.id,attempt,p);
  await getPracticeQuestion(db,student.id,attempt,1);
  await assert.rejects(getPracticeQuestion(db,student.id,attempt,11),(e:unknown)=>e instanceof QuestionBudgetError&&/hourly question limit/.test(e.message)&&e.retryInMinutes>=59);
  await assert.rejects(getPracticeQuestion(db,student.id,attempt,12),QuestionBudgetError);
  const [{n:views}]=await db.query<{n:number}>('SELECT count(*)::int AS n FROM question_views WHERE user_id=$1',[student.id]);
  assert.equal(views,11);// refused deliveries are not logged as views
  // Alerts: one of each kind per hour, not one per request.
  await assert.rejects(listSecurityAlerts(db,reviewer.id),/Super Admin/);
  let alerts=await listSecurityAlerts(db,admin.id);
  assert.deepEqual(alerts.map(a=>a.kind).sort(),['burst','hourly_limit']);
  assert.equal(alerts.find(a=>a.kind==='hourly_limit')!.details.questionsLastHour,10);assert.equal(alerts[0].email,student.email);
  // The hour rolls over.
  await db.query("UPDATE question_views SET viewed_at=now()-interval '61 minutes' WHERE user_id=$1",[student.id]);
  await getPracticeQuestion(db,student.id,attempt,11);
  // Another student is unaffected.
  const otherAttempt=await startAttempt(db,other.id,{examId:exam.id,mode:'revision',pool:'all',count:3,requestId:randomUUID()});
  await getPracticeQuestion(db,other.id,otherAttempt,1);
  await assert.rejects(resolveSecurityAlert(db,admin.id,alerts[0].id,''),/Record/);
  await resolveSecurityAlert(db,admin.id,alerts[0].id,'Reviewed: synthetic test');
  assert.equal((await listSecurityAlerts(db,admin.id)).length,1);
  // Leak tracing from the watermark ("email · first 8 characters of the ID").
  assert.equal((await traceAccount(db,admin.id,`${student.email} · ${student.id.slice(0,8)}`))[0].id,student.id);
  assert.equal((await traceAccount(db,admin.id,student.id.slice(0,8)))[0].id,student.id);
  assert.equal((await traceAccount(db,admin.id,student.email.toUpperCase()))[0].viewsLast24h,12);
  await assert.rejects(traceAccount(db,admin.id,'hello'),/email address or the 8-character/);
  await assert.rejects(traceAccount(db,reviewer.id,student.email),/Super Admin/);
  // Suspension: Super Admin only, with a reason; never self or another Super Admin.
  const signIn=(u:{email:string;password:string})=>auth.api.signInEmail({body:{email:u.email,password:u.password}});
  await signIn(student);await signIn(reviewer);
  assert.ok((await db.query('SELECT 1 FROM auth_sessions WHERE user_id=$1',[student.authId])).length>0);
  await assert.rejects(suspendAccount(db,reviewer.id,student.id,'x'),/Super Admin/);
  await assert.rejects(suspendAccount(db,admin.id,student.id,' '),/reason/);
  await assert.rejects(suspendAccount(db,admin.id,admin.id,'x'),/your own/);
  await suspendAccount(db,admin.id,student.id,'Watermark seen on a shared screenshot (synthetic test)');
  await assert.rejects(suspendAccount(db,admin.id,student.id,'again'),/already/);
  assert.equal((await db.query('SELECT 1 FROM auth_sessions WHERE user_id=$1',[student.authId])).length,0);// signed out everywhere
  await assert.rejects(signIn(student),/suspended/);
  await assert.rejects(getPracticeQuestion(db,student.id,attempt,1),/suspended/);
  await assert.rejects(startAttempt(db,student.id,{examId:exam.id,mode:'revision',pool:'all',count:1,requestId:randomUUID()}),/suspended/);
  // Suspended staff lose the Studio too.
  await suspendAccount(db,admin.id,reviewer.id,'Synthetic test');
  await assert.rejects(listStudioQuestions(db,reviewer.id),/permission/);
  const actor=await actorFromSession(db,{user:{id:reviewer.authId,name:'r',email:reviewer.email,emailVerified:true}});
  assert.equal(actor?.suspended,true);assert.equal(staffAccess(actor),'forbidden');
  assert.equal((await traceAccount(db,admin.id,student.email))[0].status,'suspended');
  // Reinstatement restores sign-in and practice.
  await reinstateAccount(db,admin.id,student.id);await assert.rejects(reinstateAccount(db,admin.id,student.id),/not suspended/);
  await signIn(student);await getPracticeQuestion(db,student.id,attempt,1);
  assert.equal((await db.query("SELECT 1 FROM audit_log WHERE action IN ('account.suspended','account.reinstated','protection.settings_updated','security_alert.resolved')")).length,5);
 }finally{await db.close();}
});

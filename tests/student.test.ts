import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {embeddedDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {seedCatalogue} from '../lib/db/seed';
import {createRecall,getStudioQuestion,saveStudioDraft,reviewStudioQuestion,setQuestionTags} from '../lib/services/studio';
import {answerQuestion,getPracticeQuestion,grantComplimentaryAccess,setFlag,startAttempt,submitAttempt} from '../lib/services/practice';
import {deleteAccount,exportAccountData,getProfile,listQuestionReports,reportQuestion,resolveQuestionReport,saveNote,saveProfile,setBookmark,studyPlan} from '../lib/services/student';
import {isSuspendedAuthUser} from '../lib/services/protection';
import {listExams} from '../lib/services/catalogue';
test('Student tools, profile, study plan, export and account deletion',async()=>{
 const db=embeddedDatabase(new PGlite());
 try {
  await migrate(db);await seedCatalogue(db);
  async function actor(role:string,twoFactor=false) {const authId=randomUUID();await db.query('INSERT INTO auth_users(id,name,email,email_verified,two_factor_enabled,created_at,updated_at) VALUES($1,$2,$3,true,$4,now(),now())',[authId,role,`${authId}@example.test`,twoFactor]);return {id:(await db.query<{id:string}>('INSERT INTO app_users(auth_id,role) VALUES($1,$2) RETURNING id',[authId,role]))[0].id,email:`${authId}@example.test`,authId};}
  const admin=await actor('super_admin',true),manager=await actor('content_manager'),reviewer=await actor('reviewer'),student=await actor('student'),other=await actor('student');
  const exam=(await listExams(db))[0];
  const [topic]=await db.query<{id:string}>(`INSERT INTO topics(exam_id,name,slug) VALUES($1,'Synthetic topic','synthetic-topic') RETURNING id`,[exam.id]);
  async function publish(n:number) {
   const id=await createRecall(db,manager.id,{examId:exam.id,sourceLabel:'Synthetic',sourceText:`SOURCE ${n}`,requestId:randomUUID()});
   const first=(await getStudioQuestion(db,reviewer.id,id))!;
   const v=await saveStudioDraft(db,reviewer.id,id,first.versionId,{stem:`Synthetic stem ${n}`,options:['A','B','C','D','E'],correctAnswer:1,explanation:`Synthetic explanation ${n}`,references:['Synthetic reference']});
   await setQuestionTags(db,manager.id,id,{topicId:topic.id,difficulty:null,sittingIds:[]});
   await reviewStudioQuestion(db,reviewer.id,id,v,'submit_review',false,'');await reviewStudioQuestion(db,reviewer.id,id,v,'approve',true,'');await reviewStudioQuestion(db,manager.id,id,v,'publish',false,'');
   return id;
  }
  const ids=[await publish(1),await publish(2),await publish(3)];
  for(const user of [student,other])await grantComplimentaryAccess(db,admin.id,{email:user.email,examId:exam.id,days:30});
  const attempt=await startAttempt(db,student.id,{examId:exam.id,mode:'revision',pool:'all',count:3,requestId:randomUUID()});
  const first=await getPracticeQuestion(db,student.id,attempt,1);
  assert.equal(first.question.bookmarked,false);assert.equal(first.question.note,'');
  // Bookmarks and notes belong to the student and follow the question; another student cannot use this session.
  await setBookmark(db,student.id,attempt,1,true);await setBookmark(db,student.id,attempt,1,true);
  await saveNote(db,student.id,attempt,1,'  Remember the guideline  ');
  await assert.rejects(setBookmark(db,other.id,attempt,1,true),/not found/);
  await assert.rejects(saveNote(db,other.id,attempt,1,'x'),/not found/);
  await assert.rejects(saveNote(db,student.id,attempt,1,'x'.repeat(2001)),/2000/);
  const tooled=await getPracticeQuestion(db,student.id,attempt,1);
  assert.equal(tooled.question.bookmarked,true);assert.equal(tooled.question.note,'Remember the guideline');
  // Filters: bookmarked and still-flagged questions.
  await setFlag(db,student.id,attempt,2,true);
  await answerQuestion(db,student.id,attempt,1,{selected:0,confidence:null,timeMs:1000});
  await answerQuestion(db,student.id,attempt,2,{selected:1,confidence:null,timeMs:1000});
  await submitAttempt(db,student.id,attempt);
  const questionAt=async(a:string,p:number)=>(await db.query<{id:string}>('SELECT question_id AS id FROM practice_items WHERE attempt_id=$1 AND position=$2',[a,p]))[0].id;
  const bookmarkedRun=await startAttempt(db,student.id,{examId:exam.id,mode:'revision',pool:'all',count:10,requestId:randomUUID(),filters:{bookmarked:true}});
  assert.deepEqual((await db.query<{id:string}>('SELECT question_id AS id FROM practice_items WHERE attempt_id=$1',[bookmarkedRun])).map(r=>r.id),[await questionAt(attempt,1)]);
  const flaggedRun=await startAttempt(db,student.id,{examId:exam.id,mode:'revision',pool:'all',count:10,requestId:randomUUID(),filters:{flagged:true}});
  assert.deepEqual((await db.query<{id:string}>('SELECT question_id AS id FROM practice_items WHERE attempt_id=$1',[flaggedRun])).map(r=>r.id),[await questionAt(attempt,2)]);
  await assert.rejects(startAttempt(db,other.id,{examId:exam.id,mode:'revision',pool:'all',count:10,requestId:randomUUID(),filters:{bookmarked:true}}),/No questions match/);
  // Error reports: one open report per student and question, visible to staff only, closed with an audit entry.
  await assert.rejects(reportQuestion(db,student.id,attempt,1,{reason:'bogus',details:''}),/Choose/);
  await reportQuestion(db,student.id,attempt,1,{reason:'wrong_answer',details:'Guideline changed'});
  await reportQuestion(db,student.id,attempt,1,{reason:'typo',details:'Second look'});
  await assert.rejects(listQuestionReports(db,student.id),/permission/);
  const reports=await listQuestionReports(db,reviewer.id);
  assert.equal(reports.length,1);assert.equal(reports[0].reason,'typo');assert.equal(reports[0].questionId,await questionAt(attempt,1));
  assert.equal((await getPracticeQuestion(db,student.id,attempt,1)).question.reported,true);
  await resolveQuestionReport(db,reviewer.id,reports[0].id,'resolved');
  await assert.rejects(resolveQuestionReport(db,reviewer.id,reports[0].id,'dismissed'),/already/);
  assert.equal((await listQuestionReports(db,reviewer.id)).length,0);
  // Profile and study plan: countdown, today's answers against the target, weakest topic.
  await assert.rejects(saveProfile(db,student.id,{name:'',country:'',timezone:'',examIds:[],examDate:'',dailyTarget:''}),/name/);
  await assert.rejects(saveProfile(db,student.id,{name:'Sam',country:'',timezone:'Not/AZone',examIds:[],examDate:'',dailyTarget:''}),/timezone/);
  await assert.rejects(saveProfile(db,student.id,{name:'Sam',country:'',timezone:'',examIds:[],examDate:'',dailyTarget:'0'}),/daily target/);
  const examDay=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
  await saveProfile(db,student.id,{name:'  Sam   Student ',country:'Pakistan',timezone:'Asia/Karachi',examIds:[exam.id],examDate:examDay,dailyTarget:'30'});
  const profile=await getProfile(db,student.id);
  assert.equal(profile.name,'Sam Student');assert.deepEqual(profile.examIds,[exam.id]);assert.equal(profile.examDate,examDay);assert.equal(profile.dailyTarget,30);
  const plan=await studyPlan(db,student.id,exam.id);
  assert.ok(plan.daysLeft===10||plan.daysLeft===9||plan.daysLeft===11);
  assert.equal(plan.answeredToday,2);assert.equal(plan.dailyTarget,30);
  assert.deepEqual(plan.weakest.map(w=>[w.topic,w.correct,w.total]),[['Synthetic topic',1,2]]);
  assert.equal((await studyPlan(db,other.id,exam.id)).daysLeft,null);
  // Export: the student's own data, without question content.
  const data=await exportAccountData(db,student.id);
  assert.equal(data.account.email,student.email);assert.equal(data.notes.length,1);assert.equal(data.bookmarks.length,1);assert.ok(data.sessions.length>=1);
  assert.ok(!JSON.stringify(data).includes('Synthetic stem')&&!JSON.stringify(data).includes('Synthetic explanation'));
  // Deletion: confirmed by email, blocked while a plan renews, then anonymised and unable to sign in.
  await assert.rejects(deleteAccount(db,student.id,'wrong@example.test'),/exactly/);
  await assert.rejects(deleteAccount(db,manager.id,manager.email),/Super Admin/);
  const [plan6]=await db.query<{id:string}>(`INSERT INTO plans(exam_id,months,price_cents,active) VALUES($1,6,1000,true) RETURNING id`,[exam.id]);
  const [sub]=await db.query<{id:string}>(`INSERT INTO subscriptions(user_id,exam_id,plan_id,stripe_subscription_id,stripe_customer_id,status) VALUES($1,$2,$3,'sub_test','cus_test','active') RETURNING id`,[student.id,exam.id,plan6.id]);
  await assert.rejects(deleteAccount(db,student.id,student.email),/auto-renew/);
  await db.query('UPDATE subscriptions SET cancel_at_period_end=true WHERE id=$1',[sub.id]);
  await db.query(`INSERT INTO auth_sessions(id,token,user_id,expires_at,created_at,updated_at) VALUES($1,$2,$3,now()+interval '1 day',now(),now())`,[randomUUID(),randomUUID(),student.authId]);
  await deleteAccount(db,student.id,student.email.toUpperCase());
  const [gone]=await db.query<{email:string;name:string;status:string}>('SELECT u.email,u.name,a.status FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1',[student.id]);
  assert.equal(gone.status,'deleted');assert.equal(gone.name,'Deleted account');assert.ok(!gone.email.includes(student.authId));
  assert.equal((await db.query('SELECT 1 FROM auth_sessions WHERE user_id=$1',[student.authId])).length,0);
  assert.equal((await db.query('SELECT 1 FROM question_notes WHERE user_id=$1',[student.id])).length,0);
  assert.equal((await db.query('SELECT 1 FROM subscriptions WHERE id=$1',[sub.id])).length,1);
  assert.equal(await isSuspendedAuthUser(db,student.authId),true);
  await assert.rejects(setBookmark(db,student.id,attempt,1,true),/not found/);
  assert.ok(ids.length===3);
 } finally {await db.close();}
});

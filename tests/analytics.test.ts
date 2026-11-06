import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {embeddedDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {seedCatalogue} from '../lib/db/seed';
import {createRecall,getStudioQuestion,saveStudioDraft,reviewStudioQuestion,setQuestionTags} from '../lib/services/studio';
import {answerQuestion,grantComplimentaryAccess,startAttempt,submitAttempt} from '../lib/services/practice';
import {getProgress} from '../lib/services/analytics';
import {listExams} from '../lib/services/catalogue';
test('Progress analytics: weekly trend, topics, high-yield split, pace and readiness from visible answers only',async()=>{
 const db=embeddedDatabase(new PGlite());
 try {
  await migrate(db);await seedCatalogue(db);
  async function actor(role:string,twoFactor=false) {const authId=randomUUID();await db.query('INSERT INTO auth_users(id,name,email,email_verified,two_factor_enabled,created_at,updated_at) VALUES($1,$2,$3,true,$4,now(),now())',[authId,role,`${authId}@example.test`,twoFactor]);return {id:(await db.query<{id:string}>('INSERT INTO app_users(auth_id,role) VALUES($1,$2) RETURNING id',[authId,role]))[0].id,email:`${authId}@example.test`};}
  const admin=await actor('super_admin',true),manager=await actor('content_manager'),reviewer=await actor('reviewer'),student=await actor('student'),other=await actor('student');
  const exam=(await listExams(db))[0];
  await db.query(`UPDATE exams SET blueprint='{"count":4}',settings=settings||'{"durationMinutes":8,"passMarkPercent":60}' WHERE id=$1`,[exam.id]);
  const topics=await db.query<{id:string}>(`INSERT INTO topics(exam_id,name,slug) VALUES($1,'Alpha','alpha'),($1,'Beta','beta') RETURNING id`,[exam.id]);
  const sittings=await db.query<{id:string}>(`INSERT INTO sittings(exam_id,slug,label,year,month) VALUES($1,'s1','Sitting one',2025,3),($1,'s2','Sitting two',2026,9) RETURNING id`,[exam.id]);
  // Four questions, all with answer B: two in Alpha (one high-yield), two in Beta.
  async function publish(n:number,topic:string,sittingIds:string[]) {
   const id=await createRecall(db,manager.id,{examId:exam.id,sourceLabel:'Synthetic',sourceText:`SOURCE ${n}`,requestId:randomUUID()});
   const first=(await getStudioQuestion(db,reviewer.id,id))!;
   const v=await saveStudioDraft(db,reviewer.id,id,first.versionId,{stem:`Synthetic stem ${n}`,options:['A','B','C','D','E'],correctAnswer:1,explanation:'x',references:['ref']});
   await setQuestionTags(db,manager.id,id,{topicId:topic,difficulty:null,sittingIds});
   await reviewStudioQuestion(db,reviewer.id,id,v,'submit_review',false,'');await reviewStudioQuestion(db,reviewer.id,id,v,'approve',true,'');await reviewStudioQuestion(db,manager.id,id,v,'publish',false,'');
   return id;
  }
  await publish(1,topics[0].id,[sittings[0].id,sittings[1].id]);await publish(2,topics[0].id,[sittings[0].id]);
  await publish(3,topics[1].id,[sittings[1].id]);await publish(4,topics[1].id,[sittings[1].id]);
  for(const u of [student,other])await grantComplimentaryAccess(db,admin.id,{email:u.email,examId:exam.id,days:30});
  const empty=(await getProgress(db,student.id,exam.id))!;
  assert.equal(empty.weeks.length,12);assert.ok(empty.weeks.every(w=>w.answered===0));assert.equal(empty.readiness.tried,0);assert.equal(empty.published,4);
  // Revision: answer all four; Alpha both right, Beta one right one wrong.
  const rev=await startAttempt(db,student.id,{examId:exam.id,mode:'revision',pool:'all',count:4,requestId:randomUUID()});
  const order=await db.query<{position:number;topic:string}>('SELECT i.position,q.topic_id AS topic FROM practice_items i JOIN questions q ON q.id=i.question_id WHERE i.attempt_id=$1 ORDER BY i.position',[rev]);
  let betaWrong=false;
  for(const o of order){const wrong=o.topic===topics[1].id&&!betaWrong;if(wrong)betaWrong=true;await answerQuestion(db,student.id,rev,o.position,{selected:wrong?0:1,confidence:null,timeMs:20000});}
  // An unsubmitted timed exam must not count: its answers have no visible feedback yet.
  const ex=await startAttempt(db,student.id,{examId:exam.id,mode:'exam',pool:'all',count:4,requestId:randomUUID()});
  for(const p of [1,2,3,4])await answerQuestion(db,student.id,ex,p,{selected:0,confidence:null,timeMs:90000});
  let p=(await getProgress(db,student.id,exam.id))!;
  assert.equal(p.weeks.at(-1)!.answered,4);assert.equal(p.weeks.at(-1)!.correct,3);
  assert.deepEqual(p.topics.map(t=>[t.topic,t.correct,t.answered,t.recentAnswered]),[['Alpha',2,2,2],['Beta',1,2,2]]);
  assert.deepEqual(p.highYield.hy,{answered:1,correct:1});assert.deepEqual(p.highYield.other,{answered:3,correct:2});
  assert.equal(p.pace.revisionMs,20000);assert.equal(p.pace.examMs,null);assert.equal(p.pace.examPaceMs,120000);
  assert.deepEqual([p.readiness.tried,p.readiness.recentAnswered,p.readiness.recentCorrect,p.readiness.passMark],[4,4,3,60]);
  // After submission the exam answers count: the latest answer per question now decides topics and coverage.
  await submitAttempt(db,student.id,ex);
  p=(await getProgress(db,student.id,exam.id))!;
  assert.equal(p.weeks.at(-1)!.answered,8);assert.equal(p.weeks.at(-1)!.correct,3);
  assert.ok(p.topics.every(t=>t.correct===0));assert.equal(p.pace.examMs,90000);assert.equal(p.readiness.recentAnswered,8);
  // Another student's answers never appear.
  const o=(await getProgress(db,other.id,exam.id))!;
  assert.equal(o.readiness.tried,0);assert.equal(o.topics.length,0);
 } finally {await db.close();}
});

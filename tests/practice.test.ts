import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {embeddedDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {seedCatalogue} from '../lib/db/seed';
import {createRecall,getStudioQuestion,saveStudioDraft,reviewStudioQuestion} from '../lib/services/studio';
import {answerQuestion,getPracticeQuestion,getResults,grantComplimentaryAccess,listAttemptHistory,listPracticeExams,setFlag,startAttempt,submitAttempt} from '../lib/services/practice';
import {listExams} from '../lib/services/catalogue';
test('Practice: entitlement gate, one question per call, feedback timing, exam deadline, mistakes deck and withdrawal',async()=>{
 const db=embeddedDatabase(new PGlite());
 try {
  await migrate(db);await seedCatalogue(db);
  async function actor(role:string,twoFactor=false,verified=true) {const authId=randomUUID();await db.query('INSERT INTO auth_users(id,name,email,email_verified,two_factor_enabled,created_at,updated_at) VALUES($1,$2,$3,$4,$5,now(),now())',[authId,role,`${authId}@example.test`,verified,twoFactor]);return {id:(await db.query<{id:string}>('INSERT INTO app_users(auth_id,role) VALUES($1,$2) RETURNING id',[authId,role]))[0].id,email:`${authId}@example.test`};}
  const admin=await actor('super_admin',true),manager=await actor('content_manager'),reviewer=await actor('reviewer'),student=await actor('student'),other=await actor('student'),unverified=await actor('student',false,false);
  const exam=(await listExams(db))[0];
  async function publish(n:number) {
   const id=await createRecall(db,manager.id,{examId:exam.id,sourceLabel:'Synthetic',sourceText:`SOURCE ${n}`,requestId:randomUUID()});
   const first=(await getStudioQuestion(db,reviewer.id,id))!;
   const v=await saveStudioDraft(db,reviewer.id,id,first.versionId,{stem:`Synthetic practice stem ${n}`,options:['A','B','C','D','E'],correctAnswer:1,explanation:`Synthetic explanation ${n}`,references:['Synthetic reference']});
   await reviewStudioQuestion(db,reviewer.id,id,v,'submit_review',false,'');await reviewStudioQuestion(db,reviewer.id,id,v,'approve',true,'');await reviewStudioQuestion(db,manager.id,id,v,'publish',false,'');
   return {id,v};
  }
  const published=[await publish(1),await publish(2),await publish(3)];
  const draft=await createRecall(db,manager.id,{examId:exam.id,sourceLabel:'Synthetic',sourceText:'DRAFT ONLY',requestId:randomUUID()});
  const start=(over:Partial<Parameters<typeof startAttempt>[2]>={})=>({examId:exam.id,mode:'revision' as const,pool:'all' as const,count:10,requestId:randomUUID(),...over});
  // Access comes from entitlements only, granted by an MFA-enabled Super Admin.
  await assert.rejects(startAttempt(db,student.id,start()),/access/);
  await assert.rejects(grantComplimentaryAccess(db,manager.id,{email:student.email,examId:exam.id,days:30}),/Super Admin/);
  await assert.rejects(grantComplimentaryAccess(db,admin.id,{email:unverified.email,examId:exam.id,days:30}),/verified/);
  await grantComplimentaryAccess(db,admin.id,{email:student.email.toUpperCase(),examId:exam.id,days:30});
  await db.query("INSERT INTO entitlements(user_id,exam_id,source,starts_at,ends_at) VALUES($1,$2,'trial',now(),now()+interval '1 day')",[other.id,exam.id]);
  await assert.rejects(startAttempt(db,other.id,start()),/access/);
  await assert.rejects(listPracticeExams(db,unverified.id),/Verify/);
  assert.equal((await listPracticeExams(db,student.id))[0].published,3);
  // Revision Mode: published questions only, idempotent start, feedback after answering, locked answers.
  const request=start();
  const attempt=await startAttempt(db,student.id,request);
  assert.equal(await startAttempt(db,student.id,request),attempt);
  const view=await getPracticeQuestion(db,student.id,attempt,1);
  assert.equal(view.attempt.total,3);assert.equal(view.feedback,null);
  assert.ok(!JSON.stringify(view).includes('Synthetic explanation'));assert.ok(!JSON.stringify(view).includes('Synthetic reference'));
  assert.equal(view.navigator.length,3);assert.ok(!('stem' in view.navigator[0]));
  const stems=new Set<string>();for(const p of [1,2,3])stems.add((await getPracticeQuestion(db,student.id,attempt,p)).question.stem);
  assert.ok(![...stems].some(s=>s===''||s.includes('DRAFT')));assert.equal(stems.size,3);
  assert.ok((await db.query('SELECT 1 FROM practice_items WHERE question_id=$1',[draft])).length===0);
  await assert.rejects(getPracticeQuestion(db,other.id,attempt,1),/not found/);
  await assert.rejects(getPracticeQuestion(db,student.id,attempt,4),/not found/);
  await answerQuestion(db,student.id,attempt,1,{selected:0,confidence:'guess',timeMs:4200});
  await assert.rejects(answerQuestion(db,student.id,attempt,1,{selected:1,confidence:null,timeMs:1}),/already/);
  await assert.rejects(answerQuestion(db,other.id,attempt,2,{selected:1,confidence:null,timeMs:1}),/not found/);
  const answered=await getPracticeQuestion(db,student.id,attempt,1);
  assert.equal(answered.feedback?.correct,false);assert.equal(answered.feedback?.correctAnswer,1);assert.deepEqual(answered.feedback?.distribution,[100,0,0,0,0]);
  assert.equal(answered.question.confidence,'guess');
  await answerQuestion(db,student.id,attempt,2,{selected:1,confidence:'sure',timeMs:1000});
  await submitAttempt(db,student.id,attempt);
  await assert.rejects(answerQuestion(db,student.id,attempt,3,{selected:1,confidence:null,timeMs:1}),/finished/);
  const revision=await getResults(db,student.id,attempt);
  assert.equal(revision.scored,2);assert.equal(revision.correct,1);assert.equal(revision.percent,50);assert.equal(revision.passed,null);
  // Mistakes deck: the wrong answer stays until answered correctly twice.
  const [wrong]=await db.query<{question_id:string}>('SELECT question_id FROM practice_items WHERE attempt_id=$1 AND position=1',[attempt]);
  for(const round of [1,2,3]) {
   const deck=await startAttempt(db,student.id,start({pool:'mistakes'}));
   const items=await db.query<{question_id:string}>('SELECT question_id FROM practice_items WHERE attempt_id=$1',[deck]);
   assert.deepEqual(items.map(i=>i.question_id),[wrong.question_id]);
   await answerQuestion(db,student.id,deck,1,{selected:round===1?3:1,confidence:null,timeMs:10});await submitAttempt(db,student.id,deck);
  }
  await assert.rejects(startAttempt(db,student.id,start({pool:'mistakes'})),/No questions match/);
  assert.equal((await listPracticeExams(db,student.id))[0].mistakes,0);
  // Exam Mode: requires configured timing, hides feedback until submission, accepts changes, and the server deadline submits.
  await assert.rejects(startAttempt(db,student.id,start({mode:'exam'})),/not yet configured/);
  await db.query(`UPDATE exams SET blueprint='{"count":3}',settings='{"durationMinutes":3,"passMarkPercent":60}' WHERE id=$1`,[exam.id]);
  const timed=await startAttempt(db,student.id,start({mode:'exam'}));
  const deadline=(await getPracticeQuestion(db,student.id,timed,1)).attempt.deadlineAt!;
  assert.ok(Math.abs(Date.parse(deadline)-Date.now()-180000)<5000);
  await answerQuestion(db,student.id,timed,1,{selected:0,confidence:null,timeMs:500});
  await answerQuestion(db,student.id,timed,1,{selected:1,confidence:'unsure',timeMs:500});
  await setFlag(db,student.id,timed,2,true);
  const hidden=await getPracticeQuestion(db,student.id,timed,1);
  assert.equal(hidden.feedback,null);assert.equal(hidden.question.selected,1);assert.equal(hidden.navigator[1].flagged,true);
  await assert.rejects(getResults(db,student.id,timed),/Finish/);
  await db.query("UPDATE practice_attempts SET deadline_at=now()-interval '10 seconds' WHERE id=$1",[timed]);
  await assert.rejects(answerQuestion(db,student.id,timed,2,{selected:1,confidence:null,timeMs:1}),/submitted/);
  const examResult=await getResults(db,student.id,timed);
  assert.equal(examResult.scored,3);assert.equal(examResult.correct,1);assert.equal(examResult.passed,false);assert.equal(examResult.items[0].timeMs,1000);
  assert.equal((await getPracticeQuestion(db,student.id,timed,1)).feedback?.correct,true);
  // A retired question is withdrawn from delivery and scoring.
  await reviewStudioQuestion(db,manager.id,published[1].id,published[1].v,'retire',false,'');
  const [retiredItem]=await db.query<{position:number}>('SELECT position FROM practice_items WHERE attempt_id=$1 AND question_id=$2',[timed,published[1].id]);
  const withdrawn=await getPracticeQuestion(db,student.id,timed,retiredItem.position);
  assert.equal(withdrawn.question.withdrawn,true);assert.equal(withdrawn.question.stem,'');assert.equal(withdrawn.feedback,null);
  assert.equal((await getResults(db,student.id,timed)).scored,2);
  // Session history scores each attempt exactly as its results report does, filters by mode and stays private.
  const history=await listAttemptHistory(db,student.id,{examId:exam.id});
  assert.deepEqual([history.counts.all,history.counts.revision,history.counts.exam,history.counts.open],[5,4,1,0]);
  const timedRow=history.rows.find(r=>r.id===timed)!,timedReport=await getResults(db,student.id,timed);
  assert.equal(timedRow.scored,timedReport.scored);assert.equal(timedRow.percent,timedReport.percent);assert.equal(timedRow.passed,timedReport.passed);assert.ok(timedRow.finishedAt);
  // Question order is random, so the retired question may or may not be one this revision answered.
  assert.equal(history.rows.find(r=>r.id===attempt)!.percent,(await getResults(db,student.id,attempt)).percent);
  assert.deepEqual((await listAttemptHistory(db,student.id,{filter:'exam'})).rows.map(r=>r.id),[timed]);
  assert.equal((await listAttemptHistory(db,other.id)).counts.all,0);
  assert.ok((await db.query("SELECT 1 FROM audit_log WHERE action='entitlement.granted'")).length===1);
 }finally{await db.close();}
});

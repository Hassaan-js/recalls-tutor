import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {embeddedDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {seedCatalogue} from '../lib/db/seed';
import {createRecall,getStudioQuestion,saveStudioDraft,reviewStudioQuestion,setQuestionTags} from '../lib/services/studio';
import {answerQuestion,grantComplimentaryAccess,startAttempt,submitAttempt} from '../lib/services/practice';
import {DISCLAIMER,estimate,getPrediction,outcomePrompt,predictorCalibration,recordOutcome} from '../lib/services/predictor';
import {listExams} from '../lib/services/catalogue';
const inputs=(o:Partial<Parameters<typeof estimate>[0]>={})=>({papers:[{score:70,at:''}],firstAttempt:{answered:300,correct:210},highYield:{answered:50,correct:35},latest:{label:'S',answered:40,correct:28},
 coverage:{tried:90,published:100},pace:{studentMs:null,examMs:null},confidence:{sure:0,sureWrong:0},answered:400,...o});
test('Pass Predictor rule: weights, bands against the pass mark, range and pace',()=>{
 const e=estimate(inputs(),60)!;
 assert.equal(e.score,70);assert.equal(e.low,63);assert.equal(e.high,77);assert.equal(e.band,'likely');// ±4, plus 3 because there is one paper rather than three
 assert.equal(estimate(inputs({papers:[{score:70,at:''},{score:70,at:''},{score:70,at:''}]}),60)!.band,'very_likely');
 assert.equal(estimate(inputs(),68)!.band,'borderline');assert.equal(estimate(inputs(),80)!.band,'low');
 assert.equal(estimate(inputs(),null)!.band,null);// no pass mark, no band
 assert.equal(estimate(inputs({papers:[]}),60),null);
 // Most recent paper counts most: 80 then 60 → (80 + 0.5×60)/1.5.
 const recent=estimate(inputs({papers:[{score:80,at:''},{score:60,at:''}]}),60)!;
 assert.ok(Math.abs(recent.parts[0].value!-73.33)<0.01);
 // Missing parts drop out and the rest are scaled up.
 const thin=estimate(inputs({highYield:{answered:3,correct:3},latest:{label:null,answered:0,correct:0}}),60)!;
 assert.equal(thin.parts[2].value,null);assert.equal(thin.score,70);
 // Slow timed practice costs up to 5 points; low coverage and overconfidence widen the range.
 const slow=estimate(inputs({pace:{studentMs:150000,examMs:100000}}),60)!;
 assert.equal(slow.adjustments[0].points,-5);assert.equal(slow.score,65);
 const wide=estimate(inputs({coverage:{tried:10,published:100},confidence:{sure:100,sureWrong:40}}),60)!;
 assert.ok(wide.high-wide.low>e.high-e.low);assert.equal(wide.spreadReasons.length,3);
 assert.match(DISCLAIMER,/not a guarantee/);
});
test('Pass Predictor: unlock rules, prediction, trend, topics, daily target and outcomes',async()=>{
 const db=embeddedDatabase(new PGlite());
 try {
  await migrate(db);await seedCatalogue(db);
  async function actor(role:string,twoFactor=false) {const authId=randomUUID();await db.query('INSERT INTO auth_users(id,name,email,email_verified,two_factor_enabled,created_at,updated_at) VALUES($1,$2,$3,true,$4,now(),now())',[authId,role,`${authId}@example.test`,twoFactor]);return {id:(await db.query<{id:string}>('INSERT INTO app_users(auth_id,role) VALUES($1,$2) RETURNING id',[authId,role]))[0].id,email:`${authId}@example.test`};}
  const admin=await actor('super_admin',true),manager=await actor('content_manager'),reviewer=await actor('reviewer'),student=await actor('student'),trialist=await actor('student');
  const exam=(await listExams(db))[0];
  await db.query(`UPDATE exams SET blueprint='{"count":10}',settings=settings||'{"durationMinutes":20,"passMarkPercent":60}' WHERE id=$1`,[exam.id]);
  const topics=await db.query<{id:string}>(`INSERT INTO topics(exam_id,name,slug) VALUES($1,'Alpha','alpha'),($1,'Beta','beta'),($1,'Gamma','gamma'),($1,'Delta','delta') RETURNING id`,[exam.id]);
  const [sitting]=await db.query<{id:string}>(`INSERT INTO sittings(exam_id,slug,label,year,published) VALUES($1,'s1','Sitting one',2026,true) RETURNING id`,[exam.id]);
  const ids:string[]=[];
  for(let n=0;n<10;n++){
   const id=await createRecall(db,manager.id,{examId:exam.id,sourceLabel:'Synthetic',sourceText:`SOURCE ${n}`,requestId:randomUUID()});
   const first=(await getStudioQuestion(db,reviewer.id,id))!;
   const v=await saveStudioDraft(db,reviewer.id,id,first.versionId,{stem:`Synthetic stem ${n}`,options:['A','B','C','D','E'],correctAnswer:1,explanation:'x',references:['ref']});
   await setQuestionTags(db,manager.id,id,{topicId:topics[n%4].id,difficulty:null,sittingIds:[sitting.id]});
   await reviewStudioQuestion(db,reviewer.id,id,v,'submit_review',false,'');await reviewStudioQuestion(db,reviewer.id,id,v,'approve',true,'');await reviewStudioQuestion(db,manager.id,id,v,'publish',false,'');ids.push(id);
  }
  await grantComplimentaryAccess(db,admin.id,{email:student.email,examId:exam.id,days:30});
  let p=(await getPrediction(db,student.id,exam.id))!;
  assert.equal(p.unlocked,false);assert.equal(p.estimate,null);assert.deepEqual(p.progress,{papers:0,answered:0});
  // A complete timed set (as long as the real exam): 7 of 10 right, Alpha questions wrong.
  const ex=await startAttempt(db,student.id,{examId:exam.id,mode:'exam',pool:'all',count:10,requestId:randomUUID()});
  const order=await db.query<{position:number;topic:string}>('SELECT i.position,q.topic_id AS topic FROM practice_items i JOIN questions q ON q.id=i.question_id WHERE i.attempt_id=$1 ORDER BY i.position',[ex]);
  for(const o of order)await answerQuestion(db,student.id,ex,o.position,{selected:o.topic===topics[0].id?0:1,confidence:'sure',timeMs:100000});
  await submitAttempt(db,student.id,ex);
  p=(await getPrediction(db,student.id,exam.id))!;
  assert.equal(p.unlocked,false);assert.deepEqual(p.progress,{papers:1,answered:10});// 300 answers needed
  // 290 more revision answers (synthetic, inserted directly): 29 sessions over the bank, Alpha still wrong.
  await db.query(`WITH a AS (INSERT INTO practice_attempts(user_id,exam_id,mode,pool,request_id,started_at,submitted_at) SELECT $1,$2,'revision','all',gen_random_uuid(),now()-make_interval(days=>g),now()-make_interval(days=>g) FROM generate_series(1,29) g RETURNING id,started_at)
   INSERT INTO practice_items(attempt_id,position,question_id,version_id,selected,correct,answered_at,time_ms)
   SELECT a.id,row_number() OVER (PARTITION BY a.id ORDER BY q.id),q.id,q.current_version_id,CASE WHEN q.topic_id=$3 THEN 0 ELSE 1 END,q.topic_id<>$3,a.started_at,30000 FROM a CROSS JOIN questions q WHERE q.exam_id=$2 AND q.status='published'`,[student.id,exam.id,topics[0].id]);
  p=(await getPrediction(db,student.id,exam.id))!;
  assert.equal(p.unlocked,true);assert.ok(p.estimate);
  const e=p.estimate!;
  assert.equal(Math.round(e.parts[0].value!),70);assert.equal(e.band!==null,true);assert.ok(e.low<=e.score&&e.score<=e.high);
  // Bank fully tried, one paper, every "sure" answer counted: the range reflects that.
  assert.ok(e.spreadReasons.some(r=>/one complete paper/.test(r)));
  // 4-week trend: weeks before the paper have no estimate.
  assert.equal(p.trend.length,4);assert.deepEqual(p.trend.slice(0,3).map(t=>t.score),[null,null,null]);assert.equal(p.trend[3].score,e.score);
  // Top topics: Alpha (never right) gives the most marks per hour; topics already all right are not listed.
  assert.equal(p.topics[0].name,'Alpha');assert.equal(p.topics.length,1);assert.equal(p.topics[0].remaining,3);
  assert.ok(p.daily);assert.equal(p.daily!.days,28);
  // A trial student sees the teaser, never a prediction.
  await db.query(`INSERT INTO entitlements(user_id,exam_id,source,starts_at,ends_at) VALUES($1,$2,'trial',now(),now()+interval '3 days')`,[trialist.id,exam.id]);
  const t=(await getPrediction(db,trialist.id,exam.id))!;assert.equal(t.trial,true);assert.equal(t.unlocked,false);assert.equal(t.estimate,null);
  // PP-3: after the exam date, ask once; the band at the time is kept with the answer.
  await db.query(`INSERT INTO student_profiles(user_id,exam_ids,exam_date) VALUES($1,ARRAY[$2::uuid],current_date-1)`,[student.id,exam.id]);
  assert.equal(await outcomePrompt(db,student.id,exam.id),true);
  await assert.rejects(recordOutcome(db,student.id,exam.id,{passed:true,satOn:'2999-01-01'}),/date you sat/);
  await recordOutcome(db,student.id,exam.id,{passed:true,satOn:null});
  assert.equal(await outcomePrompt(db,student.id,exam.id),false);
  const [row]=await db.query<{band:string;passed:boolean}>('SELECT band,passed FROM pass_outcomes WHERE user_id=$1',[student.id]);
  assert.equal(row.band,e.band);assert.equal(row.passed,true);
  const cal=await predictorCalibration(db);assert.equal(cal.find(c=>c.examId===exam.id&&c.band===e.band)!.passed,1);
 } finally {await db.close();}
});

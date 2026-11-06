import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {embeddedDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {seedCatalogue} from '../lib/db/seed';
import {createRecall,getStudioQuestion,saveStudioDraft,reviewStudioQuestion,setQuestionTags} from '../lib/services/studio';
import {grantComplimentaryAccess,startAttempt} from '../lib/services/practice';
import {saveNote} from '../lib/services/student';
import {dueReviewIds,exportNotes,reviewSummary,schedule,studyPlanner} from '../lib/services/review';
import {listExams} from '../lib/services/catalogue';
const DAY=86400_000,T0=Date.parse('2026-10-01T09:00:00Z');
const at=(d:number,h=0)=>new Date(T0+d*DAY+h*3600_000).toISOString();
const a=(q:string,correct:boolean,d:number,confidence:string|null=null)=>({question_id:q,correct,confidence,answered_at:at(d)});
test('Spaced repetition: 1, 3, 7, 14 days; wrong resets; cramming does not advance; unsure joins the deck',()=>{
 // Wrong on day 0 → due day 1; right on day 1 → due day 4 (3 days); day 4 → due 11 (7 days); day 11 → due 25 (14 days); day 25 → out.
 let d=schedule([a('q',false,0)]);assert.equal(d.get('q')!.due,T0+DAY);assert.equal(d.get('q')!.step,0);
 d=schedule([a('q',false,0),a('q',true,1)]);assert.equal(d.get('q')!.step,1);assert.equal(d.get('q')!.due,T0+4*DAY);
 d=schedule([a('q',false,0),a('q',true,1),a('q',true,4),a('q',true,11)]);assert.equal(d.get('q')!.step,3);assert.equal(d.get('q')!.due,T0+25*DAY);
 d=schedule([a('q',false,0),a('q',true,1),a('q',true,4),a('q',true,11),a('q',true,25)]);assert.equal(d.has('q'),false);
 // A correct answer the same day (before it is due) neither advances nor resets.
 d=schedule([a('q',false,0),{question_id:'q',correct:true,confidence:null,answered_at:at(0,2)}]);assert.equal(d.get('q')!.step,0);assert.equal(d.get('q')!.due,T0+DAY);
 // Wrong at any step starts again at 1 day.
 d=schedule([a('q',false,0),a('q',true,1),a('q',true,4),a('q',false,6)]);assert.equal(d.get('q')!.step,0);assert.equal(d.get('q')!.due,T0+7*DAY);
 // Right first time and sure: not in the deck. Right but unsure or a guess: joins it.
 assert.equal(schedule([a('s',true,0,'sure')]).size,0);assert.equal(schedule([a('n',true,0)]).size,0);
 assert.equal(schedule([a('u',true,0,'unsure')]).get('u')!.step,0);assert.equal(schedule([a('g',true,0,'guess')]).size,1);
});
test('Review pool, planner, streak and notes export',async()=>{
 const db=embeddedDatabase(new PGlite());
 try {
  await migrate(db);await seedCatalogue(db);
  async function actor(role:string,twoFactor=false) {const authId=randomUUID();await db.query('INSERT INTO auth_users(id,name,email,email_verified,two_factor_enabled,created_at,updated_at) VALUES($1,$2,$3,true,$4,now(),now())',[authId,role,`${authId}@example.test`,twoFactor]);return {id:(await db.query<{id:string}>('INSERT INTO app_users(auth_id,role) VALUES($1,$2) RETURNING id',[authId,role]))[0].id,email:`${authId}@example.test`};}
  const admin=await actor('super_admin',true),manager=await actor('content_manager'),reviewer=await actor('reviewer'),student=await actor('student');
  const exam=(await listExams(db))[0];
  const [topic]=await db.query<{id:string}>(`INSERT INTO topics(exam_id,name,slug) VALUES($1,'Alpha','alpha') RETURNING id`,[exam.id]);
  const ids:string[]=[];
  for(let n=0;n<6;n++){const id=await createRecall(db,manager.id,{examId:exam.id,sourceLabel:'Synthetic',sourceText:`SOURCE ${n}`,requestId:randomUUID()});
   const first=(await getStudioQuestion(db,reviewer.id,id))!;const v=await saveStudioDraft(db,reviewer.id,id,first.versionId,{stem:`Synthetic stem ${n}`,options:['A','B','C','D','E'],correctAnswer:1,explanation:'x',references:['ref']});
   await setQuestionTags(db,manager.id,id,{topicId:topic.id,difficulty:null,sittingIds:[]});
   await reviewStudioQuestion(db,reviewer.id,id,v,'submit_review',false,'');await reviewStudioQuestion(db,reviewer.id,id,v,'approve',true,'');await reviewStudioQuestion(db,manager.id,id,v,'publish',false,'');ids.push(id);}
  await grantComplimentaryAccess(db,admin.id,{email:student.email,examId:exam.id,days:30});
  // Synthetic answers: q0 and q1 wrong 2 days ago (due), q2 wrong just now (due tomorrow), q3 right and sure; one each day for 3 days.
  const answer=async(q:string,correct:boolean,ago:string,confidence:string|null=null)=>{const [att]=await db.query<{id:string}>(`INSERT INTO practice_attempts(user_id,exam_id,mode,pool,request_id,started_at) VALUES($1,$2,'revision','all',gen_random_uuid(),now()-$3::interval) RETURNING id`,[student.id,exam.id,ago]);
   await db.query(`INSERT INTO practice_items(attempt_id,position,question_id,version_id,selected,correct,confidence,answered_at,time_ms) SELECT $1,1,id,current_version_id,$3,$4,$5,now()-$6::interval,20000 FROM questions WHERE id=$2`,[att.id,q,correct?1:0,correct,confidence,ago]);return att.id;};
  await answer(ids[0],false,'2 days');await answer(ids[1],false,'1 day 1 hour');await answer(ids[2],false,'1 minute');await answer(ids[3],true,'1 minute','sure');
  const due=await dueReviewIds(db,student.id,exam.id);
  assert.deepEqual(due.sort(),[ids[0],ids[1]].sort());
  const summary=await reviewSummary(db,student.id,exam.id);
  assert.equal(summary.due,2);assert.equal(summary.inDeck,3);assert.deepEqual(summary.byStep,[3,0,0,0]);assert.equal(summary.upcoming.reduce((s,u)=>s+u.count,0),1);
  // The review pool only contains due questions.
  const session=await startAttempt(db,student.id,{examId:exam.id,mode:'revision',pool:'review',count:20,requestId:randomUUID()});
  assert.deepEqual((await db.query<{question_id:string}>('SELECT question_id FROM practice_items WHERE attempt_id=$1',[session])).map(r=>r.question_id).sort(),[ids[0],ids[1]].sort());
  // Planner: streak across three days, default target, reviews today, new questions to fill the target.
  const plan=await studyPlanner(db,student.id,exam.id);
  assert.equal(plan.streak,3);assert.equal(plan.bestStreak,3);assert.equal(plan.targetSource,'default');assert.equal(plan.dailyTarget,20);
  assert.equal(plan.days.length,7);assert.equal(plan.days[0].label,'Today');assert.equal(plan.days[0].reviews,2);assert.equal(plan.days[1].reviews,1);// two due today, one tomorrow
  assert.equal(plan.days[0].newQuestions,2);// only 2 questions never seen
  assert.equal(plan.days[0].focus!.name,'Alpha');assert.equal(plan.paperReady,false);assert.equal(plan.days.some(d=>d.paper),false);
  // With an exam date in 3 days and timing configured, the week stops at exam day.
  await db.query(`INSERT INTO student_profiles(user_id,exam_date,daily_target) VALUES($1,current_date+3,5)`,[student.id]);
  await db.query(`UPDATE exams SET blueprint='{"count":6}',settings=settings||'{"durationMinutes":12}' WHERE id=$1`,[exam.id]);
  const short=await studyPlanner(db,student.id,exam.id);
  assert.equal(short.days.length,4);assert.equal(short.daysLeft,3);assert.equal(short.dailyTarget,5);assert.equal(short.paperReady,true);
  // Notes export has the student's own words and no question text.
  await saveNote(db,student.id,session,1,'Remember: line one\nline two');
  const notes=await exportNotes(db,student.id);
  assert.match(notes,/## /);assert.match(notes,/### Alpha/);assert.match(notes,/- Remember: line one\n  line two/);assert.doesNotMatch(notes,/Synthetic stem/);
 } finally {await db.close();}
});

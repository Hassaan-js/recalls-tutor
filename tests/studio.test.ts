import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {embeddedDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {seedCatalogue} from '../lib/db/seed';
import {createRecall,getStudioQuestion,listStudioQuestions,saveStudioDraft,reviewStudioQuestion} from '../lib/services/studio';
import {listExams} from '../lib/services/catalogue';
test('Studio: private evidence, idempotent intake, immutable edits, review gates and publication',async()=>{
 const db=embeddedDatabase(new PGlite());
 try {
  await migrate(db);await seedCatalogue(db);
  async function actor(role:string) {const authId=randomUUID();await db.query('INSERT INTO auth_users(id,name,email,email_verified,created_at,updated_at) VALUES($1,$2,$3,true,now(),now())',[authId,role,`${authId}@example.test`]);return (await db.query<{id:string}>('INSERT INTO app_users(auth_id,role) VALUES($1,$2) RETURNING id',[authId,role]))[0].id;}
  const manager=await actor('content_manager'),reviewer=await actor('reviewer'),student=await actor('student');
  const exam=(await listExams(db))[0];
  const input={examId:exam.id,sourceLabel:'Synthetic test source',sourceText:'PRIVATE SOURCE TEST ONLY',requestId:randomUUID()};
  await assert.rejects(createRecall(db,student,input),/permission/);
  await assert.rejects(createRecall(db,reviewer,input),/permission/);
  const id=await createRecall(db,manager,input);
  assert.equal(await createRecall(db,manager,input),id);
  await assert.rejects(createRecall(db,manager,{...input,sourceText:'different'}),/already used/);
  await assert.rejects(listStudioQuestions(db,student),/permission/);
  const first=await getStudioQuestion(db,reviewer,id);assert.ok(first);
  await assert.rejects(reviewStudioQuestion(db,reviewer,id,first.versionId,'submit_review',false,''),/Complete/);
  const draft={stem:'Synthetic workflow test question',options:['One','Two','Three','Four','Five'],correctAnswer:0,explanation:'Synthetic nonclinical test explanation',references:['Synthetic test reference; not clinical content']};
  const version=await saveStudioDraft(db,reviewer,id,first.versionId,draft);
  await assert.rejects(saveStudioDraft(db,reviewer,id,first.versionId,draft),/changed/);
  await assert.rejects(db.query('UPDATE question_versions SET stem=$1 WHERE id=$2',['tampered',version]),/immutable/);
  await assert.rejects(reviewStudioQuestion(db,manager,id,version,'publish',false,''),/not available/);
  await reviewStudioQuestion(db,reviewer,id,version,'submit_review',false,'');
  await assert.rejects(reviewStudioQuestion(db,reviewer,id,version,'approve',false,''),/Confirm/);
  await reviewStudioQuestion(db,reviewer,id,version,'approve',true,'');
  await assert.rejects(reviewStudioQuestion(db,reviewer,id,version,'publish',false,''),/permission/);
  await reviewStudioQuestion(db,manager,id,version,'request_changes',false,'Revise explanation');
  const revised=await saveStudioDraft(db,reviewer,id,version,{...draft,explanation:'Revised synthetic explanation'});
  assert.equal((await getStudioQuestion(db,reviewer,id))?.status,'raw');
  await reviewStudioQuestion(db,reviewer,id,revised,'submit_review',false,'');
  await reviewStudioQuestion(db,reviewer,id,revised,'approve',true,'');
  await reviewStudioQuestion(db,manager,id,revised,'publish',false,'');
  assert.equal((await listExams(db)).find(e=>e.id===exam.id)?.questionCount,1);
  await assert.rejects(saveStudioDraft(db,manager,id,revised,draft),/cannot be edited/);
  const detail=await getStudioQuestion(db,reviewer,id);assert.equal(detail?.history.length,3);assert.equal(detail?.sourceText,input.sourceText);
  assert.ok(!JSON.stringify(await listExams(db)).includes(input.sourceText));
  await reviewStudioQuestion(db,manager,id,revised,'retire',false,'');
  assert.equal((await listExams(db)).find(e=>e.id===exam.id)?.questionCount,0);
  assert.ok((await db.query('SELECT id FROM audit_log WHERE entity_id=$1',[id])).length>=9);
 }finally{await db.close();}
});

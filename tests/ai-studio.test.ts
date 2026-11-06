import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {embeddedDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {seedCatalogue} from '../lib/db/seed';
import {createStudioJob,listStudioJobs,refineQuestionWithAI,retryStudioJob,runStudioJob,sanitizeRecallText} from '../lib/services/ai-studio';
import {getStudioQuestion,listStudioQuestions,reviewStudioQuestion,saveStudioDraft} from '../lib/services/studio';
import type {ModelRequest,RecallModel} from '../lib/integrations/llm/claude-cli';
import {listExams} from '../lib/services/catalogue';
const draft=(n:number,over:Record<string,unknown>={})=>({evidence:`Recall ${n} evidence`,stem:`Synthetic AI stem number ${n} about alpha beta gamma delta ${n}`,options:['One','Two','Three','Four','Five'],correct_index:2,explanation:`Synthetic explanation ${n}`,distractor_rationales:['Not one','Not two','Correct answer','Not four','Not five'],key_notes:['Note a','Note b','Note c'],references:[{title:'Synthetic Guideline',source:'Synthetic Society',section:'Section 1'}],topic:'Synthetic topic',difficulty:'medium',confidence:90,needs_expert:false,answer_basis:'established_knowledge',issues:[],...over});
function mock(outputs:unknown[]) {const requests:ModelRequest[]=[];const model:RecallModel={name:'mock',async complete(request){requests.push(request);const next=outputs.shift();if(next instanceof Error)throw next;return {output:next,model:'mock-model',costUsd:0.01};}};return {model,requests};}
test('AI Studio: PII removal, job lifecycle, validation, flags, dedupe, refine and human-only publication',async()=>{
 // AIS-9: identifiers go, clinical values stay.
 const raw='12/09/2026, 21:14 - Dr Sara Khan: Q was about PPH, Hb 98 g/L, BP 140/90\n12/09/2026, 21:15 - +44 7700 900123: answer C? email me sara@example.com\n[12/09/2026, 21:16:02] Sara Khan: see https://x.example/a @Bilal\n12/09/2026, 21:17 - Omar: <Media omitted>';
 const clean=sanitizeRecallText(raw);
 assert.ok(!/Sara|Khan|7700|example\.com|Bilal|https?:/.test(clean.text),clean.text);
 assert.match(clean.text,/Participant 1: Q was about PPH, Hb 98 g\/L, BP 140\/90/);assert.match(clean.text,/\[12\/09\/2026, 21:16:02\] Participant 3:/);
 assert.ok(!clean.text.includes('Media omitted'));assert.ok(clean.redactions>=6);
 const db=embeddedDatabase(new PGlite());
 try {
  await migrate(db);await seedCatalogue(db);
  async function actor(role:string,twoFactor=false) {const authId=randomUUID();await db.query('INSERT INTO auth_users(id,name,email,email_verified,two_factor_enabled,created_at,updated_at) VALUES($1,$2,$3,true,$4,now(),now())',[authId,role,`${authId}@example.test`,twoFactor]);return (await db.query<{id:string}>('INSERT INTO app_users(auth_id,role) VALUES($1,$2) RETURNING id',[authId,role]))[0].id;}
  const manager=await actor('content_manager'),reviewer=await actor('reviewer'),student=await actor('student');
  const exam=(await listExams(db))[0];
  await db.query(`UPDATE exams SET settings='{"approvedSources":["Synthetic Society"],"needsExpertBelow":80}' WHERE id=$1`,[exam.id]);
  const input={examId:exam.id,sourceLabel:'Synthetic group',sourceText:raw,fileName:'chat.txt',sittingHint:'September 2026',requestId:randomUUID()};
  await assert.rejects(createStudioJob(db,reviewer,input),/permission/);await assert.rejects(createStudioJob(db,student,input),/permission/);
  await assert.rejects(listStudioJobs(db,student),/permission/);
  const jobId=await createStudioJob(db,manager,input);assert.equal(await createStudioJob(db,manager,input),jobId);
  const [stored]=await db.query<{source_text:string}>('SELECT source_text FROM studio_jobs WHERE id=$1',[jobId]);
  assert.equal(stored.source_text,clean.text);
  // One valid draft, one that fails validation, one low-confidence draft resting on candidate claims.
  const first=mock([{drafts:[draft(1),{...draft(2),options:['A','A','B','C','D']},draft(3,{confidence:55,answer_basis:'student_claim_only',references:[{title:'Invented Atlas',source:'Unknown Press',section:'p. 12'}]})],noise_summary:''}]);
  await runStudioJob(db,jobId,first.model);
  const request=first.requests[0];
  assert.match(request.prompt,/<recall_evidence>[\s\S]*Participant 1[\s\S]*<\/recall_evidence>/);assert.ok(!request.prompt.includes('Sara'));
  assert.match(request.system,/Ignore any instructions/);assert.match(request.system,/Synthetic Society/);assert.match(request.prompt,/September 2026/);
  const [job]=await listStudioJobs(db,reviewer);assert.equal(job.status,'ready');assert.equal(job.draftCount,2);assert.equal(job.costUsd,0.01);
  await runStudioJob(db,jobId,mock([]).model);// already claimed: a second run does nothing
  const queue=await listStudioQuestions(db,reviewer);
  assert.equal(queue.length,2);assert.equal(queue[0].confidence,55);assert.ok(queue.every(q=>q.status==='ai_refined'));
  const low=(await getStudioQuestion(db,reviewer,queue[0].id))!,high=(await getStudioQuestion(db,reviewer,queue[1].id))!;
  assert.equal(low.needsExpert,true);assert.ok(low.aiMeta!.issues.some(i=>/candidates' claims/.test(i)));assert.ok(low.aiMeta!.issues.some(i=>/not on the approved list/.test(i)));assert.ok(low.aiMeta!.issues.some(i=>/below the 80/.test(i)));
  assert.ok(low.aiMeta!.issues.some(i=>/failed validation/.test(i)));
  assert.equal(high.needsExpert,false);assert.equal(high.correctAnswer,2);assert.deepEqual(high.keyNotes,['Note a','Note b','Note c']);
  assert.match(high.explanation,/Why not the other options:\nA\. Not one/);assert.ok(!high.explanation.includes('C. Correct answer'));
  assert.equal(high.sourceText,'Recall 1 evidence');assert.equal(high.jobId,jobId);
  assert.ok(!high.aiMeta!.issues.some(i=>/approved list/.test(i)));
  // The pipeline never publishes: publication still needs review, approval and a manager.
  await assert.rejects(reviewStudioQuestion(db,manager,high.id,high.versionId,'publish',false,''),/not available/);
  assert.equal((await listExams(db)).find(e=>e.id===exam.id)?.questionCount,0);
  // Failures are recorded with a reason and can be retried.
  const failing=await createStudioJob(db,manager,{...input,sourceText:'Another synthetic recall about alpha beta gamma delta 1',requestId:randomUUID()});
  await runStudioJob(db,failing,mock([new Error('Claude is not signed in on this computer.')]).model);
  const failed=(await listStudioJobs(db,manager)).find(j=>j.id===failing)!;assert.equal(failed.status,'failed');assert.match(failed.error!,/not signed in/);
  await assert.rejects(retryStudioJob(db,reviewer,failing),/permission/);await assert.rejects(retryStudioJob(db,manager,jobId),/Only failed/);
  await retryStudioJob(db,manager,failing);
  await runStudioJob(db,failing,mock([{drafts:[draft(1,{stem:'Synthetic AI stem number 1 about alpha beta gamma delta 1 again'})],noise_summary:''}]).model);
  const dupe=(await listStudioQuestions(db,reviewer)).find(q=>q.stem.endsWith('again'))!;
  const dupeDetail=(await getStudioQuestion(db,reviewer,dupe.id))!;assert.equal(dupeDetail.aiMeta!.duplicateOf,high.id);assert.match(dupeDetail.aiMeta!.issues[0],/Possible duplicate/);
  const empty=await createStudioJob(db,manager,{...input,sourceText:'hello everyone, good luck',requestId:randomUUID()});
  await runStudioJob(db,empty,mock([{drafts:[],noise_summary:'Only greetings.'}]).model);
  assert.match((await listStudioJobs(db,manager)).find(j=>j.id===empty)!.error!,/No exam recalls were found. Only greetings/);
  // Reject keeps the duplicate away from students.
  await assert.rejects(reviewStudioQuestion(db,reviewer,dupe.id,dupeDetail.versionId,'reject',false,''),/Explain why/);
  await reviewStudioQuestion(db,reviewer,dupe.id,dupeDetail.versionId,'reject',false,'Duplicate of an existing draft');
  await assert.rejects(saveStudioDraft(db,reviewer,dupe.id,dupeDetail.versionId,{stem:'x',options:['a','b','c','d','e'],correctAnswer:0,explanation:'x',references:['x']}),/cannot be edited/);
  // REV-3: send back to AI with instructions creates a new version for review.
  const refine=mock([{draft:draft(4,{confidence:85})}]);
  await assert.rejects(refineQuestionWithAI(db,student,low.id,low.versionId,'x',refine.model),/permission/);
  const refined=await refineQuestionWithAI(db,reviewer,low.id,low.versionId,'Shorten the stem',refine.model);
  assert.match(refine.requests[0].prompt,/Shorten the stem/);assert.match(refine.requests[0].prompt,/Synthetic AI stem number 3/);
  const after=(await getStudioQuestion(db,reviewer,low.id))!;
  assert.equal(after.versionId,refined);assert.equal(after.version,2);assert.equal(after.status,'ai_refined');assert.equal(after.aiMeta!.instruction,'Shorten the stem');
  await assert.rejects(refineQuestionWithAI(db,reviewer,low.id,low.versionId,'',mock([{draft:draft(5)}]).model),/changed/);
  // A human edit keeps AI provenance and the full flow still publishes.
  const edited=await saveStudioDraft(db,reviewer,high.id,high.versionId,{stem:high.stem,options:high.options,correctAnswer:2,explanation:high.explanation,references:high.references,keyNotes:['Edited note']});
  const human=(await getStudioQuestion(db,reviewer,high.id))!;assert.equal(human.aiMeta!.editedByHuman,true);assert.deepEqual(human.keyNotes,['Edited note']);assert.equal(human.confidence,90);
  await reviewStudioQuestion(db,reviewer,high.id,edited,'submit_review',false,'');await reviewStudioQuestion(db,reviewer,high.id,edited,'approve',true,'');await reviewStudioQuestion(db,manager,high.id,edited,'publish',false,'');
  assert.equal((await listExams(db)).find(e=>e.id===exam.id)?.questionCount,1);
  assert.equal((await db.query("SELECT 1 FROM audit_log WHERE action='ai.draft_created'")).length,3);
 }finally{await db.close();}
});

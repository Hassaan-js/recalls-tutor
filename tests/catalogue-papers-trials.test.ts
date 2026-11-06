import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {PGlite} from '@electric-sql/pglite';
import {embeddedDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {seedCatalogue} from '../lib/db/seed';
import {createSitting,createTopic,getCatalogueAdmin,updateExamSettings,updateSitting} from '../lib/services/catalogue-admin';
import {createRecall,getStudioQuestion,reviewStudioQuestion,saveStudioDraft,setQuestionTags} from '../lib/services/studio';
import {createStudioJob,runStudioJob} from '../lib/services/ai-studio';
import {addPaperQuestion,createPaper,getPaperAdmin,movePaperQuestion,paperCandidates,removePaperQuestion,setPaperState} from '../lib/services/papers';
import {answerQuestion,getPracticeQuestion,getResults,listPracticeExams,listTrialOffers,startAttempt,startPaperAttempt,startTrial,submitAttempt} from '../lib/services/practice';
import {extractUploadText} from '../lib/services/extract-text';
import {listExams} from '../lib/services/catalogue';
import type {RecallModel} from '../lib/integrations/llm/claude-cli';
function zip(name:string,content:string) {
 const data=deflateRawSync(Buffer.from(content)),nameBytes=Buffer.from(name);
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(8,8);local.writeUInt32LE(data.length,18);local.writeUInt32LE(content.length,22);local.writeUInt16LE(nameBytes.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(8,10);central.writeUInt32LE(data.length,20);central.writeUInt32LE(content.length,24);central.writeUInt16LE(nameBytes.length,28);central.writeUInt32LE(0,42);
 const body=Buffer.concat([local,nameBytes,data]),dir=Buffer.concat([central,nameBytes]);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(body.length,16);
 return new Uint8Array(Buffer.concat([body,dir,end]));
}
function pdf(text:string) {
 const stream=`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let out='%PDF-1.4\n';const offsets:number[]=[];
 objects.forEach((o,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${o}\nendobj\n`;});
 const xref=out.length;out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return new Uint8Array(Buffer.from(out,'latin1'));
}
test('Uploads: text from Word and PDF files, with clear errors for unsupported ones',async()=>{
 assert.match(await extractUploadText('recalls.docx',zip('word/document.xml','<w:document><w:body><w:p><w:r><w:t>PPH first line drug &amp; dose</w:t></w:r></w:p><w:p><w:r><w:t>Second recall</w:t></w:r></w:p></w:body></w:document>')),/PPH first line drug & dose\nSecond recall/);
 assert.match(await extractUploadText('recalls.pdf',pdf('Recall: pudendal nerve roots S2 S3 S4 asked in September')),/pudendal nerve roots S2 S3 S4/);
 await assert.rejects(extractUploadText('scan.pdf',pdf('')),/no selectable text/);
 await assert.rejects(extractUploadText('fake.pdf',new TextEncoder().encode('hello')),/not a valid PDF/);
 await assert.rejects(extractUploadText('broken.docx',new TextEncoder().encode('not a zip')),/could not be read/);
 await assert.rejects(extractUploadText('old.doc',new Uint8Array(4)),/\.docx/);
 await assert.rejects(extractUploadText('photo.jpg',new Uint8Array(4)),/PNG, JPG/);
 assert.equal(await extractUploadText('chat.txt',new TextEncoder().encode('plain text')),'plain text');
});
test('Catalogue, tags, filters, papers and free trial',async()=>{
 const db=embeddedDatabase(new PGlite());
 try {
  await migrate(db);await seedCatalogue(db);
  async function actor(role:string,twoFactor=false) {const authId=randomUUID();await db.query('INSERT INTO auth_users(id,name,email,email_verified,two_factor_enabled,created_at,updated_at) VALUES($1,$2,$3,true,$4,now(),now())',[authId,role,`${authId}@example.test`,twoFactor]);return (await db.query<{id:string}>('INSERT INTO app_users(auth_id,role) VALUES($1,$2) RETURNING id',[authId,role]))[0].id;}
  const admin=await actor('super_admin',true),manager=await actor('content_manager'),reviewer=await actor('reviewer'),student=await actor('student'),trialist=await actor('student');
  const exam=(await listExams(db)).find(e=>e.slug==='mrcog-part-1')!,other=(await listExams(db)).find(e=>e.slug==='amc-part-1')!;
  const settings={questionCount:'',durationMinutes:'',passMarkPercent:'',highYieldMin:'',needsExpertBelow:'',approvedSources:[] as string[],styleNotes:''};
  // Exam settings: entered by staff, nothing assumed; trial settings are Super Admin only.
  await assert.rejects(updateExamSettings(db,reviewer,exam.id,{...settings,questionCount:'4'}),/permission/);
  await updateExamSettings(db,manager,exam.id,{...settings,questionCount:'4',durationMinutes:'8',passMarkPercent:'62.5',approvedSources:['Synthetic Society']});
  await assert.rejects(updateExamSettings(db,manager,exam.id,{...settings,trial:{enabled:true,days:'3',questionLimit:'3',mockSize:'2'}}),/Super Admin/);
  await assert.rejects(updateExamSettings(db,manager,exam.id,{...settings,passMarkPercent:'140'}),/between/);
  await updateExamSettings(db,manager,exam.id,{...settings,questionCount:'4',durationMinutes:'8',passMarkPercent:'62.5',highYieldMin:'2'});
  let entry=(await getCatalogueAdmin(db,reviewer)).find(e=>e.id===exam.id)!;
  assert.equal(entry.questionCount,4);assert.equal(entry.settings.durationMinutes,8);assert.equal(entry.settings.passMarkPercent,62.5);assert.equal(entry.settings.approvedSources,undefined);
  // Sittings and topics.
  const sept=await createSitting(db,manager,{examId:exam.id,year:2026,month:9,label:''}),mar=await createSitting(db,manager,{examId:exam.id,year:2025,month:3,label:''});
  await assert.rejects(createSitting(db,manager,{examId:exam.id,year:2026,month:9,label:''}),/already has/);
  await assert.rejects(createSitting(db,reviewer,{examId:exam.id,year:2024,month:9,label:''}),/permission/);
  const obstetrics=await createTopic(db,manager,{examId:exam.id,name:'Obstetrics',parentId:null}),labour=await createTopic(db,manager,{examId:exam.id,name:'Labour',parentId:obstetrics}),anatomy=await createTopic(db,manager,{examId:exam.id,name:'Anatomy',parentId:null});
  await assert.rejects(createTopic(db,manager,{examId:exam.id,name:'Too deep',parentId:labour}),/top-level/);
  const foreignTopic=await createTopic(db,manager,{examId:other.id,name:'Foreign',parentId:null});
  entry=(await getCatalogueAdmin(db,reviewer)).find(e=>e.id===exam.id)!;
  assert.deepEqual(entry.sittings.map(s=>s.label),['September 2026','March 2025']);assert.equal(entry.topics.length,3);
  // Publish five questions through the normal workflow, then tag them.
  async function publish(n:number) {
   const id=await createRecall(db,manager,{examId:exam.id,sourceLabel:'Synthetic',sourceText:`SOURCE ${n}`,requestId:randomUUID()});
   const first=(await getStudioQuestion(db,reviewer,id))!;
   const v=await saveStudioDraft(db,reviewer,id,first.versionId,{stem:`Synthetic tagged stem ${n}`,options:['A','B','C','D','E'],correctAnswer:0,explanation:`Explanation ${n}`,references:['Synthetic reference']});
   await reviewStudioQuestion(db,reviewer,id,v,'submit_review',false,'');await reviewStudioQuestion(db,reviewer,id,v,'approve',true,'');await reviewStudioQuestion(db,manager,id,v,'publish',false,'');
   return id;
  }
  const q=[await publish(1),await publish(2),await publish(3),await publish(4),await publish(5)];
  const before=(await getStudioQuestion(db,reviewer,q[0]))!;
  await assert.rejects(setQuestionTags(db,student,q[0],{topicId:labour,difficulty:'hard',sittingIds:[sept]}),/permission/);
  await assert.rejects(setQuestionTags(db,reviewer,q[0],{topicId:foreignTopic,difficulty:null,sittingIds:[]}),/from this exam/);
  await setQuestionTags(db,reviewer,q[0],{topicId:labour,difficulty:'hard',sittingIds:[sept,mar]});// high-yield: two sittings
  await setQuestionTags(db,reviewer,q[1],{topicId:anatomy,difficulty:'easy',sittingIds:[sept]});// new this sitting
  await setQuestionTags(db,reviewer,q[2],{topicId:obstetrics,difficulty:'medium',sittingIds:[mar]});// older sitting: trial pool
  await setQuestionTags(db,reviewer,q[3],{topicId:null,difficulty:null,sittingIds:[mar]});
  const tagged=(await getStudioQuestion(db,reviewer,q[0]))!;
  assert.equal(tagged.status,'published');assert.equal(tagged.versionId,before.versionId);assert.equal(tagged.topicId,labour);assert.deepEqual(new Set(tagged.sittingIds),new Set([sept,mar]));
  // AI drafts map to the controlled topic list and the upload's sitting; unknown topics become proposals.
  const draft=(topic:string)=>({evidence:'e',stem:`AI stem about ${topic} ${randomUUID()}`,options:['A1','B1','C1','D1','E1'],correct_index:0,explanation:'x',distractor_rationales:['','','','',''],key_notes:['a','b','c'],references:[],topic,difficulty:'hard',confidence:90,needs_expert:false,answer_basis:'established_knowledge',issues:[]});
  let prompt='';const model:RecallModel={name:'mock',async complete(r){prompt=r.system;return {output:{drafts:[draft('Obstetrics › Labour'),draft('NEW: Genetics')],noise_summary:''},model:'mock',costUsd:null};}};
  const job=await createStudioJob(db,manager,{examId:exam.id,sourceLabel:'Synthetic',sourceText:'Synthetic recall text',fileName:null,sittingHint:'',sittingId:sept,requestId:randomUUID()});
  await assert.rejects(createStudioJob(db,manager,{examId:other.id,sourceLabel:'x',sourceText:'y',fileName:null,sittingHint:'',sittingId:sept,requestId:randomUUID()}),/from this exam/);
  await runStudioJob(db,job,model);
  assert.match(prompt,/controlled list: Anatomy; Obstetrics; Obstetrics › Labour/);
  const drafts=await db.query<{id:string;topic_id:string|null;difficulty:string;proposed:string|null;sittings:number}>(`SELECT q.id,q.topic_id,q.difficulty,v.ai_meta->>'proposedTopic' AS proposed,(SELECT count(*)::int FROM question_sittings qs WHERE qs.question_id=q.id AND qs.sitting_id=$2) AS sittings FROM questions q JOIN question_versions v ON v.id=q.current_version_id JOIN recall_sources s ON s.question_id=q.id WHERE s.job_id=$1 ORDER BY v.stem`,[job,sept]);
  assert.equal(drafts.find(d=>d.topic_id===labour)?.difficulty,'hard');assert.equal(drafts.find(d=>d.topic_id===null)?.proposed,'Genetics');assert.ok(drafts.every(d=>d.sittings===1));
  // Practice filters and "Seen in" badges.
  const exp=new Date(Date.now()+30*86400000).toISOString();
  await db.query("INSERT INTO entitlements(user_id,exam_id,source,starts_at,ends_at) VALUES($1,$2,'complimentary',now(),$3)",[student,exam.id,exp]);
  const ids=async(attempt:string)=>(await db.query<{question_id:string}>('SELECT question_id FROM practice_items WHERE attempt_id=$1',[attempt])).map(r=>r.question_id).sort();
  const run=(filters:object,mode:'revision'|'exam'='revision')=>startAttempt(db,student,{examId:exam.id,mode,pool:'all',count:20,requestId:randomUUID(),filters});
  assert.deepEqual(await ids(await run({topicIds:[obstetrics]})),[q[0],q[2]].sort());// parent topic includes children
  assert.deepEqual(await ids(await run({sittingIds:[mar]})),[q[0],q[2],q[3]].sort());
  assert.deepEqual(await ids(await run({difficulties:['easy']})),[q[1]]);
  assert.deepEqual(await ids(await run({highYield:true})),[q[0]]);
  assert.deepEqual(await ids(await run({latestSitting:true})),[q[0],q[1]].sort());
  await assert.rejects(run({topicIds:[anatomy],difficulties:['hard']}),/No questions match/);
  const hy=await run({highYield:true});await answerQuestion(db,student,hy,1,{selected:1,confidence:null,timeMs:5});
  const fb=(await getPracticeQuestion(db,student,hy,1)).feedback!;
  assert.deepEqual(fb.seenIn,['September 2026','March 2025']);assert.equal(fb.highYield,true);assert.equal(fb.newThisSitting,false);
  const nw=await run({difficulties:['easy']});await answerQuestion(db,student,nw,1,{selected:0,confidence:null,timeMs:5});
  assert.equal((await getPracticeQuestion(db,student,nw,1)).feedback!.newThisSitting,true);
  await submitAttempt(db,student,hy);assert.deepEqual((await getResults(db,student,hy)).topics,[{topic:'Obstetrics',correct:0,total:1}]);
  // Papers: published questions only, fixed order, lock before publish, full access only.
  await assert.rejects(createPaper(db,reviewer,{examId:exam.id,title:'x',sittingId:null,minutes:10}),/content manager/);
  const paper=await createPaper(db,manager,{examId:exam.id,title:'September 2026 Paper 1',sittingId:sept,minutes:6});
  const [draftQ]=drafts;
  await assert.rejects(addPaperQuestion(db,manager,paper,draftQ.id),/Only published/);
  for(const id of [q[0],q[1],q[2],q[3]])await addPaperQuestion(db,manager,paper,id);
  await assert.rejects(addPaperQuestion(db,manager,paper,q[0]),/already/);
  await movePaperQuestion(db,manager,paper,q[3],'up');await removePaperQuestion(db,manager,paper,q[0]);await addPaperQuestion(db,manager,paper,q[0]);
  let detail=(await getPaperAdmin(db,manager,paper))!;
  assert.deepEqual(detail.items.map(i=>i.questionId),[q[1],q[3],q[2],q[0]]);assert.equal(detail.complete,true);assert.equal(detail.blueprintCount,4);
  assert.deepEqual((await paperCandidates(db,manager,paper,{sittingId:null,topicId:null,text:''})).map(c=>c.id),[q[4]]);
  await assert.rejects(setPaperState(db,manager,paper,'publish'),/Lock/);
  await setPaperState(db,manager,paper,'lock');await assert.rejects(addPaperQuestion(db,manager,paper,q[4]),/Unlock/);
  await setPaperState(db,manager,paper,'publish');await assert.rejects(setPaperState(db,manager,paper,'unlock'),/Unpublish/);
  const library=(await listPracticeExams(db,student)).find(e=>e.id===exam.id)!;
  assert.equal(library.papers.length,1);assert.equal(library.papers[0].sitting,'September 2026');
  const sitting=await startPaperAttempt(db,student,{paperId:paper,requestId:randomUUID()});
  assert.deepEqual((await db.query<{question_id:string}>('SELECT question_id FROM practice_items WHERE attempt_id=$1 ORDER BY position',[sitting])).map(r=>r.question_id),[q[1],q[3],q[2],q[0]]);
  const view=await getPracticeQuestion(db,student,sitting,1);
  assert.equal(view.attempt.mode,'exam');assert.equal(view.attempt.paperTitle,'September 2026 Paper 1');assert.ok(Math.abs(Date.parse(view.attempt.deadlineAt!)-Date.now()-360000)<5000);
  await assert.rejects(startPaperAttempt(db,trialist,{paperId:paper,requestId:randomUUID()}),/full access/);
  // Free trial: disabled by default, then pool from trial sittings, question cap, single mini mock, no papers.
  assert.deepEqual(await listTrialOffers(db,trialist),[]);
  await assert.rejects(startTrial(db,trialist,exam.id),/not available/);
  await updateExamSettings(db,admin,exam.id,{...settings,questionCount:'4',durationMinutes:'8',passMarkPercent:'62.5',trial:{enabled:true,days:'3',questionLimit:'3',mockSize:'2'}});
  await assert.rejects(startTrial(db,trialist,exam.id),/not available/);// no trial-pool sittings yet
  await updateSitting(db,manager,mar,{trialPool:true});
  assert.deepEqual((await listTrialOffers(db,trialist)).map(o=>o.questionLimit),[3]);
  assert.deepEqual(await listTrialOffers(db,student),[]);
  await assert.rejects(startTrial(db,student,exam.id),/already have access/);
  await startTrial(db,trialist,exam.id,{device:'device-a',network:'network-1'});await assert.rejects(startTrial(db,trialist,exam.id),/already used/);
  // TRIAL-2: a second account on the same device is refused; the same network alone never blocks a trial.
  const sameDevice=await actor('student'),sameNetwork=await actor('student');
  await assert.rejects(startTrial(db,sameDevice,exam.id,{device:'device-a',network:'network-1'}),/already been used on this device/);
  assert.equal((await db.query('SELECT 1 FROM trials WHERE user_id=$1',[sameDevice])).length,0);
  await startTrial(db,sameNetwork,exam.id,{device:'device-b',network:'network-1'});
  const offer=(await listPracticeExams(db,trialist)).find(e=>e.id===exam.id)!;
  assert.equal(offer.access,'trial');assert.equal(offer.published,3);assert.deepEqual(offer.trial,{used:0,limit:3,mockAvailable:true});assert.equal(offer.papers.length,0);
  const t1=await startAttempt(db,trialist,{examId:exam.id,mode:'revision',pool:'all',count:20,requestId:randomUUID()});
  assert.deepEqual(await ids(t1),[q[0],q[2],q[3]].sort());// only trial-pool sittings
  for(const pos of [1,2])await answerQuestion(db,trialist,t1,pos,{selected:0,confidence:null,timeMs:5});
  const mock=await startAttempt(db,trialist,{examId:exam.id,mode:'exam',pool:'all',count:50,requestId:randomUUID()});
  assert.equal((await ids(mock)).length,1);// capped by mock size and the one remaining trial question
  await assert.rejects(startAttempt(db,trialist,{examId:exam.id,mode:'exam',pool:'all',count:5,requestId:randomUUID()}),/already taken/);
  await answerQuestion(db,trialist,t1,3,{selected:0,confidence:null,timeMs:5});
  await assert.rejects(answerQuestion(db,trialist,mock,1,{selected:0,confidence:null,timeMs:5}),/used all the questions/);
  await assert.rejects(startAttempt(db,trialist,{examId:exam.id,mode:'revision',pool:'all',count:1,requestId:randomUUID()}),/used all the questions/);
  // Expired access stops answering in open sessions, for trials and paid access alike.
  const open=await run({});
  await db.query("UPDATE entitlements SET starts_at=now()-interval '31 days',ends_at=now()-interval '1 second' WHERE user_id=$1",[student]);
  await assert.rejects(answerQuestion(db,student,open,1,{selected:0,confidence:null,timeMs:5}),/access to this exam has ended/);
  await db.query("UPDATE trials SET started_at=now()-interval '4 days',ends_at=now()-interval '1 second' WHERE user_id=$1",[trialist]);
  await assert.rejects(answerQuestion(db,trialist,mock,1,{selected:1,confidence:null,timeMs:5}),/trial has ended/);
  assert.equal((await listPracticeExams(db,trialist)).length,0);
  assert.ok((await db.query("SELECT 1 FROM audit_log WHERE action IN ('trial.started','paper.publish','question.tagged','exam.settings_updated','sitting.created','topic.created')")).length>=10);
 }finally{await db.close();}
});

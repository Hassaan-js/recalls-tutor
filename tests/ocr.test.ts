import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {embeddedDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {seedCatalogue} from '../lib/db/seed';
import {createStudioJob,listStudioJobs,retryStudioJob,runStudioJob,transcribeStudioJob,type ScanFile} from '../lib/services/ai-studio';
import {prepareUpload} from '../lib/services/extract-text';
import {listExams} from '../lib/services/catalogue';
import type {ModelRequest,RecallModel} from '../lib/integrations/llm/claude-cli';
import type {VisionInput,VisionReader} from '../lib/integrations/llm/vision';
const PNG=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]),JPG=new Uint8Array([0xff,0xd8,0xff,0xe0,0,0]);
const draft={evidence:'Scanned recall',stem:'Synthetic scanned stem about uterine atony after delivery',options:['One','Two','Three','Four','Five'],correct_index:1,explanation:'Synthetic explanation',distractor_rationales:['a','b','c','d','e'],key_notes:['n1','n2','n3'],references:[{title:'Synthetic Guideline',source:'Synthetic Society',section:'1'}],topic:'Synthetic topic',difficulty:'medium',confidence:90,needs_expert:false,answer_basis:'established_knowledge',issues:[]};
function reader(texts:(string|Error)[]) {const seen:VisionInput[]=[];const r:VisionReader={name:'fake-vision',async read(input){seen.push(input);const next=texts.shift();if(next instanceof Error)throw next;return {text:next??'',model:'fake-vision-model',costUsd:0.02};}};return {r,seen};}
function model() {const requests:ModelRequest[]=[];const m:RecallModel={name:'mock',async complete(request){requests.push(request);return {output:{drafts:[draft],noise_summary:''},model:'mock-model',costUsd:0.01};}};return {m,requests};}
test('OCR: scans and images are detected, transcribed, stripped of PII, then drafted; files are never stored',async()=>{
 // Detection: images by extension and signature; renamed or iPhone HEIC files are refused before anything is sent.
 assert.deepEqual(await prepareUpload('shot.png',PNG),{kind:'scan',mediaType:'image/png'});
 assert.deepEqual(await prepareUpload('photo.JPG',JPG),{kind:'scan',mediaType:'image/jpeg'});
 await assert.rejects(prepareUpload('fake.png',JPG),/not a valid image/);
 await assert.rejects(prepareUpload('IMG_0001.HEIC',new Uint8Array(8)),/HEIC/);
 assert.deepEqual(await prepareUpload('chat.txt',new TextEncoder().encode('hello')),{kind:'text',text:'hello'});
 const db=embeddedDatabase(new PGlite());
 try {
  await migrate(db);await seedCatalogue(db);
  const authId=randomUUID();await db.query('INSERT INTO auth_users(id,name,email,email_verified,two_factor_enabled,created_at,updated_at) VALUES($1,$2,$3,true,false,now(),now())',[authId,'m',`${authId}@example.test`]);
  const manager=(await db.query<{id:string}>(`INSERT INTO app_users(auth_id,role) VALUES($1,'content_manager') RETURNING id`,[authId]))[0].id;
  const exam=(await listExams(db))[0];
  const job=(over:Record<string,unknown>={})=>createStudioJob(db,manager,{examId:exam.id,sourceLabel:'Scans',sourceText:'',fileName:'a.png, b.jpg',sittingHint:'',requestId:randomUUID(),scanFiles:2,...over});
  await assert.rejects(job({scanFiles:0}),/Add recall text/);
  await assert.rejects(job({scanFiles:11}),/up to 10/);
  const scans:ScanFile[]=[{name:'a.png',mediaType:'image/png',bytes:PNG},{name:'b.jpg',mediaType:'image/jpeg',bytes:JPG}];
  // A job waiting for OCR cannot be drafted early.
  const id=await job({sourceText:'Typed note: question about PPH'});
  const early=model();await runStudioJob(db,id,early.m);assert.equal(early.requests.length,0);
  const ocr=reader(['Q12 PPH after delivery, uterus boggy. Call me on +44 7700 900123','Options: A oxytocin B ergometrine']);
  assert.equal(await transcribeStudioJob(db,id,scans,ocr.r),true);
  assert.deepEqual(ocr.seen.map(s=>s.mediaType),['image/png','image/jpeg']);
  const [row]=await db.query<{source_text:string;status:string;ocr_files:number;ocr_model:string;ocr_cost:number;redactions:number}>('SELECT source_text,status,ocr_files,ocr_model,ocr_cost_usd::float AS ocr_cost,redactions FROM studio_jobs WHERE id=$1',[id]);
  assert.equal(row.status,'queued');assert.equal(row.ocr_files,0);assert.equal(row.ocr_model,'fake-vision-model');assert.equal(row.ocr_cost,0.04);
  assert.match(row.source_text,/^Typed note: question about PPH/);assert.match(row.source_text,/\[Scanned file: a\.png\]\nQ12 PPH/);assert.match(row.source_text,/\[Scanned file: b\.jpg\]/);
  assert.ok(!row.source_text.includes('7700'));assert.ok(row.redactions>=1);
  const ai=model();await runStudioJob(db,id,ai.m);
  assert.equal(ai.requests.length,1);assert.match(ai.requests[0].prompt,/Q12 PPH after delivery/);
  const listed=(await listStudioJobs(db,manager)).find(j=>j.id===id)!;
  assert.equal(listed.status,'ready');assert.equal(listed.draftCount,1);assert.equal(listed.costUsd,0.05);
  // No column holds the file bytes: only the transcript is kept.
  const columns=(await db.query<{column_name:string;data_type:string}>(`SELECT column_name,data_type FROM information_schema.columns WHERE table_name='studio_jobs'`)).filter(c=>c.data_type==='bytea');
  assert.equal(columns.length,0);
  // Unreadable scans fail with a clear reason, and retry asks for the files again because they were not kept.
  const blank=await job({scanFiles:1});
  assert.equal(await transcribeStudioJob(db,blank,[scans[0]],reader(['  ']).r),false);
  const [failed]=await db.query<{status:string;error:string}>('SELECT status,error FROM studio_jobs WHERE id=$1',[blank]);
  assert.equal(failed.status,'failed');assert.match(failed.error,/No readable text/);
  await assert.rejects(retryStudioJob(db,manager,blank),/Upload them again/);
  const broken=await job({scanFiles:1});
  assert.equal(await transcribeStudioJob(db,broken,[scans[0]],reader([new Error('Claude is not signed in on the server yet.')]).r),false);
  assert.match((await db.query<{error:string}>('SELECT error FROM studio_jobs WHERE id=$1',[broken]))[0].error,/not signed in/);
  // Files that do not match the job (for example after a restart) are refused.
  const mismatch=await job({scanFiles:2});
  assert.equal(await transcribeStudioJob(db,mismatch,[scans[0]],reader(['x']).r),false);
  // A job that is not waiting for OCR is left alone.
  assert.equal(await transcribeStudioJob(db,id,scans,reader(['x']).r),false);
 } finally {await db.close();}
});

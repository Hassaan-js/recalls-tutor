'use server';
import {revalidatePath} from 'next/cache';
import {after} from 'next/server';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {createRecall as create,saveStudioDraft,reviewStudioQuestion,setQuestionTags,type ReviewAction} from '@/lib/services/studio';
import {prepareUpload} from '@/lib/services/extract-text';
import {resolveQuestionReport} from '@/lib/services/student';
import {createStudioJob,refineQuestionWithAI,retryStudioJob,runStudioJob,transcribeStudioJob,type ScanFile} from '@/lib/services/ai-studio';
import {defaultRecallModel} from '@/lib/integrations/llm/anthropic';
import {defaultVisionReader} from '@/lib/integrations/llm/vision';
import {acceptProposal,decideSittingProposal,dismissProposal,draftReportFix,setAiBudget} from '@/lib/services/proposals';
import {moderateComment} from '@/lib/services/discussion';
export type ActionResult={error?:string;success?:string;questionId?:string;jobId?:string};
function field(form:FormData,key:string) {const value=form.get(key);return typeof value==='string'?value:'';}
function lines(value:string) {return value.split('\n').map(line=>line.trim()).filter(Boolean);}
async function actorId() {const actor=await getCurrentActor();if(staffAccess(actor)!=='allowed'||!actor)throw new Error('Staff access is required.');return actor.id;}
function failure(error:unknown):ActionResult {return {error:error instanceof Error && !('query' in error) && !('code' in error)?error.message:'Unable to save this change. Please retry.'};}
export async function createRecall(_:ActionResult,form:FormData):Promise<ActionResult> {
 try {const id=await create(getDatabase(),await actorId(),{examId:field(form,'examId'),sourceLabel:field(form,'sourceLabel'),sourceText:field(form,'sourceText'),requestId:field(form,'requestId')});revalidatePath('/studio');return {success:'Recall saved.',questionId:id};}catch(error){return failure(error);}
}
export async function saveDraft(_:ActionResult,form:FormData):Promise<ActionResult> {
 try {const id=field(form,'questionId'),answer=field(form,'correctAnswer');await saveStudioDraft(getDatabase(),await actorId(),id,field(form,'versionId'),{stem:field(form,'stem'),options:Array.from({length:5},(_,i)=>field(form,`option${i}`)),correctAnswer:answer===''?null:Number(answer),explanation:field(form,'explanation'),references:lines(field(form,'references')),keyNotes:form.has('keyNotes')?lines(field(form,'keyNotes')):undefined});revalidatePath('/studio');return {success:'New draft version saved. Review is required.',questionId:id};}catch(error){return failure(error);}
}
export async function reviewQuestion(_:ActionResult,form:FormData):Promise<ActionResult> {
 try {const id=field(form,'questionId');await reviewStudioQuestion(getDatabase(),await actorId(),id,field(form,'versionId'),field(form,'action') as ReviewAction,field(form,'reviewed')==='true',field(form,'note'));revalidatePath('/studio');revalidatePath('/');revalidatePath('/pricing');return {success:'Review status updated.',questionId:id};}catch(error){return failure(error);}
}
// Chat exports (.txt), CSV/TSV, Markdown, Word (.docx) and PDFs with text are read here. Scanned PDFs, photos and
// screenshots go to OCR inside the job. 4 MB in total keeps one upload inside a serverless request body limit.
const MAX_UPLOAD_BYTES=4*1024*1024,MAX_FILES=10;
export async function uploadRecalls(_:ActionResult,form:FormData):Promise<ActionResult> {
 try {
  const id=await actorId(),files=form.getAll('file').filter((f):f is File=>f instanceof File&&f.size>0);
  if(files.length>MAX_FILES)throw new Error(`Upload up to ${MAX_FILES} files at a time.`);
  if(files.reduce((sum,f)=>sum+f.size,0)>MAX_UPLOAD_BYTES)throw new Error('Files must be 4 MB or smaller in total. Upload them in smaller groups.');
  const texts:string[]=[],scans:ScanFile[]=[];
  for(const file of files) {
   const bytes=new Uint8Array(await file.arrayBuffer()),prepared=await prepareUpload(file.name,bytes);
   if(prepared.kind==='text')texts.push(prepared.text);else scans.push({name:file.name,mediaType:prepared.mediaType,bytes});
  }
  const fileName=files.length?files.map(f=>f.name).join(', '):null;
  const jobId=await createStudioJob(getDatabase(),id,{examId:field(form,'examId'),sourceLabel:field(form,'sourceLabel')||fileName||'',sourceText:[...texts,field(form,'sourceText')].filter(text=>text.trim()).join('\n\n'),fileName,sittingHint:field(form,'sittingHint'),sittingId:field(form,'sittingId')||null,requestId:field(form,'requestId'),scanFiles:scans.length});
  // Runs after the response so the upload returns immediately; the Studio polls the job status. Scan bytes live
  // only in this closure: they are read once and never written to the database.
  after(async()=>{const db=getDatabase();if(scans.length&&!(await transcribeStudioJob(db,jobId,scans,defaultVisionReader())))return;await runStudioJob(db,jobId,defaultRecallModel());});
  revalidatePath('/studio');return {success:scans.length?`Upload received. Claude is reading ${scans.length===1?'the scan':`${scans.length} scans`}, then drafting questions.`:'Upload received. Claude is drafting questions.',jobId};
 }catch(error){return failure(error);}
}
export async function retryJob(jobId:string):Promise<ActionResult> {
 try {await retryStudioJob(getDatabase(),await actorId(),jobId);after(()=>runStudioJob(getDatabase(),jobId,defaultRecallModel()));revalidatePath('/studio');return {success:'Job restarted.',jobId};}catch(error){return failure(error);}
}
export async function refineWithAI(_:ActionResult,form:FormData):Promise<ActionResult> {
 try {const id=field(form,'questionId');await refineQuestionWithAI(getDatabase(),await actorId(),id,field(form,'versionId'),field(form,'instruction'),defaultRecallModel());revalidatePath('/studio');return {success:'Claude produced a new draft version. Review it before submitting.',questionId:id};}catch(error){return failure(error);}
}
export async function saveTags(_:ActionResult,form:FormData):Promise<ActionResult> {
 try {const id=field(form,'questionId');await setQuestionTags(getDatabase(),await actorId(),id,{topicId:field(form,'topicId')||null,difficulty:field(form,'difficulty')||null,sittingIds:form.getAll('sittingIds').filter((v):v is string=>typeof v==='string')});revalidatePath('/studio');return {success:'Tags saved.',questionId:id};}catch(error){return failure(error);}
}
export async function closeReport(reportId:string,outcome:'resolved'|'dismissed'):Promise<ActionResult> {
 try {await resolveQuestionReport(getDatabase(),await actorId(),reportId,outcome);revalidatePath('/studio');return {success:outcome==='resolved'?'Report marked as fixed.':'Report dismissed.'};}catch(error){return failure(error);}
}
// ---- ADM-6 / AIS-12 / AIS-14: proposals ----
export async function draftFix(reportId:string):Promise<ActionResult> {
 try {const r=await draftReportFix(getDatabase(),await actorId(),reportId,defaultRecallModel());revalidatePath('/studio');
  return {success:r.needsChange?'Claude proposed a fix. Review it under “Proposed edits”.':`Claude thinks the question is already correct: ${r.rationale.slice(0,400)} Close the report if you agree.`};}catch(error){return failure(error);}
}
export async function acceptFix(_:ActionResult,form:FormData):Promise<ActionResult> {
 try {
  const edited=field(form,'edited')==='true';
  const edits=edited?{stem:field(form,'stem'),options:[0,1,2,3,4].map(i=>field(form,`option${i}`)),correctAnswer:Number(field(form,'correctAnswer')),explanation:field(form,'explanation')}:undefined;
  await acceptProposal(getDatabase(),await actorId(),field(form,'proposalId'),edits);revalidatePath('/studio');revalidatePath('/practice');
  return {success:'Change published as a new version. Students in a session keep the version they started with.'};
 }catch(error){return failure(error);}
}
export async function dismissFix(proposalId:string):Promise<ActionResult> {
 try {await dismissProposal(getDatabase(),await actorId(),proposalId);revalidatePath('/studio');return {success:'Proposal dismissed.'};}catch(error){return failure(error);}
}
export async function decideSitting(id:string,confirm:boolean):Promise<ActionResult> {
 try {await decideSittingProposal(getDatabase(),await actorId(),id,confirm);revalidatePath('/studio/catalogue');return {success:confirm?'Sitting created. Publish it in the catalogue when it is ready.':'Proposal dismissed.'};}catch(error){return failure(error);}
}
export async function saveAiBudget(_:ActionResult,form:FormData):Promise<ActionResult> {
 try {const raw=field(form,'budget').trim();await setAiBudget(getDatabase(),await actorId(),raw===''?null:Number(raw));revalidatePath('/studio/overview');return {success:'AI budget saved.'};}catch(error){return failure(error);}
}
// STU-15: comment moderation.
export async function moderate(commentId:string,approve:boolean):Promise<ActionResult> {
 try {await moderateComment(getDatabase(),await actorId(),commentId,approve);revalidatePath('/studio');return {success:approve?'Comment approved.':'Comment rejected.'};}catch(error){return failure(error);}
}

'use server';
import {revalidatePath} from 'next/cache';
import {cookies,headers} from 'next/headers';
import {randomUUID} from 'node:crypto';
import {hashSignal} from '@/lib/services/lifecycle';
import {recordOutcome} from '@/lib/services/predictor';
import {askTutor} from '@/lib/services/tutor';
import {listComments,postComment,type Comment} from '@/lib/services/discussion';
import {defaultRecallModel} from '@/lib/integrations/llm/anthropic';
import {getCurrentActor} from '@/lib/auth/session';
import {getDatabase} from '@/lib/db/client';
import {reportQuestion,saveNote,setBookmark} from '@/lib/services/student';
import {answerQuestion,grantComplimentaryAccess,setFlag,startAttempt,startPaperAttempt,startTrial,submitAttempt,type Confidence,type PracticeMode,type PracticePool} from '@/lib/services/practice';
export type PracticeResult={error?:string;success?:string;attemptId?:string};
function field(form:FormData,key:string) {const value=form.get(key);return typeof value==='string'?value:'';}
async function actorId() {const actor=await getCurrentActor();if(!actor||!actor.emailVerified)throw new Error('Sign in with a verified account to practise.');return actor.id;}
function all(form:FormData,key:string) {return form.getAll(key).filter((v):v is string=>typeof v==='string'&&v!=='');}
function failure(error:unknown):PracticeResult {return {error:error instanceof Error && !('query' in error) && !('code' in error)?error.message:'Unable to save this change. Please retry.'};}
export async function startPractice(_:PracticeResult,form:FormData):Promise<PracticeResult> {
 try {const id=await startAttempt(getDatabase(),await actorId(),{examId:field(form,'examId'),mode:field(form,'mode') as PracticeMode,pool:field(form,'pool') as PracticePool,count:Number(field(form,'count')),requestId:field(form,'requestId'),
  filters:{topicIds:all(form,'topicIds'),sittingIds:all(form,'sittingIds'),difficulties:all(form,'difficulties'),highYield:field(form,'highYield')==='true',latestSitting:field(form,'latestSitting')==='true',bookmarked:field(form,'bookmarked')==='true',flagged:field(form,'flagged')==='true'}});return {attemptId:id};}catch(error){return failure(error);}
}
export async function submitAnswer(_:PracticeResult,form:FormData):Promise<PracticeResult> {
 try {const confidence=field(form,'confidence');await answerQuestion(getDatabase(),await actorId(),field(form,'attemptId'),Number(field(form,'position')),{selected:field(form,'selected')===''?-1:Number(field(form,'selected')),confidence:confidence===''?null:confidence as Confidence,timeMs:Number(field(form,'timeMs'))});return {success:'Answer saved.'};}catch(error){return failure(error);}
}
export async function toggleFlag(attemptId:string,position:number,flagged:boolean):Promise<PracticeResult> {
 try {await setFlag(getDatabase(),await actorId(),attemptId,position,flagged);return {success:flagged?'Flagged for review.':'Flag removed.'};}catch(error){return failure(error);}
}
export async function finishPractice(attemptId:string):Promise<PracticeResult> {
 try {await submitAttempt(getDatabase(),await actorId(),attemptId);revalidatePath('/practice');return {attemptId};}catch(error){return failure(error);}
}
export async function grantAccess(_:PracticeResult,form:FormData):Promise<PracticeResult> {
 try {const ends=await grantComplimentaryAccess(getDatabase(),await actorId(),{email:field(form,'email'),examId:field(form,'examId'),days:Number(field(form,'days'))});return {success:`Complimentary access granted until ${new Date(ends).toUTCString()}.`};}catch(error){return failure(error);}
}
export async function startPaper(paperId:string,requestId:string):Promise<PracticeResult> {
 try {return {attemptId:await startPaperAttempt(getDatabase(),await actorId(),{paperId,requestId})};}catch(error){return failure(error);}
}
// TRIAL-2: a random device cookie (kept for 400 days) and the network address, both stored only as hashes.
async function trialSignals() {
 const jar=await cookies(),h=await headers();let device=jar.get('rt_device')?.value;
 if(!device||!/^[0-9a-f-]{36}$/.test(device)){device=randomUUID();jar.set('rt_device',device,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:400*86400});}
 const ip=h.get('x-real-ip')??h.get('x-forwarded-for')?.split(',')[0]?.trim()??'';
 return {device:hashSignal(`device:${device}`),network:ip?hashSignal(`ip:${ip}`):null};
}
export async function beginTrial(examId:string):Promise<PracticeResult> {
 try {const ends=await startTrial(getDatabase(),await actorId(),examId,await trialSignals());revalidatePath('/practice');revalidatePath('/dashboard');return {success:`Your free trial is active until ${new Date(ends).toUTCString()}.`};}catch(error){return failure(error);}
}
export async function toggleBookmark(attemptId:string,position:number,bookmarked:boolean):Promise<PracticeResult> {
 try {await setBookmark(getDatabase(),await actorId(),attemptId,position,bookmarked);return {success:bookmarked?'Bookmarked.':'Bookmark removed.'};}catch(error){return failure(error);}
}
export async function saveQuestionNote(_:PracticeResult,form:FormData):Promise<PracticeResult> {
 try {const body=field(form,'note');await saveNote(getDatabase(),await actorId(),field(form,'attemptId'),Number(field(form,'position')),body);return {success:body.trim()?'Note saved.':'Note removed.'};}catch(error){return failure(error);}
}
export async function reportError(_:PracticeResult,form:FormData):Promise<PracticeResult> {
 try {await reportQuestion(getDatabase(),await actorId(),field(form,'attemptId'),Number(field(form,'position')),{reason:field(form,'reason'),details:field(form,'details')});return {success:'Thanks. The content team will review this question.'};}catch(error){return failure(error);}
}
// PP-3: "Did you pass?" after the exam date.
export async function saveOutcome(_:PracticeResult,form:FormData):Promise<PracticeResult> {
 try {const v=field(form,'passed');await recordOutcome(getDatabase(),await actorId(),field(form,'examId'),{passed:v==='yes'?true:v==='no'?false:null,satOn:field(form,'satOn')||null});revalidatePath('/practice/predictor');return {success:'Thank you. Your answer helps us check the predictor against real results.'};}catch(error){return failure(error);}
}
// STU-14: the AI tutor, after feedback, grounded in the approved explanation.
export async function askQuestionTutor(attemptId:string,position:number,prompt:string):Promise<PracticeResult&{answer?:string;outsideScope?:boolean}> {
 try {const r=await askTutor(getDatabase(),await actorId(),{attemptId,position,prompt},defaultRecallModel());return {answer:r.answer,outsideScope:r.outsideScope};}catch(error){return failure(error);}
}
// STU-15: moderated discussion.
export async function loadComments(attemptId:string,position:number):Promise<PracticeResult&{comments?:Comment[]}> {
 try {return {comments:await listComments(getDatabase(),await actorId(),attemptId,position)};}catch(error){return failure(error);}
}
export async function addComment(attemptId:string,position:number,body:string):Promise<PracticeResult> {
 try {await postComment(getDatabase(),await actorId(),attemptId,position,body);return {success:'Thanks. Your comment appears to others once a moderator approves it.'};}catch(error){return failure(error);}
}

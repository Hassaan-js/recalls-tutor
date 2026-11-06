'use server';
import {revalidatePath} from 'next/cache';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {addPaperQuestion,createPaper,movePaperQuestion,proposePapers,removePaperQuestion,setPaperState} from '@/lib/services/papers';
export type PaperResult={error?:string;success?:string;paperId?:string};
function field(form:FormData,key:string) {const value=form.get(key);return typeof value==='string'?value:'';}
async function actorId() {const actor=await getCurrentActor();if(staffAccess(actor)!=='allowed'||!actor)throw new Error('Staff access is required.');return actor.id;}
function failure(error:unknown):PaperResult {return {error:error instanceof Error && !('query' in error) && !('code' in error)?error.message:'Unable to save this change. Please retry.'};}
function refresh() {revalidatePath('/studio/papers');revalidatePath('/practice');}
export async function newPaper(_:PaperResult,form:FormData):Promise<PaperResult> {
 try {const id=await createPaper(getDatabase(),await actorId(),{examId:field(form,'examId'),title:field(form,'title'),sittingId:field(form,'sittingId')||null,minutes:Number(field(form,'minutes'))});refresh();return {success:'Paper created.',paperId:id};}catch(error){return failure(error);}
}
export async function changePaper(paperId:string,change:{kind:'add'|'remove'|'up'|'down';questionId:string}|{kind:'lock'|'unlock'|'publish'|'unpublish'}):Promise<PaperResult> {
 try {
  const db=getDatabase(),id=await actorId();
  if(change.kind==='add')await addPaperQuestion(db,id,paperId,change.questionId);
  else if(change.kind==='remove')await removePaperQuestion(db,id,paperId,change.questionId);
  else if(change.kind==='up'||change.kind==='down')await movePaperQuestion(db,id,paperId,change.questionId,change.kind);
  else await setPaperState(db,id,paperId,change.kind);
  refresh();return {success:'Paper updated.',paperId};
 }catch(error){return failure(error);}
}
// QB-6: draft papers for every published sitting that has none yet.
export async function proposeExamPapers(_:PaperResult,form:FormData):Promise<PaperResult> {
 try {
  const made=await proposePapers(getDatabase(),await actorId(),field(form,'examId'));refresh();
  if(!made.length)return {success:'Every published sitting already has a paper.'};
  return {success:`${made.length} draft ${made.length===1?'paper':'papers'} proposed: ${made.map(m=>`${m.sitting} (${m.note})`).join(' ')} Review each one, then lock and publish.`,paperId:made[0].paperId??undefined};
 }catch(error){return failure(error);}
}

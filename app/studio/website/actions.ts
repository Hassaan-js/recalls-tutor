'use server';
import {revalidatePath} from 'next/cache';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {addFaq,addRedirect,deleteFaq,deleteRedirect,savePageMeta,saveSitePage} from '@/lib/services/site';
import {draftSittingReport,savePost,setPostStatus,setPublicSample} from '@/lib/services/content-site';
export type WebsiteResult={error?:string;success?:string};
function field(form:FormData,key:string) {const value=form.get(key);return typeof value==='string'?value:'';}
async function actorId() {const actor=await getCurrentActor();if(staffAccess(actor)!=='allowed'||!actor)throw new Error('Staff access is required.');return actor.id;}
function failure(error:unknown):WebsiteResult {return {error:error instanceof Error && !('query' in error) && !('code' in error)?error.message:'Unable to save this change. Please retry.'};}
// Public pages read the database on every request, so a full-layout revalidation publishes edits immediately.
function refresh() {revalidatePath('/','layout');}
export async function saveMeta(_:WebsiteResult,form:FormData):Promise<WebsiteResult> {
 try {await savePageMeta(getDatabase(),await actorId(),{path:field(form,'path'),title:field(form,'title'),description:field(form,'description'),h1:field(form,'h1')});refresh();return {success:'Search settings saved.'};}catch(error){return failure(error);}
}
export async function savePage(_:WebsiteResult,form:FormData):Promise<WebsiteResult> {
 try {await saveSitePage(getDatabase(),await actorId(),{slug:field(form,'slug'),title:field(form,'title'),body:field(form,'body')});refresh();return {success:'Page published.'};}catch(error){return failure(error);}
}
export async function createFaq(_:WebsiteResult,form:FormData):Promise<WebsiteResult> {
 try {await addFaq(getDatabase(),await actorId(),{examId:field(form,'examId')||null,question:field(form,'question'),answer:field(form,'answer')});refresh();return {success:'FAQ added.'};}catch(error){return failure(error);}
}
export async function removeFaq(id:string):Promise<WebsiteResult> {
 try {await deleteFaq(getDatabase(),await actorId(),id);refresh();return {success:'FAQ removed.'};}catch(error){return failure(error);}
}
export async function createRedirect(_:WebsiteResult,form:FormData):Promise<WebsiteResult> {
 try {await addRedirect(getDatabase(),await actorId(),{from:field(form,'from'),to:field(form,'to')});refresh();return {success:'Redirect saved.'};}catch(error){return failure(error);}
}
export async function removeRedirect(from:string):Promise<WebsiteResult> {
 try {await deleteRedirect(getDatabase(),await actorId(),from);refresh();return {success:'Redirect removed.'};}catch(error){return failure(error);}
}
// ---- SEO-2: free samples and the blog ----
export async function toggleSample(questionId:string,on:boolean):Promise<WebsiteResult> {
 try {await setPublicSample(getDatabase(),await actorId(),questionId,on);refresh();return {success:on?'Now a free sample on its topic page and its own page.':'No longer a free sample.'};}catch(error){return failure(error);}
}
export async function savePostAction(_:WebsiteResult&{postId?:string},form:FormData):Promise<WebsiteResult&{postId?:string}> {
 try {const id=await savePost(getDatabase(),await actorId(),{id:field(form,'id')||null,slug:field(form,'slug'),kind:field(form,'kind'),title:field(form,'title'),excerpt:field(form,'excerpt'),body:field(form,'body'),examId:field(form,'examId')||null,sittingId:field(form,'sittingId')||null});
  revalidatePath('/studio/website');refresh();return {success:'Post saved.',postId:id};}catch(error){return failure(error);}
}
export async function publishPost(id:string,publish:boolean):Promise<WebsiteResult> {
 try {await setPostStatus(getDatabase(),await actorId(),id,publish);refresh();return {success:publish?'Published.':'Moved back to drafts.'};}catch(error){return failure(error);}
}
export async function draftReport(sittingId:string):Promise<WebsiteResult&{postId?:string}> {
 try {const id=await draftSittingReport(getDatabase(),await actorId(),sittingId);revalidatePath('/studio/website');return {success:'Draft report created. Add the commentary, then publish.',postId:id};}catch(error){return failure(error);}
}

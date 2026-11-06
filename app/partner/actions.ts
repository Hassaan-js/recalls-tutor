'use server';
import {after} from 'next/server';
import {revalidatePath} from 'next/cache';
import {getCurrentActor} from '@/lib/auth/session';
import {getDatabase} from '@/lib/db/client';
import {runPartnerJobs} from '@/lib/integrations/partner-jobs';
import {assignMany,changeEnrollment,claimInviteLink,createApiKey,createInviteLink,createWebhookEndpoint,disableWebhookEndpoint,dismissAlert,MAX_BULK,parseEmailList,PartnerError,
 requirePartnerAdmin,retryDelivery,revokeApiKey,revokeEnrollment,revokeInviteLink,rotateApiKey,rotateWebhookSecret,setKeyIps,setPartnerConsent,type BulkResult} from '@/lib/services/partners';
// PART-3 Partner Portal actions. Every one checks that the signed-in account is a partner admin of the organisation.
export type PartnerResult={error?:string;success?:string;secret?:string;url?:string;results?:BulkResult[]};
const field=(form:FormData,key:string)=>{const v=form.get(key);return typeof v==='string'?v:'';};
async function actor() {const a=await getCurrentActor();if(!a||a.suspended||!a.emailVerified)throw new Error('Sign in with a verified account first.');return a;}
function failure(error:unknown):PartnerResult {return {error:error instanceof Error&&!('query' in error)&&!('code' in error)?error.message:'Unable to save this change. Please retry.'};}
const refresh=()=>revalidatePath('/partner','layout');
export async function assignSeats(_:PartnerResult,form:FormData):Promise<PartnerResult> {
 try {
  const a=await actor(),orgId=field(form,'orgId');
  const [examId,months]=field(form,'product').split(':');
  const file=form.get('file');
  let text=field(form,'emails');
  if(file instanceof File&&file.size>0) {if(file.size>512*1024)throw new Error('The CSV must be 512 KB or smaller.');text=`${text}\n${await file.text()}`;}
  const emails=parseEmailList(text);
  if(emails.length>MAX_BULK)throw new Error(`Assign up to ${MAX_BULK} students at a time.`);
  const {results}=await assignMany(getDatabase(),a.id,orgId,{examId,months:Number(months),emails,source:file instanceof File&&file.size>0?'csv':'portal'});
  after(runPartnerJobs);refresh();
  const ok=results.filter(r=>r.ok).length,skipped=results.length-ok;
  return {success:`${ok} ${ok===1?'seat':'seats'} assigned.${skipped?` ${skipped} skipped (see below).`:''} Students with an account have access now; the others get an email to create one.`,results};
 } catch(e){return failure(e);}
}
export async function revokeSeat(orgId:string,id:string):Promise<PartnerResult> {
 try {const a=await actor();await requirePartnerAdmin(getDatabase(),a.id,orgId,{write:true});const r=await revokeEnrollment(getDatabase(),orgId,false,id,a.id);after(runPartnerJobs);refresh();
  return {success:r.seatReturned?'Seat revoked and returned to your balance.':'Access revoked. The seat was already activated, so it is not returned.'};}
 catch(e){return failure(e instanceof PartnerError?new Error(e.message):e);}
}
export async function extendSeat(orgId:string,id:string,months:number):Promise<PartnerResult> {
 try {const a=await actor();await requirePartnerAdmin(getDatabase(),a.id,orgId,{write:true});await changeEnrollment(getDatabase(),orgId,false,id,{extendMonths:months},a.id);after(runPartnerJobs);refresh();return {success:`Access extended by ${months} months.`};}
 catch(e){return failure(e instanceof PartnerError?new Error(e.message):e);}
}
export async function createLink(_:PartnerResult,form:FormData):Promise<PartnerResult> {
 try {const a=await actor();const [examId,months]=field(form,'product').split(':');
  const r=await createInviteLink(getDatabase(),a.id,field(form,'orgId'),{examId,months:Number(months),cap:Number(field(form,'cap')),days:Number(field(form,'days')),label:field(form,'label')});refresh();
  return {success:'Invite link created. Copy it now: for security it is not shown again.',url:r.url};} catch(e){return failure(e);}
}
export async function turnOffLink(orgId:string,linkId:string):Promise<PartnerResult> {
 try {const a=await actor();await revokeInviteLink(getDatabase(),a.id,orgId,linkId);refresh();return {success:'Link turned off.'};} catch(e){return failure(e);}
}
export async function newApiKey(_:PartnerResult,form:FormData):Promise<PartnerResult> {
 try {const a=await actor();const r=await createApiKey(getDatabase(),a.id,field(form,'orgId'),{mode:field(form,'mode'),label:field(form,'label'),ipAllow:field(form,'ipAllow')});refresh();
  return {success:'Key created. Copy it now and store it in your server settings: it is never shown again.',secret:r.secret};} catch(e){return failure(e);}
}
export async function rotateKey(orgId:string,keyId:string):Promise<PartnerResult> {
 try {const a=await actor();const r=await rotateApiKey(getDatabase(),a.id,orgId,keyId);refresh();return {success:'New key created. The old one keeps working for 24 hours, then stops.',secret:r.secret};} catch(e){return failure(e);}
}
export async function revokeKey(orgId:string,keyId:string):Promise<PartnerResult> {
 try {const a=await actor();await revokeApiKey(getDatabase(),a.id,orgId,keyId);refresh();return {success:'Key revoked. Requests using it now fail.'};} catch(e){return failure(e);}
}
export async function saveKeyIps(_:PartnerResult,form:FormData):Promise<PartnerResult> {
 try {const a=await actor();await setKeyIps(getDatabase(),a.id,field(form,'orgId'),field(form,'keyId'),field(form,'ipAllow'));refresh();return {success:'IP allow-list saved.'};} catch(e){return failure(e);}
}
export async function newWebhook(_:PartnerResult,form:FormData):Promise<PartnerResult> {
 try {const a=await actor();const r=await createWebhookEndpoint(getDatabase(),a.id,field(form,'orgId'),{mode:field(form,'mode'),url:field(form,'url'),events:form.getAll('events').filter((v):v is string=>typeof v==='string')});refresh();
  return {success:'Endpoint added. Copy the signing secret now: it is not shown again.',secret:r.secret};} catch(e){return failure(e);}
}
export async function rotateWebhook(orgId:string,id:string):Promise<PartnerResult> {
 try {const a=await actor();const secret=await rotateWebhookSecret(getDatabase(),a.id,orgId,id);refresh();return {success:'New signing secret. Events from now on are signed with it.',secret};} catch(e){return failure(e);}
}
export async function disableWebhook(orgId:string,id:string):Promise<PartnerResult> {
 try {const a=await actor();await disableWebhookEndpoint(getDatabase(),a.id,orgId,id);refresh();return {success:'Endpoint turned off.'};} catch(e){return failure(e);}
}
export async function retryWebhook(orgId:string,id:string):Promise<PartnerResult> {
 try {const a=await actor();await retryDelivery(getDatabase(),a.id,orgId,id);after(runPartnerJobs);refresh();return {success:'Sending again now.'};} catch(e){return failure(e);}
}
export async function closeAlert(orgId:string,id:string):Promise<PartnerResult> {
 try {const a=await actor();await dismissAlert(getDatabase(),a.id,orgId,id);refresh();return {};} catch(e){return failure(e);}
}
// Student side: claim a seat from an invite link, and choose whether a partner sees your progress.
export async function claimLink(token:string):Promise<PartnerResult> {
 try {const a=await actor();const r=await claimInviteLink(getDatabase(),a.id,token);after(runPartnerJobs);revalidatePath('/practice');
  return {success:r.endsAt?`Your access runs until ${new Date(r.endsAt).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'})}.`:'Your seat is ready.'};} catch(e){return failure(e);}
}
export async function setSharing(orgId:string,share:boolean):Promise<PartnerResult> {
 try {const a=await actor();await setPartnerConsent(getDatabase(),a.id,orgId,share);revalidatePath('/account/profile');return {success:share?'Your progress is now shared.':'Your progress is no longer shared.'};} catch(e){return failure(e);}
}

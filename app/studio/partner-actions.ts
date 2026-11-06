'use server';
import {revalidatePath} from 'next/cache';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {addPartnerMember,addSeatPack,createPartner,removePartnerMember,setKeySuspended,setPartnerProducts,setPartnerBranding,setPartnerStatus,updatePartner} from '@/lib/services/partner-admin';
// PART-6 admin actions. The services re-check Super Admin with two-step sign-in on every call.
export type PartnerAdminResult={error?:string;success?:string;id?:string};
const field=(form:FormData,key:string)=>{const v=form.get(key);return typeof v==='string'?v:'';};
async function actorId() {const a=await getCurrentActor();if(staffAccess(a)!=='allowed'||!a)throw new Error('Staff access is required.');return a.id;}
function failure(error:unknown):PartnerAdminResult {return {error:error instanceof Error&&!('query' in error)&&!('code' in error)?error.message:'Unable to save this change. Please retry.'};}
const cents=(v:string)=>{const t=v.trim().replace(/[$,\s]/g,'');if(!t)return null;if(!/^\d+(\.\d{1,2})?$/.test(t))throw new Error('Enter amounts in dollars, for example 45 or 45.50.');return Math.round(Number(t)*100);};
const refresh=(id?:string)=>{revalidatePath('/studio/partners');if(id)revalidatePath(`/studio/partners/${id}`);};
export async function newPartner(_:PartnerAdminResult,form:FormData):Promise<PartnerAdminResult> {
 try {const id=await createPartner(getDatabase(),await actorId(),{name:field(form,'name'),contactEmail:field(form,'contactEmail'),billing:field(form,'billing'),creditLimit:field(form,'creditLimit'),notes:field(form,'notes')});refresh();return {success:'Partner created. Set its products, add an admin, then approve it.',id};}catch(e){return failure(e);}
}
export async function savePartner(_:PartnerAdminResult,form:FormData):Promise<PartnerAdminResult> {
 try {const id=field(form,'orgId');await updatePartner(getDatabase(),await actorId(),id,{name:field(form,'name'),contactEmail:field(form,'contactEmail'),billing:field(form,'billing'),creditLimit:field(form,'creditLimit'),lowBalanceAt:field(form,'lowBalanceAt'),notes:field(form,'notes')});refresh(id);return {success:'Saved.'};}catch(e){return failure(e);}
}
export async function changePartnerStatus(_:PartnerAdminResult,form:FormData):Promise<PartnerAdminResult> {
 try {const id=field(form,'orgId'),action=field(form,'action');await setPartnerStatus(getDatabase(),await actorId(),id,action,field(form,'note'));refresh(id);
  return {success:action==='approve'?'Approved. The partner can now assign seats and create live keys.':action==='suspend'?'Suspended. Its live API keys stopped working at once.':'Reinstated.'};}catch(e){return failure(e);}
}
export async function saveProducts(_:PartnerAdminResult,form:FormData):Promise<PartnerAdminResult> {
 try {
  const id=field(form,'orgId'),products=form.getAll('product').filter((v):v is string=>typeof v==='string').map(v=>{const [examId,months]=v.split(':');return {examId,months:Number(months),priceCents:cents(field(form,`price:${v}`))};});
  await setPartnerProducts(getDatabase(),await actorId(),id,products);refresh(id);return {success:`${products.length} ${products.length===1?'product':'products'} saved.`};
 }catch(e){return failure(e);}
}
export async function newSeatPack(_:PartnerAdminResult,form:FormData):Promise<PartnerAdminResult> {
 try {const id=field(form,'orgId'),[examId,months]=field(form,'product').split(':');
  await addSeatPack(getDatabase(),await actorId(),id,{examId,months:Number(months),seats:Number(field(form,'seats')),priceCents:cents(field(form,'price')),expiresOn:field(form,'expiresOn'),reference:field(form,'reference')});refresh(id);return {success:'Seat pack recorded. The seats are available now.'};}catch(e){return failure(e);}
}
export async function addMember(_:PartnerAdminResult,form:FormData):Promise<PartnerAdminResult> {
 try {const id=field(form,'orgId');await addPartnerMember(getDatabase(),await actorId(),id,field(form,'email'));refresh(id);return {success:'Partner admin added. They open the Partner Portal at /partner.'};}catch(e){return failure(e);}
}
export async function removeMember(orgId:string,userId:string):Promise<PartnerAdminResult> {
 try {await removePartnerMember(getDatabase(),await actorId(),orgId,userId);refresh(orgId);return {success:'Removed.'};}catch(e){return failure(e);}
}
export async function suspendKey(orgId:string,keyId:string,suspend:boolean):Promise<PartnerAdminResult> {
 try {await setKeySuspended(getDatabase(),await actorId(),keyId,suspend);refresh(orgId);return {success:suspend?'Key suspended. Requests with it are refused now.':'Key restored.'};}catch(e){return failure(e);}
}
export async function saveBranding(_:PartnerAdminResult,form:FormData):Promise<PartnerAdminResult> {
 try {const id=field(form,'orgId');await setPartnerBranding(getDatabase(),await actorId(),id,{brandName:field(form,'brandName'),logoUrl:field(form,'logoUrl'),color:field(form,'color')});refresh(id);return {success:'Branding saved. It shows on the partner’s invite pages and portal.'};}catch(error){return failure(error);}
}

'use server';
import {revalidatePath} from 'next/cache';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {stripeGateway} from '@/lib/integrations/stripe';
import {reconcileBilling,refundSubscription,resolveBillingAlert,retryWebhookEvent,setPlanPrice,syncPlansToStripe} from '@/lib/services/billing';
import {createCoupon,deactivateCoupon,syncCouponsToStripe} from '@/lib/services/coupons';
import {saveOfferSettings} from '@/lib/services/lifecycle';
export type BillingResult={error?:string;success?:string};
function field(form:FormData,key:string) {const value=form.get(key);return typeof value==='string'?value:'';}
async function actorId() {const actor=await getCurrentActor();if(staffAccess(actor)!=='allowed'||!actor)throw new Error('Staff access is required.');return actor.id;}
function failure(error:unknown):BillingResult {return {error:error instanceof Error && !('query' in error) && !('code' in error)?error.message:'Unable to complete this. Please retry.'};}
function refresh() {revalidatePath('/studio/billing');revalidatePath('/','layout');}
export async function savePrice(_:BillingResult,form:FormData):Promise<BillingResult> {
 try {
  const raw=field(form,'price').trim(),cents=raw===''?null:Math.round(Number(raw)*100);
  if(cents!==null&&!Number.isFinite(cents))throw new Error('Enter the price in US dollars, e.g. 89 or 89.99.');
  const result=await setPlanPrice(getDatabase(),stripeGateway(),await actorId(),{examId:field(form,'examId'),months:Number(field(form,'months')),priceCents:cents});
  refresh();return {success:cents===null?'Plan withdrawn from sale.':result.synced?'Price saved and created in Stripe.':'Price saved. It is not in Stripe yet; use “Sync to Stripe” once Stripe is connected.'};
 }catch(error){return failure(error);}
}
export async function syncPrices():Promise<BillingResult> {
 try {const n=await syncPlansToStripe(getDatabase(),stripeGateway(),await actorId());refresh();return {success:n?`${n} price${n===1?'':'s'} created in Stripe.`:'Everything is already in Stripe.'};}catch(error){return failure(error);}
}
export async function reconcile():Promise<BillingResult> {
 try {const gateway=stripeGateway();if(!gateway)throw new Error('Stripe is not configured.');const r=await reconcileBilling(getDatabase(),gateway,await actorId());refresh();return {success:`Checked ${r.checked} Stripe subscription${r.checked===1?'':'s'}. ${r.failed} failed, ${r.missing} missing from Stripe.`};}catch(error){return failure(error);}
}
export async function refund(_:BillingResult,form:FormData):Promise<BillingResult> {
 try {const status=await refundSubscription(getDatabase(),stripeGateway(),await actorId(),field(form,'subscriptionId'),field(form,'reason'));refresh();return {success:`Refund ${status}. Access ends when Stripe confirms the refund.`};}catch(error){return failure(error);}
}
export async function resolveAlert(_:BillingResult,form:FormData):Promise<BillingResult> {
 try {await resolveBillingAlert(getDatabase(),stripeGateway(),await actorId(),field(form,'alertId'),field(form,'resolution'),field(form,'restore')==='true');refresh();return {success:'Alert resolved.'};}catch(error){return failure(error);}
}
export async function retryEvent(eventId:string):Promise<BillingResult> {
 try {await retryWebhookEvent(getDatabase(),stripeGateway(),await actorId(),eventId);refresh();return {success:'Event processed.'};}catch(error){return failure(error);}
}
// ---- BILL-6: coupons ----
export async function newCoupon(_:BillingResult,form:FormData):Promise<BillingResult> {
 try {
  const kind=field(form,'kind')==='amount'?'amount':'percent',raw=Number(field(form,'value'));
  if(!Number.isFinite(raw))throw new Error(kind==='percent'?'Enter the percentage off, e.g. 20.':'Enter the amount off in US dollars, e.g. 15.');
  const duration=(['once','repeating','forever'].includes(field(form,'duration'))?field(form,'duration'):'once') as 'once'|'repeating'|'forever';
  const limit=field(form,'maxRedemptions').trim(),expires=field(form,'expiresAt').trim();
  const r=await createCoupon(getDatabase(),stripeGateway(),await actorId(),{code:field(form,'code'),name:field(form,'name'),kind,value:kind==='amount'?Math.round(raw*100):raw,duration,
   durationMonths:duration==='repeating'?Number(field(form,'durationMonths')):null,examIds:form.getAll('examIds').filter((v):v is string=>typeof v==='string'),
   maxRedemptions:limit?Number(limit):null,expiresAt:expires?`${expires}T23:59:59Z`:null,firstTimeOnly:field(form,'firstTimeOnly')==='true'});
  refresh();revalidatePath('/studio/billing/coupons');
  return {success:r.synced?`${r.code} is live in Stripe.`:`${r.code} is saved but not in Stripe yet. Use “Send to Stripe” once Stripe is connected and the exams have prices.`};
 }catch(error){return failure(error);}
}
export async function syncCoupons():Promise<BillingResult> {
 try {const r=await syncCouponsToStripe(getDatabase(),stripeGateway(),await actorId());revalidatePath('/studio/billing/coupons');
  return r.failed.length?{error:`${r.synced} sent. Not sent: ${r.failed.join('; ')}`}:{success:r.synced?`${r.synced} coupon${r.synced===1?'':'s'} sent to Stripe.`:'Every live coupon is already in Stripe.'};}catch(error){return failure(error);}
}
export async function turnOffCoupon(id:string):Promise<BillingResult> {
 try {await deactivateCoupon(getDatabase(),stripeGateway(),await actorId(),id);revalidatePath('/studio/billing/coupons');return {success:'Coupon turned off.'};}catch(error){return failure(error);}
}
// ---- BILL-7 / TRIAL-2: personal offers ----
export async function saveOffers(_:BillingResult,form:FormData):Promise<BillingResult> {
 try {
  const pct=(k:string)=>{const v=field(form,k).trim();return v===''?null:Number(v);};
  await saveOfferSettings(getDatabase(),await actorId(),{winBackPercent:pct('winBackPercent'),winBackValidDays:Number(field(form,'winBackValidDays')),trialOfferPercent:pct('trialOfferPercent'),referralPercent:pct('referralPercent')});
  revalidatePath('/studio/billing/coupons');return {success:'Offers saved.'};
 }catch(error){return failure(error);}
}

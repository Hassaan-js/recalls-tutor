'use server';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {getCurrentActor} from '@/lib/auth/session';
import {getDatabase} from '@/lib/db/client';
import {stripeGateway} from '@/lib/integrations/stripe';
import {billingPortalUrl,checkoutStatus,setAutoRenew,startCheckout} from '@/lib/services/billing';
import {siteUrl} from '@/lib/seo';
function field(form:FormData,key:string) {const value=form.get(key);return typeof value==='string'?value:'';}
const safePath=(path:string)=>/^\/[a-z0-9/#?=&-]*$/i.test(path)&&!path.startsWith('//')?path:'/pricing';
function message(error:unknown) {return error instanceof Error&&!('query' in error)&&!('code' in error)?error.message:'Unable to start checkout. Please retry.';}
// BILL-2: exam page → plan → Stripe Checkout. Signed-out visitors come back to the same plans after signing in.
export async function checkout(form:FormData) {
 const returnPath=safePath(field(form,'returnPath'));
 const actor=await getCurrentActor();
 if(!actor)redirect(`/sign-in?next=${encodeURIComponent(returnPath)}`);
 if(!actor.emailVerified)redirect('/verify-email');
 let url:string;
 try{url=await startCheckout(getDatabase(),stripeGateway(),actor.id,{planId:field(form,'planId'),siteUrl:siteUrl(),cancelPath:returnPath,promoCode:field(form,'promoCode').slice(0,40),fromSitting:field(form,'fromSitting').slice(0,80)});}
 catch(error){redirect(`/account/plans?notice=${encodeURIComponent(message(error))}`);}
 redirect(url);
}
export async function confirmation(sessionId:string) {
 const actor=await getCurrentActor(),gateway=stripeGateway();if(!actor||!gateway)return 'not_found' as const;
 return checkoutStatus(getDatabase(),gateway,actor.id,sessionId).catch(()=>'pending' as const);
}
export async function toggleAutoRenew(subscriptionId:string,autoRenew:boolean):Promise<{error?:string}> {
 const actor=await getCurrentActor();if(!actor)return {error:'Sign in again to change your plan.'};
 try{await setAutoRenew(getDatabase(),stripeGateway(),actor.id,subscriptionId,autoRenew);revalidatePath('/account/plans');return {};}catch(error){return {error:message(error)};}
}
export async function openBillingPortal() {
 const actor=await getCurrentActor();if(!actor)redirect('/sign-in?next=/account/plans');
 let url:string;
 try{url=await billingPortalUrl(getDatabase(),stripeGateway(),actor.id,`${siteUrl()}/account/plans`);}catch(error){redirect(`/account/plans?notice=${encodeURIComponent(message(error))}`);}
 redirect(url);
}

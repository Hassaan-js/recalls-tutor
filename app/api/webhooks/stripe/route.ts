import {getDatabase} from '@/lib/db/client';
import {stripeGateway,verifyStripeSignature} from '@/lib/integrations/stripe';
import {after} from 'next/server';
import {receiveStripeEvent} from '@/lib/services/billing';
import {runLifecycle} from '@/lib/services/lifecycle';
import {sendAuthMail} from '@/lib/auth/mail';
import {siteUrl} from '@/lib/seo';
export const dynamic='force-dynamic';
// BILL-4: Stripe webhooks are the only thing that grants or removes paid access.
export async function POST(request:Request) {
 const secret=process.env.STRIPE_WEBHOOK_SECRET,gateway=stripeGateway();
 if(!secret||!gateway)return Response.json({error:'Billing is not configured.'},{status:503});
 const body=await request.text();
 if(!verifyStripeSignature(body,request.headers.get('stripe-signature'),secret))return Response.json({error:'Invalid signature.'},{status:400});
 let event:{id?:unknown;type?:unknown;data?:{object?:{id?:unknown}}};
 try{event=JSON.parse(body);}catch{return Response.json({error:'Invalid payload.'},{status:400});}
 if(typeof event.id!=='string'||typeof event.type!=='string')return Response.json({error:'Invalid event.'},{status:400});
 // Only the ids are taken from the payload; current state is always read back from Stripe.
 const result=await receiveStripeEvent(getDatabase(),gateway,{id:event.id,type:event.type,objectId:typeof event.data?.object?.id==='string'?event.data.object.id:null});
 // Receipts and failed-payment notices go out straight away; the hourly job retries anything that failed.
 if(result==='processed'&&/^(invoice\.|customer\.subscription\.)/.test(event.type))after(()=>runLifecycle(getDatabase(),gateway,sendAuthMail,siteUrl()).catch(e=>console.error('Billing emails failed',e)));
 // A non-2xx response makes Stripe retry the delivery with backoff.
 return result==='failed'?Response.json({received:false},{status:500}):Response.json({received:true,duplicate:result==='duplicate'});
}

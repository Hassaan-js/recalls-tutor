import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {embeddedDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {seedCatalogue} from '../lib/db/seed';
import {formEncode,stripeRestGateway,verifyStripeSignature} from '../lib/integrations/stripe';
import {billingPortalUrl,checkoutStatus,getBillingAdmin,listMyPlans,receiveStripeEvent,reconcileBilling,refundSubscription,resolveBillingAlert,retryWebhookEvent,setAutoRenew,setPlanPrice,startCheckout,syncPlansToStripe} from '../lib/services/billing';
import {hasExamAccess} from '../lib/services/practice';
import {getExamPage} from '../lib/services/site';
import {FakeStripe} from './fake-stripe';
const DAY=86400,H=3600*1000,now=()=>Math.floor(Date.now()/1000);
test('Stripe adapter: form encoding, signature checks and safe error messages',async()=>{
 assert.equal(formEncode({mode:'subscription',line_items:[{price:'price_1',quantity:1}],metadata:{user_id:'u 1'}}).join('&'),'mode=subscription&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Buser_id%5D=u%201');
 const body='{"id":"evt_1"}',secret='whsec_test',t=Math.floor(Date.now()/1000);const sig=createHmac('sha256',secret).update(`${t}.${body}`).digest('hex');
 assert.equal(verifyStripeSignature(body,`t=${t},v1=${sig}`,secret),true);
 assert.equal(verifyStripeSignature(body+' ',`t=${t},v1=${sig}`,secret),false);
 assert.equal(verifyStripeSignature(body,`t=${t},v1=${sig}`,'whsec_other'),false);
 assert.equal(verifyStripeSignature(body,`t=${t-600},v1=${createHmac('sha256',secret).update(`${t-600}.${body}`).digest('hex')}`,secret),false);
 assert.equal(verifyStripeSignature(body,null,secret),false);assert.equal(verifyStripeSignature(body,'garbage',secret),false);
 let seen:{url:string;init:RequestInit}|null=null;
 const gateway=stripeRestGateway('sk_test_x',(async(url:string,init:RequestInit)=>{seen={url,init};return new Response(JSON.stringify({error:{message:'secret detail sk_test_x'}}),{status:400});}) as unknown as typeof fetch);
 await assert.rejects(gateway.createCustomer({email:'a@b.test',name:'A',userId:'u1'}),(e:Error)=>e.message==='Stripe request failed (400).');
 const headers=seen!.init.headers as Record<string,string>;
 assert.equal(headers['Stripe-Version'],'2024-06-20');assert.equal(headers['Idempotency-Key'],'customer-u1');assert.match(String(seen!.init.body),/email=a%40b.test/);
});
test('Billing: prices, checkout, webhooks to access, renewals, grace, refunds, disputes and reconciliation',async()=>{
 const db=embeddedDatabase(new PGlite());const stripe=new FakeStripe();
 try {
  await migrate(db);await seedCatalogue(db);
  async function actor(role:string,{verified=true,twoFactor=false}={}) {const authId=randomUUID();await db.query('INSERT INTO auth_users(id,name,email,email_verified,two_factor_enabled,created_at,updated_at) VALUES($1,$2,$3,$4,$5,now(),now())',[authId,role,`${authId}@example.test`,verified,twoFactor]);return (await db.query<{id:string}>('INSERT INTO app_users(auth_id,role) VALUES($1,$2) RETURNING id',[authId,role]))[0].id;}
  const admin=await actor('super_admin',{twoFactor:true}),manager=await actor('content_manager'),student=await actor('student'),unverified=await actor('student',{verified:false});
  const [exam]=await db.query<{id:string}>("SELECT id FROM exams WHERE slug='mrcog-part-1'");
  let event=0;const deliver=(type:string,objectId:string|null,id=`evt_${++event}`)=>receiveStripeEvent(db,stripe,{id,type,objectId});
  const ent=async()=>(await db.query<{ends_at:string;revoked_at:string|null}>(`SELECT ends_at::text,revoked_at::text FROM entitlements WHERE user_id=$1 AND source='subscription'`,[student]))[0];
  // BILL-1: Super Admin only; one Product per exam; a price change makes a new Price and archives the old one.
  await assert.rejects(setPlanPrice(db,stripe,manager,{examId:exam.id,months:6,priceCents:9000}),/Super Admin/);
  await assert.rejects(setPlanPrice(db,stripe,admin,{examId:exam.id,months:2,priceCents:9000}),/3, 6 or 12/);
  await setPlanPrice(db,null,admin,{examId:exam.id,months:3,priceCents:6000});// saved before Stripe is connected
  assert.equal((await getBillingAdmin(db,admin,'')).plans[0].stripePriceId,null);
  assert.equal(await syncPlansToStripe(db,stripe,admin),1);
  await setPlanPrice(db,stripe,admin,{examId:exam.id,months:6,priceCents:9000});await setPlanPrice(db,stripe,admin,{examId:exam.id,months:12,priceCents:14400});
  assert.equal(stripe.products.size,1);assert.equal(stripe.prices.size,3);
  const plan6=(await db.query<{id:string;stripe_price_id:string}>('SELECT id,stripe_price_id FROM plans WHERE months=6 AND active'))[0];
  assert.deepEqual((await getExamPage(db,'mrcog','part-1-recalls'))!.plans.map(p=>[p.months,p.highlighted,p.savingsPercent]),[[3,false,null],[6,true,25],[12,false,40]]);
  // BILL-2: verified account, plan must be in Stripe, one customer per account; checkout never grants access.
  await assert.rejects(startCheckout(db,stripe,unverified,{planId:plan6.id,siteUrl:'https://rt.test',cancelPath:'/mrcog/part-1-recalls'}),/Verify your email/);
  await assert.rejects(startCheckout(db,null,student,{planId:plan6.id,siteUrl:'https://rt.test',cancelPath:'/'}),/not configured/);
  const url=await startCheckout(db,stripe,student,{planId:plan6.id,siteUrl:'https://rt.test',cancelPath:'/mrcog/part-1-recalls#plans'});
  const sessionId=url.split('/').pop()!;const session=stripe.sessions.get(sessionId)!;
  assert.match(session.submitMessage,/rt\.test\/refund-policy/);assert.equal(session.price,plan6.stripe_price_id);assert.equal(session.userId,student);
  assert.equal(await hasExamAccess(db,student,exam.id),false);
  assert.equal(await checkoutStatus(db,stripe,student,sessionId),'pending');
  assert.equal(await checkoutStatus(db,stripe,manager,sessionId),'not_found');
  // Payment; the subscription.updated event arrives before checkout.session.completed (out of order).
  const start=now(),end=start+182*DAY;const paid=stripe.pay(sessionId,start,end);
  assert.equal(await deliver('customer.subscription.updated',paid.sub),'processed');
  assert.equal(await hasExamAccess(db,student,exam.id),true);
  assert.equal(await deliver('checkout.session.completed',sessionId,'evt_checkout'),'processed');
  assert.equal(await deliver('checkout.session.completed',sessionId,'evt_checkout'),'duplicate');// same event id twice
  assert.equal((await db.query('SELECT 1 FROM subscriptions')).length,1);assert.equal((await db.query("SELECT 1 FROM entitlements WHERE source='subscription'")).length,1);
  assert.equal(await checkoutStatus(db,stripe,student,sessionId),'active');
  assert.ok(Math.abs(Date.parse((await ent()).ends_at)-(end*1000+24*H))<5000);// period end plus renewal buffer
  await assert.rejects(startCheckout(db,stripe,student,{planId:plan6.id,siteUrl:'https://rt.test',cancelPath:'/'}),/already have a plan/);
  // BILL-3: auto-renew off keeps access to period end exactly; back on restores the buffer.
  const [mine]=await listMyPlans(db,student);assert.equal(mine.autoRenew,true);assert.equal(mine.months,6);
  await setAutoRenew(db,stripe,student,mine.id,false);
  assert.ok(Math.abs(Date.parse((await ent()).ends_at)-end*1000)<5000);assert.equal((await listMyPlans(db,student))[0].autoRenew,false);
  await assert.rejects(setAutoRenew(db,stripe,manager,mine.id,true),/not found/);
  await setAutoRenew(db,stripe,student,mine.id,true);
  assert.match(await billingPortalUrl(db,stripe,student,'https://rt.test/account/plans'),/billing\.stripe\.test/);
  // Renewal extends access; a failed renewal gives 7 days' grace, then unpaid pauses access.
  const sub=stripe.subs.get(paid.sub)!;sub.currentPeriodStart=end;sub.currentPeriodEnd=end+182*DAY;
  await deliver('invoice.paid',stripe.invoice(paid.sub,sub.customer));
  assert.ok(Math.abs(Date.parse((await ent()).ends_at)-((end+182*DAY)*1000+24*H))<5000);
  sub.status='past_due';await deliver('invoice.payment_failed',stripe.invoice(paid.sub,sub.customer,'open'));
  assert.ok(Math.abs(Date.parse((await ent()).ends_at)-((end+182*DAY)*1000+7*24*H))<5000);
  assert.ok((await listMyPlans(db,student))[0].graceUntil);assert.equal(await hasExamAccess(db,student,exam.id),true);
  sub.status='unpaid';await deliver('customer.subscription.updated',paid.sub);
  assert.equal(await hasExamAccess(db,student,exam.id),false);
  sub.status='active';await deliver('invoice.paid',stripe.invoice(paid.sub,sub.customer));// paid later: access resumes, progress kept
  assert.equal(await hasExamAccess(db,student,exam.id),true);
  // A price change does not move existing subscribers: they still map to their original plan.
  await setPlanPrice(db,stripe,admin,{examId:exam.id,months:6,priceCents:9900});
  assert.equal(stripe.prices.get(plan6.stripe_price_id)!.active,false);
  await deliver('customer.subscription.updated',paid.sub);
  assert.equal((await listMyPlans(db,student))[0].priceCents,9000);
  // BILL-5: refunds are Super Admin only; access ends when the refund webhook arrives, and stays ended.
  await assert.rejects(refundSubscription(db,stripe,manager,mine.id,'x'),/Super Admin/);
  await assert.rejects(refundSubscription(db,stripe,admin,mine.id,' '),/reason/);
  assert.equal(await refundSubscription(db,stripe,admin,mine.id,'Within 48 hours, under 50 questions (synthetic test)'),'succeeded');
  assert.equal(await hasExamAccess(db,student,exam.id),true);// not until the webhook
  const refundedCharge=[...stripe.charges.entries()].find(([,c])=>c.refunded>0)![0];
  await deliver('charge.refunded',refundedCharge);
  assert.equal(await hasExamAccess(db,student,exam.id),false);assert.equal(stripe.subs.get(paid.sub)!.status,'canceled');
  stripe.subs.get(paid.sub)!.status='active';await deliver('customer.subscription.updated',paid.sub);// a late event cannot re-grant
  assert.equal(await hasExamAccess(db,student,exam.id),false);assert.equal((await listMyPlans(db,student))[0].hold,'refunded');
  // Disputes: access is suspended, an alert is raised, and a won dispute restores access.
  const other=await actor('student');
  const s2=(await startCheckout(db,stripe,other,{planId:(await db.query<{id:string}>('SELECT id FROM plans WHERE months=3 AND active'))[0].id,siteUrl:'https://rt.test',cancelPath:'/'})).split('/').pop()!;
  const p2=stripe.pay(s2,now(),now()+91*DAY);await deliver('checkout.session.completed',s2);
  assert.equal(await hasExamAccess(db,other,exam.id),true);
  const partial=stripe.invoices.get(p2.invoice)!.charge;stripe.charges.get(partial)!.refunded=1000;
  await deliver('charge.refunded',partial);assert.equal(await hasExamAccess(db,other,exam.id),true);// partial refund: access unchanged
  stripe.disputes.set('dp_1',partial);await deliver('charge.dispute.created','dp_1');
  assert.equal(await hasExamAccess(db,other,exam.id),false);
  const [alert]=(await getBillingAdmin(db,admin,'')).alerts;assert.equal(alert.kind,'dispute');
  await resolveBillingAlert(db,stripe,admin,alert.id,'Dispute won (synthetic test)',true);
  assert.equal(await hasExamAccess(db,other,exam.id),true);
  // Failed processing is reported for Stripe to retry, alerts after three attempts, and can be retried by an admin.
  assert.equal(await deliver('customer.subscription.updated','sub_missing','evt_bad'),'failed');
  assert.equal(await deliver('customer.subscription.updated','sub_missing','evt_bad'),'failed');
  assert.equal(await deliver('customer.subscription.updated','sub_missing','evt_bad'),'failed');
  const billing=await getBillingAdmin(db,admin,'');
  assert.equal(billing.failedEvents[0].id,'evt_bad');assert.ok(billing.alerts.some(a=>a.kind==='webhook_failure'));
  await assert.rejects(retryWebhookEvent(db,stripe,admin,'evt_bad'),/failed again/);
  await assert.rejects(retryWebhookEvent(db,stripe,admin,'evt_checkout'),/already been processed/);
  // Reconciliation repairs drift and flags subscriptions Stripe no longer has.
  await db.query(`UPDATE entitlements SET ends_at=now()+interval '1000 days' WHERE user_id=$1`,[other]);
  stripe.subs.delete('sub_missing');
  const result=await reconcileBilling(db,stripe,admin);
  assert.equal(result.checked,2);assert.equal(result.failed,0);
  assert.ok(Date.parse((await db.query<{ends_at:string}>(`SELECT ends_at::text FROM entitlements WHERE user_id=$1`,[other]))[0].ends_at)<Date.now()+100*DAY*1000);
  await db.query(`UPDATE subscriptions SET stripe_subscription_id='sub_gone' WHERE user_id=$1`,[other]);
  assert.equal((await reconcileBilling(db,stripe,admin)).missing,1);
  assert.ok((await db.query("SELECT 1 FROM audit_log WHERE action IN ('plan.price_set','refund.requested','subscription.refunded','subscription.disputed','billing_alert.resolved')")).length>=7);
 }finally{await db.close();}
});

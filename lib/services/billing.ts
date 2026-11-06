import type {Database} from '../db/client';
import type {StripeGateway,StripeSubscription} from '../integrations/stripe';
import {requireId} from './studio';
import {usableCoupon} from './coupons';
import {convertReferral} from './referrals';
// BILL-3: 7-day grace after a failed renewal (PRD). The renewal buffer covers the minutes between a
// period ending and Stripe's renewal webhook arriving; it is a technical value, not a business rule.
export const GRACE_DAYS=7;
const RENEWAL_BUFFER_MS=24*60*60*1000,DAY_MS=24*60*60*1000;
const MONTHS=[1,3,6,12];// BILL-8: 1 month is optional
async function requireSuperAdmin(db:Database,actorId:string) {
 const [actor]=await db.query(`SELECT 1 FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1 AND a.role='super_admin' AND a.status='active' AND u.email_verified=true AND u.two_factor_enabled=true`,[actorId]);
 if(!actor)throw new Error('Only a Super Admin can manage billing.');
}
async function audit(db:Database,actorId:string,entityId:string,action:string,after:unknown) {
 await db.query('INSERT INTO audit_log(actor_id,entity_id,action,after_json) VALUES($1,$2,$3,$4::jsonb)',[actorId,entityId,action,JSON.stringify(after)]);
}
function requireGateway(gateway:StripeGateway|null):StripeGateway {if(!gateway)throw new Error('Stripe is not configured. Add STRIPE_SECRET_KEY to enable billing.');return gateway;}

// ---- BILL-1: plans and prices ----
export async function setPlanPrice(db:Database,gateway:StripeGateway|null,actorId:string,input:{examId:string;months:number;priceCents:number|null}) {
 requireId(input.examId);
 if(!MONTHS.includes(input.months))throw new Error('Plans are 1, 3, 6 or 12 months.');
 if(input.priceCents!==null&&(!Number.isInteger(input.priceCents)||input.priceCents<100||input.priceCents>1000000))throw new Error('Enter a price between $1 and $10,000.');
 const change=await db.transaction(async tx=>{
  await requireSuperAdmin(tx,actorId);
  if(!(await tx.query('SELECT 1 FROM exams WHERE id=$1',[input.examId])).length)throw new Error('Exam not found.');
  const [old]=await tx.query<{id:string;stripe_price_id:string|null;price_cents:number}>('UPDATE plans SET active=false WHERE exam_id=$1 AND months=$2 AND active RETURNING id,stripe_price_id,price_cents',[input.examId,input.months]);
  let planId:string|null=null;
  // A new row (and later a new Stripe Price) per change: existing subscribers keep the price they signed up on.
  if(input.priceCents!==null)planId=(await tx.query<{id:string}>('INSERT INTO plans(exam_id,months,price_cents,active) VALUES($1,$2,$3,true) RETURNING id',[input.examId,input.months,input.priceCents]))[0].id;
  await audit(tx,actorId,planId??old?.id??input.examId,input.priceCents===null?'plan.withdrawn':'plan.price_set',{examId:input.examId,months:input.months,priceCents:input.priceCents,previousCents:old?.price_cents??null});
  return {planId,oldPriceId:old?.stripe_price_id??null};
 });
 if(!gateway)return {synced:false};
 if(change.oldPriceId)await gateway.archivePrice(change.oldPriceId).catch(()=>{});
 return {synced:change.planId?await pushPlanToStripe(db,gateway,change.planId).then(()=>true,()=>false):true};
}
async function pushPlanToStripe(db:Database,gateway:StripeGateway,planId:string) {
 const [plan]=await db.query<{id:string;exam_id:string;months:number;price_cents:number;stripe_price_id:string|null;product:string|null;name:string}>('SELECT p.id,p.exam_id,p.months,p.price_cents,p.stripe_price_id,e.stripe_product_id AS product,e.name FROM plans p JOIN exams e ON e.id=p.exam_id WHERE p.id=$1',[planId]);
 if(!plan||plan.stripe_price_id)return;
 let product=plan.product;
 if(!product){product=(await gateway.createProduct({name:`${plan.name} recall question bank`,examId:plan.exam_id})).id;await db.query('UPDATE exams SET stripe_product_id=$2 WHERE id=$1 AND stripe_product_id IS NULL',[plan.exam_id,product]);}
 const price=await gateway.createPrice({product,unitAmount:plan.price_cents,months:plan.months,planId:plan.id});
 await db.query('UPDATE plans SET stripe_price_id=$2 WHERE id=$1',[plan.id,price.id]);
}
export async function syncPlansToStripe(db:Database,gateway:StripeGateway|null,actorId:string) {
 await requireSuperAdmin(db,actorId);const stripe=requireGateway(gateway);
 const pending=await db.query<{id:string}>('SELECT id FROM plans WHERE active AND stripe_price_id IS NULL');
 for(const p of pending)await pushPlanToStripe(db,stripe,p.id);
 return pending.length;
}

// ---- BILL-2: checkout (access is never granted here) ----
export async function startCheckout(db:Database,gateway:StripeGateway|null,userId:string,input:{planId:string;siteUrl:string;cancelPath:string;promoCode?:string;fromSitting?:string}) {
 requireId(input.planId);const stripe=requireGateway(gateway);
 const [user]=await db.query<{email:string;name:string;verified:boolean;status:string}>('SELECT u.email,u.name,u.email_verified AS verified,a.status FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1',[userId]);
 if(!user||user.status!=='active')throw new Error('This account cannot make purchases.');
 if(!user.verified)throw new Error('Verify your email address before buying a plan.');// AUTH-1
 const [plan]=await db.query<{exam_id:string;stripe_price_id:string|null}>('SELECT exam_id,stripe_price_id FROM plans WHERE id=$1 AND active',[input.planId]);
 if(!plan?.stripe_price_id)throw new Error('This plan is not available to buy yet.');
 if((await db.query(`SELECT 1 FROM subscriptions WHERE user_id=$1 AND exam_id=$2 AND status IN ('active','trialing','past_due') AND access_hold IS NULL`,[userId,plan.exam_id])).length)throw new Error('You already have a plan for this exam. Manage it in My plans.');
 // BILL-6: a code from our site or an emailed link is checked here; Stripe checks it again at payment.
 const coupon=input.promoCode?.trim()?await usableCoupon(db,userId,plan.exam_id,input.promoCode):null;
 // Revenue by sitting: remember which sitting page the purchase started from.
 const [sitting]=input.fromSitting&&/^[a-z0-9-]{1,80}$/.test(input.fromSitting)?await db.query<{id:string}>('SELECT id FROM sittings WHERE exam_id=$1 AND slug=$2 AND published',[plan.exam_id,input.fromSitting]):[];
 let [customer]=await db.query<{id:string}>('SELECT stripe_customer_id AS id FROM billing_customers WHERE user_id=$1',[userId]);
 if(!customer){const created=await stripe.createCustomer({email:user.email,name:user.name,userId});await db.query('INSERT INTO billing_customers(user_id,stripe_customer_id) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING',[userId,created.id]);[customer]=await db.query<{id:string}>('SELECT stripe_customer_id AS id FROM billing_customers WHERE user_id=$1',[userId]);}
 const session=await stripe.createCheckoutSession({customer:customer.id,price:plan.stripe_price_id,userId,planId:input.planId,promotionCode:coupon?.promotionCode??null,sittingId:sitting?.id??null,
  successUrl:`${input.siteUrl}/billing/confirm?session_id={CHECKOUT_SESSION_ID}`,cancelUrl:`${input.siteUrl}${input.cancelPath}`,
  submitMessage:`Plans renew automatically until you turn auto-renew off in My plans. Refund policy: ${input.siteUrl}/refund-policy`});// BILL-5: refund policy shown at checkout
 if(!session.url)throw new Error('Stripe did not return a checkout page. Please retry.');
 return session.url;
}
// The return page only reports what the webhook has already recorded.
export async function checkoutStatus(db:Database,gateway:StripeGateway|null,userId:string,sessionId:string):Promise<'active'|'pending'|'not_found'> {
 if(!/^cs_[A-Za-z0-9_]+$/.test(sessionId))return 'not_found';
 const session=await requireGateway(gateway).retrieveCheckoutSession(sessionId).catch(()=>null);
 if(!session||session.clientReferenceId!==userId)return 'not_found';
 if(!session.subscription)return 'pending';
 const [row]=await db.query(`SELECT 1 FROM subscriptions s JOIN entitlements n ON n.id=s.entitlement_id WHERE s.stripe_subscription_id=$1 AND s.user_id=$2 AND n.revoked_at IS NULL AND n.ends_at>now()`,[session.subscription,userId]);
 return row?'active':'pending';
}

// ---- BILL-3/BILL-4: Stripe state -> subscription row -> entitlement ----
function accessWindow(s:StripeSubscription,hold:string|null):{endsAt:Date|null;graceUntil:Date|null} {
 const periodEnd=new Date(s.currentPeriodEnd*1000);
 if(hold)return {endsAt:null,graceUntil:null};
 if(s.status==='active'||s.status==='trialing')return {endsAt:s.cancelAtPeriodEnd?periodEnd:new Date(periodEnd.getTime()+RENEWAL_BUFFER_MS),graceUntil:null};
 if(s.status==='past_due'){const grace=new Date(periodEnd.getTime()+GRACE_DAYS*DAY_MS);return {endsAt:grace,graceUntil:grace};}
 return {endsAt:null,graceUntil:null};// incomplete, unpaid, paused, canceled: no access until paid
}
// Order-independent: always reads the subscription from Stripe, so events can arrive in any order or twice.
export async function syncSubscription(db:Database,gateway:StripeGateway,stripeSubscriptionId:string,userHint?:string) {
 const s=await gateway.retrieveSubscription(stripeSubscriptionId);
 const [plan]=await db.query<{id:string;exam_id:string}>('SELECT id,exam_id FROM plans WHERE stripe_price_id=$1',[s.priceId]);
 if(!plan)throw new Error(`Subscription ${s.id} uses a price that is not linked to any plan.`);
 return db.transaction(async tx=>{
  const [existing]=await tx.query<{id:string;user_id:string;access_hold:string|null;entitlement_id:string|null}>('SELECT id,user_id,access_hold,entitlement_id FROM subscriptions WHERE stripe_subscription_id=$1 FOR UPDATE',[s.id]);
  let userId=existing?.user_id??null;
  if(!userId){
   const candidates=[s.metadata.user_id,userHint].filter((v):v is string=>typeof v==='string'&&/^[0-9a-f-]{36}$/i.test(v));
   const [byCustomer]=await tx.query<{user_id:string}>('SELECT user_id FROM billing_customers WHERE stripe_customer_id=$1',[s.customer]);
   if(byCustomer)userId=byCustomer.user_id;
   else for(const id of candidates)if((await tx.query('SELECT 1 FROM app_users WHERE id=$1',[id])).length){userId=id;break;}
  }
  if(!userId)throw new Error(`Subscription ${s.id} cannot be matched to an account.`);
  const hold=existing?.access_hold??null,window=accessWindow(s,hold),start=new Date(s.currentPeriodStart*1000);
  const values=[s.status,start.toISOString(),new Date(s.currentPeriodEnd*1000).toISOString(),s.cancelAtPeriodEnd,window.graceUntil?.toISOString()??null,plan.id];
  const [row]=existing
   ?await tx.query<{id:string}>('UPDATE subscriptions SET status=$2,current_period_start=$3,current_period_end=$4,cancel_at_period_end=$5,grace_until=$6,plan_id=$7,updated_at=now() WHERE id=$1 RETURNING id',[existing.id,...values])
   :await tx.query<{id:string}>('INSERT INTO subscriptions(user_id,exam_id,stripe_subscription_id,stripe_customer_id,status,current_period_start,current_period_end,cancel_at_period_end,grace_until,plan_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',[userId,plan.exam_id,s.id,s.customer,...values]);
  let entitlementId=existing?.entitlement_id??null;
  if(window.endsAt) {
   if(entitlementId)await tx.query('UPDATE entitlements SET ends_at=$2,revoked_at=NULL,starts_at=LEAST(starts_at,$3) WHERE id=$1',[entitlementId,window.endsAt.toISOString(),start.toISOString()]);
   else {entitlementId=(await tx.query<{id:string}>(`INSERT INTO entitlements(user_id,exam_id,source,starts_at,ends_at,subscription_id) VALUES($1,$2,'subscription',$3,$4,$5) RETURNING id`,[userId,plan.exam_id,start.toISOString(),window.endsAt.toISOString(),row.id]))[0].id;
    await tx.query('UPDATE subscriptions SET entitlement_id=$2 WHERE id=$1',[row.id,entitlementId]);}
  } else if(entitlementId)await tx.query('UPDATE entitlements SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1',[entitlementId]);
  await audit(tx,userId,row.id,'subscription.synced',{status:s.status,cancelAtPeriodEnd:s.cancelAtPeriodEnd,accessUntil:window.endsAt?.toISOString()??null,hold});
  return row.id;
 });
}
async function applyHold(db:Database,gateway:StripeGateway,stripeSubscriptionId:string,hold:'refunded'|'disputed',details:object) {
 const [sub]=await db.query<{id:string;user_id:string;status:string}>('SELECT id,user_id,status FROM subscriptions WHERE stripe_subscription_id=$1',[stripeSubscriptionId]);
 if(!sub)throw new Error(`Subscription ${stripeSubscriptionId} is not known yet.`);
 await db.transaction(async tx=>{
  await tx.query('UPDATE subscriptions SET access_hold=$2,updated_at=now() WHERE id=$1',[sub.id,hold]);
  await tx.query('UPDATE entitlements SET revoked_at=COALESCE(revoked_at,now()) WHERE subscription_id=$1',[sub.id]);
  if(hold==='disputed')await tx.query(`INSERT INTO billing_alerts(kind,subscription_id,details) VALUES('dispute',$1,$2::jsonb)`,[sub.id,JSON.stringify(details)]);
  await audit(tx,sub.user_id,sub.id,`subscription.${hold}`,details);
 });
 // A full refund also ends the subscription so the student is not charged again.
 if(hold==='refunded'&&!['canceled','incomplete_expired'].includes(sub.status))await gateway.cancelSubscription(stripeSubscriptionId);
 await syncSubscription(db,gateway,stripeSubscriptionId);
 if(hold==='disputed')console.warn(`[billing] dispute opened on subscription ${sub.id}`);
}
// ---- BILL-6: revenue ledger ----
const KIND:Record<string,'new'|'renewal'>={subscription_create:'new',subscription_cycle:'renewal'};
async function recordPayment(db:Database,gateway:StripeGateway,invoiceId:string) {
 const invoice=await gateway.retrieveInvoice(invoiceId);
 if(invoice.status!=='paid'||!invoice.subscription)return;
 const [sub]=await db.query<{id:string;user_id:string;exam_id:string;plan_id:string}>('SELECT id,user_id,exam_id,plan_id FROM subscriptions WHERE stripe_subscription_id=$1',[invoice.subscription]);
 if(!sub)return;
 const metadata=(await gateway.retrieveSubscription(invoice.subscription)).metadata;
 const sitting=/^[0-9a-f-]{36}$/i.test(metadata.sitting_id??'')?(await db.query<{id:string}>('SELECT id FROM sittings WHERE id=$1 AND exam_id=$2',[metadata.sitting_id,sub.exam_id]))[0]?.id??null:null;
 const [coupon]=invoice.promotionCode||invoice.coupon?await db.query<{id:string}>('SELECT id FROM coupons WHERE stripe_promotion_code_id=$1 OR stripe_coupon_id=$2 LIMIT 1',[invoice.promotionCode,invoice.coupon]):[];
 const paidAt=new Date((invoice.paidAt??Math.floor(Date.now()/1000))*1000).toISOString();
 const [row]=await db.query<{id:string}>(`INSERT INTO billing_payments(stripe_invoice_id,stripe_charge_id,subscription_id,user_id,exam_id,plan_id,sitting_id,kind,amount_cents,discount_cents,currency,coupon_id,paid_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(stripe_invoice_id) DO NOTHING RETURNING id`,
  [invoice.id,invoice.charge,sub.id,sub.user_id,sub.exam_id,sub.plan_id,sitting,KIND[invoice.billingReason??'']??'other',invoice.amountPaid,invoice.discountCents,invoice.currency,coupon?.id??null,paidAt]);
 // A refund or dispute can arrive before the payment it reverses.
 if(row&&invoice.charge)await db.query('UPDATE billing_adjustments SET payment_id=$2 WHERE stripe_charge_id=$1 AND payment_id IS NULL',[invoice.charge,row.id]);
 // Referrals: a friend's first paid invoice converts the referral; a failure here never fails the webhook.
 if(row&&invoice.amountPaid>0)await convertReferral(db,gateway,sub.user_id).catch(e=>console.error('Referral conversion failed',e));
}
async function recordAdjustment(db:Database,a:{id:string;kind:'refund'|'dispute';charge:string;amount:number;status:string}) {
 await db.query(`INSERT INTO billing_adjustments(id,kind,stripe_charge_id,payment_id,amount_cents,status) VALUES($1,$2,$3,(SELECT id FROM billing_payments WHERE stripe_charge_id=$3 LIMIT 1),$4,$5)
  ON CONFLICT(id) DO UPDATE SET amount_cents=EXCLUDED.amount_cents,status=EXCLUDED.status,payment_id=COALESCE(billing_adjustments.payment_id,EXCLUDED.payment_id),updated_at=now()`,[a.id,a.kind,a.charge,a.amount,a.status]);
}
export type StripeEvent={id:string;type:string;objectId:string|null};
export async function processStripeEvent(db:Database,gateway:StripeGateway,event:StripeEvent) {
 const id=event.objectId;
 switch(event.type) {
  case 'checkout.session.completed': {
   const session=await gateway.retrieveCheckoutSession(id!);
   if(!session.subscription)return;
   const user=session.clientReferenceId&&/^[0-9a-f-]{36}$/i.test(session.clientReferenceId)?session.clientReferenceId:undefined;
   if(user&&session.customer)await db.query('INSERT INTO billing_customers(user_id,stripe_customer_id) SELECT $1,$2 WHERE EXISTS(SELECT 1 FROM app_users WHERE id=$1) ON CONFLICT DO NOTHING',[user,session.customer]);
   await syncSubscription(db,gateway,session.subscription,user);return;
  }
  case 'customer.subscription.created':case 'customer.subscription.updated':case 'customer.subscription.deleted':
   await syncSubscription(db,gateway,id!);return;
  case 'invoice.paid':case 'invoice.payment_failed': {
   const subscription=await gateway.retrieveInvoiceSubscription(id!);
   if(subscription)await syncSubscription(db,gateway,subscription);
   if(subscription&&event.type==='invoice.paid')await recordPayment(db,gateway,id!);
   return;
  }
  case 'charge.refunded': {
   const charge=await gateway.retrieveCharge(id!);
   await recordAdjustment(db,{id:`refund:${charge.id}`,kind:'refund',charge:charge.id,amount:charge.amountRefunded,status:charge.refunded?'full':'partial'});
   // Partial refunds (goodwill credits) leave access unchanged; a full refund ends it.
   if(!charge.refunded||!charge.invoice)return;
   const subscription=await gateway.retrieveInvoiceSubscription(charge.invoice);
   if(subscription)await applyHold(db,gateway,subscription,'refunded',{chargeId:charge.id,amountRefunded:charge.amountRefunded});return;
  }
  case 'charge.dispute.created': {
   const dispute=await gateway.retrieveDispute(id!);
   await recordAdjustment(db,{id:`dispute:${dispute.id}`,kind:'dispute',charge:dispute.charge,amount:dispute.amount,status:dispute.status});
   const charge=await gateway.retrieveCharge(dispute.charge);
   const subscription=charge.invoice?await gateway.retrieveInvoiceSubscription(charge.invoice):null;
   if(subscription)await applyHold(db,gateway,subscription,'disputed',{disputeId:id,chargeId:charge.id});
   else await db.query(`INSERT INTO billing_alerts(kind,details) VALUES('dispute',$1::jsonb)`,[JSON.stringify({disputeId:id,chargeId:charge.id,note:'Charge is not linked to a subscription'})]);
   return;
  }
  case 'charge.dispute.closed': {
   const dispute=await gateway.retrieveDispute(id!);
   await recordAdjustment(db,{id:`dispute:${dispute.id}`,kind:'dispute',charge:dispute.charge,amount:dispute.amount,status:dispute.status});return;
  }
  default: return;// other event types are acknowledged and ignored
 }
}
// BILL-4: record once, process, and report failure so Stripe retries. Repeat deliveries of a processed event do nothing.
export async function receiveStripeEvent(db:Database,gateway:StripeGateway,event:StripeEvent):Promise<'processed'|'duplicate'|'failed'> {
 await db.query('INSERT INTO webhook_events(id,type,object_id) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[event.id,event.type,event.objectId]);
 const [row]=await db.query<{processed_at:string|null}>('UPDATE webhook_events SET attempts=attempts+1 WHERE id=$1 AND processed_at IS NULL RETURNING processed_at',[event.id]);
 if(!row)return 'duplicate';
 try {
  await processStripeEvent(db,gateway,event);
  await db.query('UPDATE webhook_events SET processed_at=now(),error=NULL WHERE id=$1',[event.id]);
  return 'processed';
 } catch(error) {
  const message=(error instanceof Error?error.message:'Processing failed').slice(0,500);
  const [{attempts}]=await db.query<{attempts:number}>('UPDATE webhook_events SET error=$2 WHERE id=$1 RETURNING attempts',[event.id,message]);
  if(attempts===3)await db.query(`INSERT INTO billing_alerts(kind,details) VALUES('webhook_failure',$1::jsonb)`,[JSON.stringify({eventId:event.id,type:event.type,error:message})]);
  return 'failed';
 }
}
export async function retryWebhookEvent(db:Database,gateway:StripeGateway|null,actorId:string,eventId:string) {
 await requireSuperAdmin(db,actorId);
 const [event]=await db.query<{id:string;type:string;object_id:string|null}>('SELECT id,type,object_id FROM webhook_events WHERE id=$1 AND processed_at IS NULL',[eventId]);
 if(!event)throw new Error('This event has already been processed.');
 const result=await receiveStripeEvent(db,requireGateway(gateway),{id:event.id,type:event.type,objectId:event.object_id});
 if(result==='failed')throw new Error('The event failed again. Check the error and Stripe settings.');
}

// ---- Student: My plans ----
export type MyPlan={id:string;examName:string;months:number;priceCents:number;status:string;periodEnd:string|null;autoRenew:boolean;graceUntil:string|null;accessUntil:string|null;hold:string|null};
export async function listMyPlans(db:Database,userId:string):Promise<MyPlan[]> {
 return db.query<MyPlan>(`SELECT s.id,e.name AS "examName",p.months,p.price_cents AS "priceCents",s.status,s.current_period_end::text AS "periodEnd",NOT s.cancel_at_period_end AS "autoRenew",s.grace_until::text AS "graceUntil",
  CASE WHEN n.revoked_at IS NULL AND n.ends_at>now() THEN n.ends_at::text END AS "accessUntil",s.access_hold AS hold FROM subscriptions s JOIN exams e ON e.id=s.exam_id JOIN plans p ON p.id=s.plan_id LEFT JOIN entitlements n ON n.id=s.entitlement_id WHERE s.user_id=$1 ORDER BY s.created_at DESC`,[userId]);
}
export async function setAutoRenew(db:Database,gateway:StripeGateway|null,userId:string,subscriptionId:string,autoRenew:boolean) {
 requireId(subscriptionId);const stripe=requireGateway(gateway);
 const [sub]=await db.query<{stripe_subscription_id:string;status:string;access_hold:string|null}>('SELECT stripe_subscription_id,status,access_hold FROM subscriptions WHERE id=$1 AND user_id=$2',[subscriptionId,userId]);
 if(!sub)throw new Error('Plan not found.');
 if(sub.access_hold||!['active','trialing','past_due'].includes(sub.status))throw new Error('This plan has ended and cannot be renewed here. Choose a new plan instead.');
 await stripe.setCancelAtPeriodEnd(sub.stripe_subscription_id,!autoRenew);
 await syncSubscription(db,stripe,sub.stripe_subscription_id);
}
export async function billingPortalUrl(db:Database,gateway:StripeGateway|null,userId:string,returnUrl:string) {
 const [customer]=await db.query<{id:string}>('SELECT stripe_customer_id AS id FROM billing_customers WHERE user_id=$1',[userId]);
 if(!customer)throw new Error('There is no billing account yet.');
 return (await requireGateway(gateway).createPortalSession({customer:customer.id,returnUrl})).url;
}

// ---- Super Admin: refunds, alerts, reconciliation ----
// BILL-5: the refund is issued in Stripe; access ends when the charge.refunded webhook arrives.
export async function refundSubscription(db:Database,gateway:StripeGateway|null,actorId:string,subscriptionId:string,reason:string) {
 requireId(subscriptionId);await requireSuperAdmin(db,actorId);const stripe=requireGateway(gateway);
 if(!reason.trim()||reason.length>450)throw new Error('Record the reason for the refund (up to 450 characters).');
 const [sub]=await db.query<{stripe_subscription_id:string}>('SELECT stripe_subscription_id FROM subscriptions WHERE id=$1',[subscriptionId]);
 if(!sub)throw new Error('Subscription not found.');
 const charge=await stripe.latestPaidCharge(sub.stripe_subscription_id);
 if(!charge)throw new Error('There is no paid charge to refund.');
 const refund=await stripe.createRefund({charge,subscriptionId,reason:reason.trim()});
 await audit(db,actorId,subscriptionId,'refund.requested',{chargeId:charge,refundId:refund.id,status:refund.status,reason:reason.trim()});
 return refund.status;
}
export async function resolveBillingAlert(db:Database,gateway:StripeGateway|null,actorId:string,alertId:string,resolution:string,restoreAccess:boolean) {
 requireId(alertId);await requireSuperAdmin(db,actorId);
 if(!resolution.trim()||resolution.length>500)throw new Error('Record what was decided (up to 500 characters).');
 const [alert]=await db.query<{subscription_id:string|null;kind:string}>('UPDATE billing_alerts SET resolved_at=now(),resolved_by=$2,resolution=$3 WHERE id=$1 AND resolved_at IS NULL RETURNING subscription_id,kind',[alertId,actorId,resolution.trim()]);
 if(!alert)throw new Error('This alert is already resolved.');
 // Restoring after a dispute the business won lifts the hold, so access follows Stripe again.
 if(restoreAccess&&alert.kind==='dispute'&&alert.subscription_id) {
  const [sub]=await db.query<{stripe_subscription_id:string}>(`UPDATE subscriptions SET access_hold=NULL WHERE id=$1 AND access_hold='disputed' RETURNING stripe_subscription_id`,[alert.subscription_id]);
  if(sub)await syncSubscription(db,requireGateway(gateway),sub.stripe_subscription_id);
 }
 await audit(db,actorId,alertId,'billing_alert.resolved',{resolution:resolution.trim(),restoreAccess});
}
// Nightly job: compare every Stripe subscription with our records and repair drift (BILL-4).
export async function reconcileBilling(db:Database,gateway:StripeGateway,actorId:string|null) {
 if(actorId)await requireSuperAdmin(db,actorId);
 const seen=new Set<string>();let checked=0,failed=0,cursor:string|undefined;
 do {
  const page=await gateway.listSubscriptions(cursor);
  for(const s of page.data){seen.add(s.id);checked++;
   if(!(await db.query('SELECT 1 FROM plans WHERE stripe_price_id=$1',[s.priceId])).length)continue;// not a Recalls Tutor price
   await syncSubscription(db,gateway,s.id).catch(async error=>{failed++;await db.query(`INSERT INTO billing_alerts(kind,details) VALUES('reconciliation',$1::jsonb)`,[JSON.stringify({subscription:s.id,error:error instanceof Error?error.message:'failed'})]);});}
  cursor=page.hasMore?page.data.at(-1)?.id:undefined;
 } while(cursor);
 const local=await db.query<{id:string;stripe_subscription_id:string}>(`SELECT id,stripe_subscription_id FROM subscriptions WHERE status IN ('active','trialing','past_due')`);
 const missing=local.filter(l=>!seen.has(l.stripe_subscription_id));
 for(const m of missing)await db.query(`INSERT INTO billing_alerts(kind,subscription_id,details) VALUES('reconciliation',$1,$2::jsonb)`,[m.id,JSON.stringify({note:'Active here but not found in Stripe',subscription:m.stripe_subscription_id})]);
 return {checked,failed,missing:missing.length};
}
export async function getBillingAdmin(db:Database,actorId:string,search:string) {
 await requireSuperAdmin(db,actorId);
 const exams=await db.query<{id:string;name:string;product:string|null}>('SELECT id,name,stripe_product_id AS product FROM exams ORDER BY name');
 const plans=await db.query<{id:string;examId:string;months:number;priceCents:number;active:boolean;stripePriceId:string|null;createdAt:string;subscribers:number}>(`SELECT p.id,p.exam_id AS "examId",p.months,p.price_cents AS "priceCents",p.active,p.stripe_price_id AS "stripePriceId",p.created_at::text AS "createdAt",(SELECT count(*)::int FROM subscriptions s WHERE s.plan_id=p.id AND s.status IN ('active','trialing','past_due')) AS subscribers FROM plans p ORDER BY p.months,p.created_at DESC`);
 const q=search.trim().toLowerCase();
 const subscriptions=await db.query<{id:string;email:string;examName:string;months:number;status:string;periodEnd:string|null;autoRenew:boolean;hold:string|null;accessUntil:string|null}>(`SELECT s.id,u.email,e.name AS "examName",p.months,s.status,s.current_period_end::text AS "periodEnd",NOT s.cancel_at_period_end AS "autoRenew",s.access_hold AS hold,
  CASE WHEN n.revoked_at IS NULL AND n.ends_at>now() THEN n.ends_at::text END AS "accessUntil" FROM subscriptions s JOIN app_users a ON a.id=s.user_id JOIN auth_users u ON u.id=a.auth_id JOIN exams e ON e.id=s.exam_id JOIN plans p ON p.id=s.plan_id LEFT JOIN entitlements n ON n.id=s.entitlement_id
  WHERE $1='' OR lower(u.email) LIKE '%'||$1||'%' ORDER BY s.updated_at DESC LIMIT 50`,[q]);
 const alerts=await db.query<{id:string;kind:string;details:Record<string,unknown>;createdAt:string;email:string|null}>(`SELECT b.id,b.kind,b.details,b.created_at::text AS "createdAt",u.email FROM billing_alerts b LEFT JOIN subscriptions s ON s.id=b.subscription_id LEFT JOIN app_users a ON a.id=s.user_id LEFT JOIN auth_users u ON u.id=a.auth_id WHERE b.resolved_at IS NULL ORDER BY b.created_at DESC LIMIT 50`);
 const failedEvents=await db.query<{id:string;type:string;error:string|null;attempts:number;receivedAt:string}>(`SELECT id,type,error,attempts,received_at::text AS "receivedAt" FROM webhook_events WHERE processed_at IS NULL ORDER BY received_at DESC LIMIT 50`);
 return {exams,plans,subscriptions,alerts,failedEvents};
}

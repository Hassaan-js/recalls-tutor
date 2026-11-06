import {createHmac,timingSafeEqual} from 'node:crypto';
// Thin adapter over the Stripe REST API (implementation plan section 2). Pinned API version so field
// shapes never change underneath us; handlers read state back from Stripe rather than trusting payloads.
export const STRIPE_API_VERSION='2024-06-20';
export type StripeSubscription={id:string;status:string;customer:string;priceId:string|null;currentPeriodStart:number;currentPeriodEnd:number;cancelAtPeriodEnd:boolean;metadata:Record<string,string>};
export type StripeCheckoutSession={id:string;url:string|null;status:string|null;subscription:string|null;customer:string|null;clientReferenceId:string|null;metadata:Record<string,string>};
export type StripeInvoice={id:string;subscription:string|null;charge:string|null;customer:string|null;amountPaid:number;currency:string;billingReason:string|null;discountCents:number;promotionCode:string|null;coupon:string|null;paidAt:number|null;status:string};
export type StripeDispute={id:string;charge:string;amount:number;status:string};
export type CouponInput={couponId:string;name:string;percentOff:number|null;amountOffCents:number|null;duration:'once'|'repeating'|'forever';durationMonths:number|null;products:string[];maxRedemptions:number|null;redeemBy:number|null};
export type PromotionCodeInput={couponRowId:string;coupon:string;code:string;maxRedemptions:number|null;expiresAt:number|null;firstTimeOnly:boolean;customer:string|null};
export type StripeCharge={id:string;customer:string|null;invoice:string|null;refunded:boolean;amountRefunded:number;amount:number};
export interface StripeGateway {
 createProduct(input:{name:string;examId:string}):Promise<{id:string}>;
 createPrice(input:{product:string;unitAmount:number;months:number;planId:string}):Promise<{id:string}>;
 archivePrice(id:string):Promise<void>;
 createCustomer(input:{email:string;name:string;userId:string}):Promise<{id:string}>;
 createCheckoutSession(input:{customer:string;price:string;userId:string;planId:string;successUrl:string;cancelUrl:string;submitMessage:string;promotionCode?:string|null;sittingId?:string|null}):Promise<StripeCheckoutSession>;
 retrieveCheckoutSession(id:string):Promise<StripeCheckoutSession>;
 retrieveSubscription(id:string):Promise<StripeSubscription>;
 setCancelAtPeriodEnd(id:string,cancel:boolean):Promise<StripeSubscription>;
 cancelSubscription(id:string):Promise<void>;
 listSubscriptions(startingAfter?:string):Promise<{data:StripeSubscription[];hasMore:boolean}>;
 retrieveInvoiceSubscription(invoiceId:string):Promise<string|null>;
 latestPaidCharge(subscriptionId:string):Promise<string|null>;
 retrieveCharge(id:string):Promise<StripeCharge>;
 retrieveDispute(id:string):Promise<StripeDispute>;
 retrieveInvoice(id:string):Promise<StripeInvoice>;
 createCoupon(input:CouponInput):Promise<{id:string}>;
 createPromotionCode(input:PromotionCodeInput):Promise<{id:string}>;
 setPromotionCodeActive(id:string,active:boolean):Promise<void>;
 createRefund(input:{charge:string;subscriptionId:string;reason:string}):Promise<{id:string;status:string}>;
 createPortalSession(input:{customer:string;returnUrl:string}):Promise<{url:string}>;
}
// Stripe expects application/x-www-form-urlencoded with bracketed keys for nested objects.
export function formEncode(value:unknown,prefix='',out:string[]=[]) {
 if(value===undefined||value===null)return out;
 if(typeof value==='object'&&!Array.isArray(value)){for(const [k,v] of Object.entries(value))formEncode(v,prefix?`${prefix}[${k}]`:k,out);}
 else if(Array.isArray(value)){value.forEach((v,i)=>formEncode(v,`${prefix}[${i}]`,out));}
 else out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
 return out;
}
type Raw=Record<string,unknown>;
const str=(v:unknown)=>typeof v==='string'?v:v&&typeof v==='object'&&'id' in v?String((v as {id:string}).id):null;
function subscription(raw:Raw):StripeSubscription {
 const items=(raw.items as {data?:{price?:{id?:string}}[]})?.data??[];
 return {id:String(raw.id),status:String(raw.status),customer:str(raw.customer)??'',priceId:items[0]?.price?.id??null,currentPeriodStart:Number(raw.current_period_start),currentPeriodEnd:Number(raw.current_period_end),cancelAtPeriodEnd:raw.cancel_at_period_end===true,metadata:(raw.metadata as Record<string,string>)??{}};
}
function session(raw:Raw):StripeCheckoutSession {
 return {id:String(raw.id),url:(raw.url as string)??null,status:(raw.status as string)??null,subscription:str(raw.subscription),customer:str(raw.customer),clientReferenceId:(raw.client_reference_id as string)??null,metadata:(raw.metadata as Record<string,string>)??{}};
}
export class StripeError extends Error {constructor(message:string,public status:number){super(message);this.name='StripeError';}}
export function stripeRestGateway(secretKey:string,fetcher:typeof fetch=fetch):StripeGateway {
 async function call(method:'GET'|'POST'|'DELETE',path:string,body?:object,idempotencyKey?:string):Promise<Raw> {
  const query=method==='GET'&&body?`?${formEncode(body).join('&')}`:'';
  const response=await fetcher(`https://api.stripe.com/v1${path}${query}`,{method,headers:{Authorization:`Bearer ${secretKey}`,'Stripe-Version':STRIPE_API_VERSION,'Content-Type':'application/x-www-form-urlencoded',...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},body:method==='POST'&&body?formEncode(body).join('&'):undefined});
  const json=await response.json().catch(()=>({})) as {error?:{message?:string}}&Raw;
  // Stripe error messages can echo request details, so only a generic message leaves this adapter.
  if(!response.ok)throw new StripeError(response.status===401?'Stripe rejected the API key.':`Stripe request failed (${response.status}).`,response.status);
  return json;
 }
 return {
  async createProduct({name,examId}) {return {id:String((await call('POST','/products',{name,metadata:{exam_id:examId}},`product-${examId}`)).id)};},
  async createPrice({product,unitAmount,months,planId}) {return {id:String((await call('POST','/prices',{product,unit_amount:unitAmount,currency:'usd',recurring:{interval:'month',interval_count:months},metadata:{plan_id:planId}},`price-${planId}`)).id)};},
  async archivePrice(id) {await call('POST',`/prices/${encodeURIComponent(id)}`,{active:false});},
  async createCustomer({email,name,userId}) {return {id:String((await call('POST','/customers',{email,name,metadata:{user_id:userId}},`customer-${userId}`)).id)};},
  async createCheckoutSession(input) {
   // BILL-6: a code chosen on our site is applied directly; otherwise students can type one on Stripe's page.
   const metadata={user_id:input.userId,plan_id:input.planId,...(input.sittingId?{sitting_id:input.sittingId}:{})};
   return session(await call('POST','/checkout/sessions',{mode:'subscription',customer:input.customer,line_items:[{price:input.price,quantity:1}],client_reference_id:input.userId,
    ...(input.promotionCode?{discounts:[{promotion_code:input.promotionCode}]}:{allow_promotion_codes:true}),
    metadata,subscription_data:{metadata},success_url:input.successUrl,cancel_url:input.cancelUrl,custom_text:{submit:{message:input.submitMessage}}}));
  },
  async retrieveCheckoutSession(id) {return session(await call('GET',`/checkout/sessions/${encodeURIComponent(id)}`));},
  async retrieveSubscription(id) {return subscription(await call('GET',`/subscriptions/${encodeURIComponent(id)}`));},
  async setCancelAtPeriodEnd(id,cancel) {return subscription(await call('POST',`/subscriptions/${encodeURIComponent(id)}`,{cancel_at_period_end:cancel}));},
  async cancelSubscription(id) {await call('DELETE',`/subscriptions/${encodeURIComponent(id)}`);},
  async listSubscriptions(startingAfter) {const raw=await call('GET','/subscriptions',{status:'all',limit:100,...(startingAfter?{starting_after:startingAfter}:{})});return {data:((raw.data as Raw[])??[]).map(subscription),hasMore:raw.has_more===true};},
  async retrieveInvoiceSubscription(id) {return str((await call('GET',`/invoices/${encodeURIComponent(id)}`)).subscription);},
  async latestPaidCharge(subscriptionId) {const raw=await call('GET','/invoices',{subscription:subscriptionId,status:'paid',limit:1});return str(((raw.data as Raw[])??[])[0]?.charge);},
  async retrieveCharge(id) {const raw=await call('GET',`/charges/${encodeURIComponent(id)}`);return {id:String(raw.id),customer:str(raw.customer),invoice:str(raw.invoice),refunded:raw.refunded===true,amountRefunded:Number(raw.amount_refunded),amount:Number(raw.amount)};},
  async retrieveDispute(id) {const raw=await call('GET',`/disputes/${encodeURIComponent(id)}`);return {id:String(raw.id),charge:String(str(raw.charge)),amount:Number(raw.amount),status:String(raw.status)};},
  async retrieveInvoice(id) {
   const raw=await call('GET',`/invoices/${encodeURIComponent(id)}`,{expand:['discounts']});
   const discounts=((raw.discounts as Raw[])??[]).filter(d=>d&&typeof d==='object');
   const amounts=(raw.total_discount_amounts as {amount?:number}[])??[];
   const paidAt=(raw.status_transitions as {paid_at?:number}|undefined)?.paid_at;
   return {id:String(raw.id),subscription:str(raw.subscription),charge:str(raw.charge),customer:str(raw.customer),amountPaid:Number(raw.amount_paid??0),currency:String(raw.currency??'usd'),
    billingReason:(raw.billing_reason as string)??null,discountCents:amounts.reduce((s,a)=>s+Number(a.amount??0),0),promotionCode:str(discounts[0]?.promotion_code),coupon:str(discounts[0]?.coupon),paidAt:typeof paidAt==='number'?paidAt:null,status:String(raw.status)};
  },
  async createCoupon(i) {
   const body={name:i.name.slice(0,40),duration:i.duration,...(i.durationMonths?{duration_in_months:i.durationMonths}:{}),...(i.percentOff!==null?{percent_off:i.percentOff}:{amount_off:i.amountOffCents,currency:'usd'}),
    ...(i.products.length?{applies_to:{products:i.products}}:{}),...(i.maxRedemptions?{max_redemptions:i.maxRedemptions}:{}),...(i.redeemBy?{redeem_by:i.redeemBy}:{}),metadata:{coupon_id:i.couponId}};
   return {id:String((await call('POST','/coupons',body,`coupon-${i.couponId}`)).id)};
  },
  async createPromotionCode(i) {
   const body={coupon:i.coupon,code:i.code,...(i.maxRedemptions?{max_redemptions:i.maxRedemptions}:{}),...(i.expiresAt?{expires_at:i.expiresAt}:{}),...(i.customer?{customer:i.customer}:{}),
    ...(i.firstTimeOnly?{restrictions:{first_time_transaction:true}}:{}),metadata:{coupon_id:i.couponRowId}};
   return {id:String((await call('POST','/promotion_codes',body,`promo-${i.couponRowId}`)).id)};
  },
  async setPromotionCodeActive(id,active) {await call('POST',`/promotion_codes/${encodeURIComponent(id)}`,{active});},
  async createRefund({charge,subscriptionId,reason}) {const raw=await call('POST','/refunds',{charge,reason:'requested_by_customer',metadata:{subscription_id:subscriptionId,note:reason.slice(0,450)}},`refund-${charge}`);return {id:String(raw.id),status:String(raw.status)};},
  async createPortalSession({customer,returnUrl}) {return {url:String((await call('POST','/billing_portal/sessions',{customer,return_url:returnUrl})).url)};},
 };
}
// Returns null when Stripe is not configured, so the site shows "Checkout opens soon" instead of failing.
export function stripeGateway():StripeGateway|null {
 const key=process.env.STRIPE_SECRET_KEY;
 if(!key)return null;
 if(process.env.NODE_ENV==='production'&&!key.startsWith('sk_live_')&&process.env.STRIPE_ALLOW_TEST_MODE!=='true')throw new Error('Production requires a live Stripe key, or STRIPE_ALLOW_TEST_MODE=true for staging.');
 return stripeRestGateway(key);
}
// BILL-4: verify the Stripe-Signature header (HMAC-SHA256 of "timestamp.body") with a 5-minute tolerance.
export function verifyStripeSignature(rawBody:string,header:string|null,secret:string,now=Date.now(),toleranceSeconds=300) {
 if(!header)return false;
 const parts=header.split(',').map(p=>p.split('='));const timestamp=Number(parts.find(([k])=>k==='t')?.[1]);
 const signatures=parts.filter(([k])=>k==='v1').map(([,v])=>v);
 if(!Number.isFinite(timestamp)||!signatures.length||Math.abs(now/1000-timestamp)>toleranceSeconds)return false;
 const expected=Buffer.from(createHmac('sha256',secret).update(`${timestamp}.${rawBody}`).digest('hex'));
 return signatures.some(s=>{const given=Buffer.from(s);return given.length===expected.length&&timingSafeEqual(given,expected);});
}

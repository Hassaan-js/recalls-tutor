import type {StripeGateway,StripeSubscription} from '../lib/integrations/stripe';
// An in-memory Stripe that behaves like the real API for the calls the app makes.
export class FakeStripe implements StripeGateway {
 n=0;id=(p:string)=>`${p}_${++this.n}`;
 products=new Map<string,string>();prices=new Map<string,{product:string;amount:number;months:number;active:boolean}>();customers=new Map<string,string>();
 sessions=new Map<string,{customer:string;price:string;userId:string;planId:string;subscription:string|null;submitMessage:string;promotionCode?:string|null;sittingId?:string|null}>();
 subs=new Map<string,StripeSubscription>();invoices=new Map<string,{subscription:string;charge:string;status:string;reason:string;amount:number;discount:number;promo:string|null;coupon:string|null;paidAt:number}>();
 coupons=new Map<string,{name:string;percentOff:number|null;amountOffCents:number|null;products:string[]}>();promos=new Map<string,{coupon:string;code:string;active:boolean;customer:string|null;maxRedemptions:number|null}>();
 charges=new Map<string,{invoice:string;customer:string;amount:number;refunded:number}>();disputes=new Map<string,string>();refunds:string[]=[];
 async createProduct({name}:{name:string}){const id=this.id('prod');this.products.set(id,name);return {id};}
 async createPrice({product,unitAmount,months}:{product:string;unitAmount:number;months:number}){const id=this.id('price');this.prices.set(id,{product,amount:unitAmount,months,active:true});return {id};}
 async archivePrice(id:string){this.prices.get(id)!.active=false;}
 async createCustomer({email}:{email:string}){const id=this.id('cus');this.customers.set(id,email);return {id};}
 async createCheckoutSession(i:{customer:string;price:string;userId:string;planId:string;submitMessage:string;promotionCode?:string|null;sittingId?:string|null}){const id=this.id('cs');this.sessions.set(id,{...i,subscription:null});return {id,url:`https://checkout.stripe.test/${id}`,status:'open',subscription:null,customer:i.customer,clientReferenceId:i.userId,metadata:{}};}
 async retrieveCheckoutSession(id:string){const s=this.sessions.get(id);if(!s)throw new Error('no session');return {id,url:null,status:s.subscription?'complete':'open',subscription:s.subscription,customer:s.customer,clientReferenceId:s.userId,metadata:{user_id:s.userId,plan_id:s.planId}};}
 async retrieveSubscription(id:string){const s=this.subs.get(id);if(!s)throw new Error('no subscription');return {...s};}
 async setCancelAtPeriodEnd(id:string,cancel:boolean){this.subs.get(id)!.cancelAtPeriodEnd=cancel;return {...this.subs.get(id)!};}
 async cancelSubscription(id:string){this.subs.get(id)!.status='canceled';}
 async listSubscriptions(){return {data:[...this.subs.values()].map(s=>({...s})),hasMore:false};}
 async retrieveInvoiceSubscription(id:string){return this.invoices.get(id)?.subscription??null;}
 async latestPaidCharge(sub:string){return [...this.invoices.values()].reverse().find(i=>i.subscription===sub&&i.status==='paid')?.charge??null;}
 async retrieveCharge(id:string){const c=this.charges.get(id)!;return {id,customer:c.customer,invoice:c.invoice,refunded:c.refunded>=c.amount,amountRefunded:c.refunded,amount:c.amount};}
 disputeStatus=new Map<string,string>();
 async retrieveDispute(id:string){const charge=this.disputes.get(id)!;return {id,charge,amount:this.charges.get(charge)!.amount,status:this.disputeStatus.get(id)??'needs_response'};}
 async retrieveInvoice(id:string){const i=this.invoices.get(id)!;return {id,subscription:i.subscription,charge:i.amount>0?i.charge:null,customer:null,amountPaid:i.status==='paid'?i.amount:0,currency:'usd',billingReason:i.reason,discountCents:i.discount,promotionCode:i.promo,coupon:i.coupon,paidAt:i.paidAt,status:i.status};}
 async createCoupon(i:{name:string;percentOff:number|null;amountOffCents:number|null;products:string[]}){const id=this.id('co');this.coupons.set(id,i);return {id};}
 async createPromotionCode(i:{coupon:string;code:string;customer:string|null;maxRedemptions:number|null}){if([...this.promos.values()].some(p=>p.code===i.code))throw new Error('code exists');const id=this.id('promo');this.promos.set(id,{...i,active:true});return {id};}
 async setPromotionCodeActive(id:string,active:boolean){this.promos.get(id)!.active=active;}
 async createRefund({charge}:{charge:string}){const c=this.charges.get(charge)!;c.refunded=c.amount;const id=this.id('re');this.refunds.push(id);return {id,status:'succeeded'};}
 async createPortalSession({customer}:{customer:string}){return {url:`https://billing.stripe.test/${customer}`};}
 // Simulates the customer paying on the hosted checkout page.
 pay(sessionId:string,start:number,end:number){const s=this.sessions.get(sessionId)!;const sub=this.id('sub');s.subscription=sub;
  this.subs.set(sub,{id:sub,status:'active',customer:s.customer,priceId:s.price,currentPeriodStart:start,currentPeriodEnd:end,cancelAtPeriodEnd:false,metadata:{user_id:s.userId,plan_id:s.planId,...(s.sittingId?{sitting_id:s.sittingId}:{})}});
  const list=this.prices.get(s.price)!.amount,promo=s.promotionCode?this.promos.get(s.promotionCode)!:null,c=promo?this.coupons.get(promo.coupon)!:null;
  const discount=c?(c.percentOff!==null?Math.round(list*c.percentOff/100):Math.min(list,c.amountOffCents!)):0;
  return {sub,invoice:this.invoice(sub,s.customer,'paid',{reason:'subscription_create',amount:list-discount,discount,promo:s.promotionCode??null,coupon:promo?.coupon??null})};}
 invoice(sub:string,customer:string,status='paid',o:{reason?:string;amount?:number;discount?:number;promo?:string|null;coupon?:string|null}={}){const inv=this.id('in'),charge=this.id('ch');const amount=o.amount??this.prices.get(this.subs.get(sub)!.priceId!)?.amount??9000;
  this.invoices.set(inv,{subscription:sub,charge,status,reason:o.reason??'subscription_cycle',amount,discount:o.discount??0,promo:o.promo??null,coupon:o.coupon??null,paidAt:Math.floor(Date.now()/1000)});this.charges.set(charge,{invoice:inv,customer,amount,refunded:0});return inv;}
}

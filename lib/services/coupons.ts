import {randomBytes} from 'node:crypto';
import type {Database} from '../db/client';
import type {StripeGateway} from '../integrations/stripe';
import {requireId} from './studio';
// BILL-6: coupons and promotion codes. A coupon is saved here first and then created in Stripe
// (one Stripe coupon plus one promotion code), so it can be prepared before Stripe is connected.
export class CouponError extends Error {constructor(message:string){super(message);this.name='CouponError';}}
export type CouponInput={code:string;name:string;kind:'percent'|'amount';value:number;duration:'once'|'repeating'|'forever';durationMonths:number|null;examIds:string[];maxRedemptions:number|null;expiresAt:string|null;firstTimeOnly:boolean};
type CouponRow={id:string;code:string;name:string;kind:'percent'|'amount';percent_off:string|null;amount_off_cents:number|null;duration:'once'|'repeating'|'forever';duration_months:number|null;exam_ids:string[];max_redemptions:number|null;expires_at:string|null;first_time_only:boolean;purpose:string;user_id:string|null;stripe_coupon_id:string|null;stripe_promotion_code_id:string|null;active:boolean};
const CODE=/^[A-Z0-9-]{3,40}$/;
export const normaliseCode=(code:string)=>code.trim().toUpperCase().replace(/\s+/g,'');
async function requireSuperAdmin(db:Database,actorId:string) {
 const [actor]=await db.query(`SELECT 1 FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1 AND a.role='super_admin' AND a.status='active' AND u.email_verified=true AND u.two_factor_enabled=true`,[actorId]);
 if(!actor)throw new CouponError('Only a Super Admin can manage coupons.');
}
async function audit(db:Database,actorId:string|null,entityId:string,action:string,after:unknown) {
 await db.query('INSERT INTO audit_log(actor_id,entity_id,action,after_json) VALUES($1,$2,$3,$4::jsonb)',[actorId,entityId,action,JSON.stringify(after)]);
}
export function describeDiscount(c:{kind:string;percentOff:number|null;amountOffCents:number|null;duration:string;durationMonths:number|null}) {
 const off=c.kind==='percent'?`${Number(c.percentOff)}% off`:`$${((c.amountOffCents??0)/100).toFixed(2).replace(/\.00$/,'')} off`;
 return `${off} ${c.duration==='once'?'the first payment':c.duration==='forever'?'every payment':`for ${c.durationMonths} month${c.durationMonths===1?'':'s'}`}`;
}

export async function createCoupon(db:Database,gateway:StripeGateway|null,actorId:string,input:CouponInput) {
 await requireSuperAdmin(db,actorId);
 const code=normaliseCode(input.code),name=input.name.trim();
 if(!CODE.test(code))throw new CouponError('Codes are 3 to 40 letters, numbers or hyphens, for example SPRING25.');
 if(!name||name.length>80)throw new CouponError('Give the coupon a name for your records (up to 80 characters).');
 let percent:number|null=null,cents:number|null=null;
 if(input.kind==='percent'){if(!Number.isFinite(input.value)||input.value<=0||input.value>100)throw new CouponError('A percentage discount is between 1 and 100.');percent=Math.round(input.value*100)/100;}
 else if(input.kind==='amount'){if(!Number.isInteger(input.value)||input.value<100||input.value>1000000)throw new CouponError('A fixed discount is between $1 and $10,000.');cents=input.value;}
 else throw new CouponError('Choose a percentage or a fixed amount.');
 if(!['once','repeating','forever'].includes(input.duration))throw new CouponError('Choose how long the discount lasts.');
 const months=input.duration==='repeating'?input.durationMonths:null;
 if(input.duration==='repeating'&&(!Number.isInteger(months)||months!<1||months!>36))throw new CouponError('Enter the number of months the discount lasts (1 to 36).');
 if(input.maxRedemptions!==null&&(!Number.isInteger(input.maxRedemptions)||input.maxRedemptions<1||input.maxRedemptions>100000))throw new CouponError('The use limit is a whole number from 1 to 100,000, or blank for no limit.');
 let expires:Date|null=null;
 if(input.expiresAt){expires=new Date(input.expiresAt);if(Number.isNaN(expires.getTime())||expires.getTime()<=Date.now()+60_000)throw new CouponError('The end date must be in the future.');}
 const examIds=[...new Set(input.examIds)];examIds.forEach(requireId);
 if(examIds.length&&(await db.query('SELECT id FROM exams WHERE id=ANY($1::uuid[])',[examIds])).length!==examIds.length)throw new CouponError('One of the chosen exams was not found.');
 const id=await db.transaction(async tx=>{
  if((await tx.query('SELECT 1 FROM coupons WHERE code=$1',[code])).length)throw new CouponError(`The code ${code} already exists. Codes cannot be reused.`);
  const [row]=await tx.query<{id:string}>(`INSERT INTO coupons(code,name,kind,percent_off,amount_off_cents,duration,duration_months,exam_ids,max_redemptions,expires_at,first_time_only,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8::uuid[],$9,$10,$11,$12) RETURNING id`,[code,name,input.kind,percent,cents,input.duration,months,examIds,input.maxRedemptions,expires?.toISOString()??null,input.firstTimeOnly,actorId]);
  await audit(tx,actorId,row.id,'coupon.created',{code,name,kind:input.kind,percent,cents,duration:input.duration,months,examIds,maxRedemptions:input.maxRedemptions,expiresAt:expires?.toISOString()??null,firstTimeOnly:input.firstTimeOnly});
  return row.id;
 });
 if(!gateway)return {id,code,synced:false};
 return {id,code,synced:await pushCouponToStripe(db,gateway,id).then(()=>true,()=>false)};
}
async function pushCouponToStripe(db:Database,gateway:StripeGateway,id:string) {
 const [c]=await db.query<CouponRow>('SELECT * FROM coupons WHERE id=$1',[id]);
 if(!c||!c.active||c.stripe_promotion_code_id)return;
 let products:string[]=[];
 if(c.exam_ids.length){
  const rows=await db.query<{product:string|null;name:string}>('SELECT stripe_product_id AS product,name FROM exams WHERE id=ANY($1::uuid[])',[c.exam_ids]);
  const missing=rows.filter(r=>!r.product);
  if(missing.length)throw new CouponError(`${missing.map(m=>m.name).join(', ')} ${missing.length===1?'is':'are'} not in Stripe yet. Set a price and sync it first.`);
  products=rows.map(r=>r.product!);
 }
 let couponId=c.stripe_coupon_id;
 if(!couponId){
  couponId=(await gateway.createCoupon({couponId:c.id,name:c.name,percentOff:c.percent_off===null?null:Number(c.percent_off),amountOffCents:c.amount_off_cents,duration:c.duration,durationMonths:c.duration_months,products,maxRedemptions:null,redeemBy:null})).id;
  await db.query('UPDATE coupons SET stripe_coupon_id=$2 WHERE id=$1',[c.id,couponId]);
 }
 let customer:string|null=null;
 if(c.user_id){const [row]=await db.query<{id:string}>('SELECT stripe_customer_id AS id FROM billing_customers WHERE user_id=$1',[c.user_id]);customer=row?.id??null;}
 const promo=await gateway.createPromotionCode({couponRowId:c.id,coupon:couponId,code:c.code,maxRedemptions:c.max_redemptions,expiresAt:c.expires_at?Math.floor(Date.parse(c.expires_at)/1000):null,firstTimeOnly:c.first_time_only,customer});
 await db.query('UPDATE coupons SET stripe_promotion_code_id=$2 WHERE id=$1',[c.id,promo.id]);
}
export async function syncCouponsToStripe(db:Database,gateway:StripeGateway|null,actorId:string) {
 await requireSuperAdmin(db,actorId);
 if(!gateway)throw new CouponError('Stripe is not configured. Add STRIPE_SECRET_KEY first.');
 const pending=await db.query<{id:string;code:string}>(`SELECT id,code FROM coupons WHERE active AND stripe_promotion_code_id IS NULL AND (expires_at IS NULL OR expires_at>now()) ORDER BY created_at`);
 const failed:string[]=[];
 for(const p of pending)await pushCouponToStripe(db,gateway,p.id).catch(error=>{failed.push(`${p.code}: ${error instanceof CouponError?error.message:'Stripe refused it'}`);});
 return {synced:pending.length-failed.length,failed};
}
export async function deactivateCoupon(db:Database,gateway:StripeGateway|null,actorId:string,id:string) {
 requireId(id);await requireSuperAdmin(db,actorId);
 const [c]=await db.query<{code:string;stripe_promotion_code_id:string|null;active:boolean}>('SELECT code,stripe_promotion_code_id,active FROM coupons WHERE id=$1',[id]);
 if(!c)throw new CouponError('Coupon not found.');
 if(!c.active)throw new CouponError('This coupon is already turned off.');
 // Turn it off in Stripe first: a code left live there could still be typed at checkout.
 if(c.stripe_promotion_code_id){if(!gateway)throw new CouponError('Stripe is not configured, so the code cannot be turned off there.');await gateway.setPromotionCodeActive(c.stripe_promotion_code_id,false);}
 await db.query('UPDATE coupons SET active=false,deactivated_at=now() WHERE id=$1',[id]);
 await audit(db,actorId,id,'coupon.deactivated',{code:c.code});
}
export type CouponSummary={id:string;code:string;name:string;kind:string;percentOff:number|null;amountOffCents:number|null;duration:string;durationMonths:number|null;exams:string[];maxRedemptions:number|null;expiresAt:string|null;firstTimeOnly:boolean;purpose:string;active:boolean;synced:boolean;uses:number;discountCents:number;paidCents:number;state:'live'|'not_synced'|'expired'|'used_up'|'off'};
export async function listCoupons(db:Database,actorId:string,{personal=false}={}):Promise<CouponSummary[]> {
 await requireSuperAdmin(db,actorId);
 const rows=await db.query<Omit<CouponSummary,'state'>>(`SELECT c.id,c.code,c.name,c.kind,c.percent_off::float AS "percentOff",c.amount_off_cents AS "amountOffCents",c.duration,c.duration_months AS "durationMonths",
  COALESCE((SELECT array_agg(e.name ORDER BY e.name) FROM exams e WHERE e.id=ANY(c.exam_ids)),'{}') AS exams,c.max_redemptions AS "maxRedemptions",c.expires_at::text AS "expiresAt",c.first_time_only AS "firstTimeOnly",c.purpose,c.active,
  c.stripe_promotion_code_id IS NOT NULL AS synced,count(p.id)::int AS uses,COALESCE(sum(p.discount_cents),0)::int AS "discountCents",COALESCE(sum(p.amount_cents),0)::int AS "paidCents"
  FROM coupons c LEFT JOIN billing_payments p ON p.coupon_id=c.id WHERE ($1 OR c.purpose='campaign') GROUP BY c.id ORDER BY c.active DESC,c.created_at DESC LIMIT 300`,[personal]);
 return rows.map(r=>({...r,state:!r.active?'off':r.expiresAt&&Date.parse(r.expiresAt)<=Date.now()?'expired':r.maxRedemptions!==null&&r.uses>=r.maxRedemptions?'used_up':!r.synced?'not_synced':'live'}));
}
// Personal-offer totals for the coupons page: how many were issued and how many were used.
export async function personalOfferStats(db:Database,actorId:string) {
 await requireSuperAdmin(db,actorId);
 return db.query<{purpose:string;issued:number;used:number;paidCents:number}>(`SELECT c.purpose,count(DISTINCT c.id)::int AS issued,count(DISTINCT p.coupon_id)::int AS used,COALESCE(sum(p.amount_cents),0)::int AS "paidCents"
  FROM coupons c LEFT JOIN billing_payments p ON p.coupon_id=c.id WHERE c.purpose<>'campaign' GROUP BY c.purpose ORDER BY c.purpose`);
}
// Checkout: a code typed on our site (or carried by an emailed link) is checked here, then Stripe checks it again.
export async function usableCoupon(db:Database,userId:string,examId:string,rawCode:string) {
 const code=normaliseCode(rawCode);
 const invalid=new CouponError(`The code ${code||rawCode.trim()} is not valid for this plan.`);
 if(!CODE.test(code))throw invalid;
 const [c]=await db.query<CouponRow&{uses:number}>('SELECT c.*,(SELECT count(*)::int FROM billing_payments p WHERE p.coupon_id=c.id) AS uses FROM coupons c WHERE c.code=$1',[code]);
 if(!c||!c.active||!c.stripe_promotion_code_id)throw invalid;
 if(c.expires_at&&Date.parse(c.expires_at)<=Date.now())throw new CouponError(`The code ${code} has expired.`);
 if(c.max_redemptions!==null&&c.uses>=c.max_redemptions)throw new CouponError(`The code ${code} has been used up.`);
 if(c.exam_ids.length&&!c.exam_ids.includes(examId))throw invalid;
 if(c.user_id&&c.user_id!==userId)throw invalid;
 if(c.first_time_only&&(await db.query('SELECT 1 FROM billing_payments WHERE user_id=$1 AND amount_cents>0',[userId])).length)throw new CouponError(`The code ${code} is for first purchases only.`);
 return {id:c.id,code,promotionCode:c.stripe_promotion_code_id};
}
// BILL-7 / TRIAL-2: a single-use code for one account and one exam, valid for a few days.
export async function issuePersonalCoupon(db:Database,gateway:StripeGateway,input:{userId:string;examId:string;purpose:'win_back'|'trial_offer'|'referral';percentOff:number;validDays:number;name:string;unique?:string}) {
 const prefix=input.purpose==='win_back'?'BACK':input.purpose==='referral'?'FRIEND':'TRIAL';
 const expires=new Date(Date.now()+input.validDays*86400_000).toISOString();
 const [made]=await db.query<{id:string}>(`INSERT INTO coupons(code,name,kind,percent_off,duration,exam_ids,max_redemptions,expires_at,purpose,user_id)
  VALUES($1,$2,'percent',$3,'once',ARRAY[$4::uuid],1,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,[`${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`,input.name,input.percentOff,input.examId,expires,input.purpose,input.userId]);
 // Referral codes are one per friend (input.unique), so a repeat call never reuses another friend's code.
 if(!made&&input.purpose==='referral')throw new CouponError('Could not create the referral code.');
 const [row]=made?[made]:await db.query<{id:string}>(`SELECT id FROM coupons WHERE user_id=$1 AND purpose=$2 AND exam_ids=ARRAY[$3::uuid]`,[input.userId,input.purpose,input.examId]);
 await pushCouponToStripe(db,gateway,row.id);
 const [c]=await db.query<{id:string;code:string;expires_at:string;active:boolean;synced:boolean}>('SELECT id,code,expires_at::text,active,stripe_promotion_code_id IS NOT NULL AS synced FROM coupons WHERE id=$1',[row.id]);
 return {...c,fresh:Boolean(made)};
}

// ---- Revenue reports ----
const DATE=/^\d{4}-\d{2}-\d{2}$/;
function range(from:string,to:string) {
 if(!DATE.test(from)||!DATE.test(to)||Number.isNaN(Date.parse(from))||Number.isNaN(Date.parse(to)))throw new CouponError('Choose a start and end date.');
 if(from>to)throw new CouponError('The start date is after the end date.');
 return [`${from}T00:00:00Z`,new Date(Date.parse(`${to}T00:00:00Z`)+86400_000).toISOString()];
}
export type RevenueGroup={key:string;label:string;payments:number;paidCents:number;discountCents:number;refundCents:number;disputeCents:number};
export async function revenueReport(db:Database,actorId:string,input:{from:string;to:string;group:'day'|'month'}) {
 await requireSuperAdmin(db,actorId);
 const [start,end]=range(input.from,input.to),unit=input.group==='day'?'day':'month';
 // Refunds and disputes count in the period they happened, against the payment they reverse.
 const grouped=(key:string,label:string,join='')=>db.query<RevenueGroup>(`WITH pay AS (SELECT ${key} AS key,${label} AS label,count(*)::int AS payments,sum(p.amount_cents)::int AS paid,sum(p.discount_cents)::int AS discount FROM billing_payments p ${join} WHERE p.paid_at>=$1 AND p.paid_at<$2 GROUP BY 1,2),
  adj AS (SELECT ${key} AS key,${label} AS label,sum(a.amount_cents) FILTER (WHERE a.kind='refund')::int AS refunds,sum(a.amount_cents) FILTER (WHERE a.kind='dispute' AND a.status IS DISTINCT FROM 'won')::int AS disputes FROM billing_adjustments a JOIN billing_payments p ON p.id=a.payment_id ${join} WHERE a.created_at>=$1 AND a.created_at<$2 GROUP BY 1,2)
  SELECT COALESCE(pay.key,adj.key) AS key,COALESCE(pay.label,adj.label) AS label,COALESCE(pay.payments,0) AS payments,COALESCE(pay.paid,0) AS "paidCents",COALESCE(pay.discount,0) AS "discountCents",COALESCE(adj.refunds,0) AS "refundCents",COALESCE(adj.disputes,0) AS "disputeCents"
  FROM pay FULL JOIN adj ON COALESCE(adj.key,'')=COALESCE(pay.key,'') ORDER BY "paidCents" DESC,2`,[start,end]);
 // The period key uses the payment date for payments and the adjustment date for refunds and disputes.
 const periods=await db.query<RevenueGroup&{newCents:number;renewalCents:number}>(`WITH pay AS (SELECT date_trunc('${unit}',p.paid_at AT TIME ZONE 'UTC') AS k,count(*)::int AS payments,sum(p.amount_cents)::int AS paid,sum(p.discount_cents)::int AS discount,
   COALESCE(sum(p.amount_cents) FILTER (WHERE p.kind='new'),0)::int AS new_cents,COALESCE(sum(p.amount_cents) FILTER (WHERE p.kind='renewal'),0)::int AS renewal_cents FROM billing_payments p WHERE p.paid_at>=$1 AND p.paid_at<$2 GROUP BY 1),
  adj AS (SELECT date_trunc('${unit}',a.created_at AT TIME ZONE 'UTC') AS k,sum(a.amount_cents) FILTER (WHERE a.kind='refund')::int AS refunds,sum(a.amount_cents) FILTER (WHERE a.kind='dispute' AND a.status IS DISTINCT FROM 'won')::int AS disputes FROM billing_adjustments a WHERE a.created_at>=$1 AND a.created_at<$2 GROUP BY 1)
  SELECT to_char(COALESCE(pay.k,adj.k),'${unit==='day'?'YYYY-MM-DD':'YYYY-MM'}') AS key,to_char(COALESCE(pay.k,adj.k),'${unit==='day'?'YYYY-MM-DD':'YYYY-MM'}') AS label,COALESCE(pay.payments,0) AS payments,COALESCE(pay.paid,0) AS "paidCents",COALESCE(pay.discount,0) AS "discountCents",
   COALESCE(pay.new_cents,0) AS "newCents",COALESCE(pay.renewal_cents,0) AS "renewalCents",COALESCE(adj.refunds,0) AS "refundCents",COALESCE(adj.disputes,0) AS "disputeCents" FROM pay FULL JOIN adj ON adj.k=pay.k ORDER BY 1 DESC`,[start,end]);
 const [exams,sittings,coupons,kinds]=await Promise.all([
  grouped('p.exam_id::text',`COALESCE(e.name,'Unknown exam')`,'LEFT JOIN exams e ON e.id=p.exam_id'),
  grouped('p.sitting_id::text',`COALESCE(e.name||' · '||s.label,'Not from a sitting page')`,'LEFT JOIN sittings s ON s.id=p.sitting_id LEFT JOIN exams e ON e.id=s.exam_id'),
  grouped('p.coupon_id::text',`COALESCE(c.code||CASE WHEN c.purpose='win_back' THEN ' (win-back)' WHEN c.purpose='trial_offer' THEN ' (trial offer)' ELSE '' END,'No coupon')`,'LEFT JOIN coupons c ON c.id=p.coupon_id'),
  grouped('p.kind',`CASE p.kind WHEN 'new' THEN 'New subscriptions' WHEN 'renewal' THEN 'Renewals' ELSE 'Other (plan changes)' END`),
 ]);
 // Personal codes are grouped together so the table stays readable.
 const couponRows=coupons.reduce<RevenueGroup[]>((rows,c)=>{const personal=/\((win-back|trial offer)\)$/.exec(c.label);const label=personal?`Personal ${personal[1]} codes`:c.label;const found=rows.find(r=>r.label===label);
  if(found){found.payments+=c.payments;found.paidCents+=c.paidCents;found.discountCents+=c.discountCents;found.refundCents+=c.refundCents;found.disputeCents+=c.disputeCents;}else rows.push({...c,label,key:personal?label:c.key});return rows;},[]);
 const totals=periods.reduce((t,p)=>({payments:t.payments+p.payments,paidCents:t.paidCents+p.paidCents,discountCents:t.discountCents+p.discountCents,newCents:t.newCents+p.newCents,renewalCents:t.renewalCents+p.renewalCents,refundCents:t.refundCents+p.refundCents,disputeCents:t.disputeCents+p.disputeCents}),
  {payments:0,paidCents:0,discountCents:0,newCents:0,renewalCents:0,refundCents:0,disputeCents:0});
 return {from:input.from,to:input.to,group:input.group,totals:{...totals,netCents:totals.paidCents-totals.refundCents-totals.disputeCents},periods,exams,sittings,coupons:couponRows,kinds};
}
// Spreadsheet-safe CSV: quoted fields, and a leading quote on anything a spreadsheet would run as a formula.
export function csvCell(value:unknown) {
 let text=value===null||value===undefined?'':String(value);
 if(/^[=+\-@\t\r]/.test(text))text=`'${text}`;
 return /[",\n\r]/.test(text)?`"${text.replaceAll('"','""')}"`:text;
}
const dollars=(cents:number)=>(cents/100).toFixed(2);
export async function revenueCsv(db:Database,actorId:string,input:{from:string;to:string}) {
 await requireSuperAdmin(db,actorId);
 const [start,end]=range(input.from,input.to);
 const rows=await db.query<{date:string;invoice:string;exam:string|null;months:number|null;sitting:string|null;kind:string;coupon:string|null;amount:number;discount:number;refunded:number;disputed:number;currency:string}>(`SELECT to_char(p.paid_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') AS date,p.stripe_invoice_id AS invoice,e.name AS exam,pl.months,s.label AS sitting,p.kind,c.code AS coupon,p.amount_cents AS amount,p.discount_cents AS discount,
  COALESCE((SELECT sum(a.amount_cents) FROM billing_adjustments a WHERE a.payment_id=p.id AND a.kind='refund'),0)::int AS refunded,COALESCE((SELECT sum(a.amount_cents) FROM billing_adjustments a WHERE a.payment_id=p.id AND a.kind='dispute' AND a.status IS DISTINCT FROM 'won'),0)::int AS disputed,p.currency
  FROM billing_payments p LEFT JOIN exams e ON e.id=p.exam_id LEFT JOIN plans pl ON pl.id=p.plan_id LEFT JOIN sittings s ON s.id=p.sitting_id LEFT JOIN coupons c ON c.id=p.coupon_id WHERE p.paid_at>=$1 AND p.paid_at<$2 ORDER BY p.paid_at`,[start,end]);
 const header=['Paid (UTC)','Stripe invoice','Exam','Plan months','Sitting page','Type','Coupon','Before discount','Discount','Amount paid','Refunded','Disputed','Currency'];
 const lines=rows.map(r=>[r.date,r.invoice,r.exam,r.months,r.sitting,r.kind,r.coupon,dollars(r.amount+r.discount),dollars(r.discount),dollars(r.amount),dollars(r.refunded),dollars(r.disputed),r.currency.toUpperCase()].map(csvCell).join(','));
 await audit(db,actorId,actorId,'revenue.exported',{from:input.from,to:input.to,rows:rows.length});
 return [header.join(','),...lines].join('\r\n')+'\r\n';
}
// Exam page: describe a code carried by a link (?code=) before the student chooses a plan. Checkout checks it again.
export async function couponPreview(db:Database,examId:string,rawCode:string) {
 const code=normaliseCode(rawCode);
 if(!CODE.test(code))return null;
 const [c]=await db.query<{kind:string;percentOff:number|null;amountOffCents:number|null;duration:string;durationMonths:number|null;exam_ids:string[];expires_at:string|null}>(`SELECT kind,percent_off::float AS "percentOff",amount_off_cents AS "amountOffCents",duration,duration_months AS "durationMonths",exam_ids,expires_at::text
  FROM coupons WHERE code=$1 AND active AND stripe_promotion_code_id IS NOT NULL AND (expires_at IS NULL OR expires_at>now())
  AND (max_redemptions IS NULL OR max_redemptions>(SELECT count(*) FROM billing_payments p WHERE p.coupon_id=coupons.id))`,[code]);
 if(!c)return {code,valid:false as const};
 if(c.exam_ids.length&&!c.exam_ids.includes(examId))return {code,valid:false as const};
 return {code,valid:true as const,discount:describeDiscount(c),expiresAt:c.expires_at};
}

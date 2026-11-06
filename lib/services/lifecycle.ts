import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import type {Database} from '../db/client';
import type {StripeGateway} from '../integrations/stripe';
import {issuePersonalCoupon} from './coupons';
// BILL-7 and TRIAL-2: renewal reminders, receipts, payment-failed notices, win-back offers and trial emails.
// Each email is queued once (kind + ref is unique), then sent; failures are retried by the scheduled job.
export type Mailer=(mail:{to:string;subject:string;text:string})=>Promise<void>;
export type OfferSettings={referralPercent:number|null;renewalReminderDays:number;winBackPercent:number|null;winBackAfterDays:number;winBackValidDays:number;trialOfferPercent:number|null;trialOfferHours:number};
// PRD values: reminder 7 days before renewal, 20% win-back 14 days after a plan lapses, trial offer within 48 hours of expiry.
// The win-back code's validity and the trial-offer discount are not in the PRD; the discount stays off until a Super Admin sets it.
export const OFFER_DEFAULTS:OfferSettings={referralPercent:null,renewalReminderDays:7,winBackPercent:20,winBackAfterDays:14,winBackValidDays:14,trialOfferPercent:null,trialOfferHours:48};
const DAY=86400_000,MAX_ATTEMPTS=5;
export async function offerSettings(db:Database):Promise<OfferSettings> {
 const [row]=await db.query<{value:Partial<OfferSettings>}>(`SELECT value FROM app_settings WHERE key='offers'`);
 return {...OFFER_DEFAULTS,...(row?.value??{})};
}
export async function saveOfferSettings(db:Database,actorId:string,input:{winBackPercent:number|null;winBackValidDays:number;trialOfferPercent:number|null;referralPercent?:number|null}) {
 const [actor]=await db.query(`SELECT 1 FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1 AND a.role='super_admin' AND a.status='active' AND u.two_factor_enabled=true`,[actorId]);
 if(!actor)throw new Error('Only a Super Admin can change offers.');
 for(const p of [input.winBackPercent,input.trialOfferPercent,input.referralPercent??null])if(p!==null&&(!Number.isInteger(p)||p<1||p>90))throw new Error('Offer discounts are whole percentages from 1 to 90, or blank for no offer.');
 if(!Number.isInteger(input.winBackValidDays)||input.winBackValidDays<1||input.winBackValidDays>60)throw new Error('A win-back code lasts 1 to 60 days.');
 const value={...(await offerSettings(db)),...input};
 await db.query(`INSERT INTO app_settings(key,value,updated_by) VALUES('offers',$1::jsonb,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`,[JSON.stringify(value),actorId]);
 await db.query('INSERT INTO audit_log(actor_id,entity_id,action,after_json) VALUES($1,$1,$2,$3::jsonb)',[actorId,'offers.updated',JSON.stringify(input)]);
 return value;
}
// ---- Offer emails can be turned off; service emails (receipts, reminders, failed payments, trial ending) cannot ----
function secret() {const s=process.env.BETTER_AUTH_SECRET;if(!s&&process.env.NODE_ENV==='production')throw new Error('BETTER_AUTH_SECRET is required.');return s??'local-development-only';}
export function offersToken(userId:string) {return createHmac('sha256',secret()).update(`offers:${userId}`).digest('base64url');}
export function validOffersToken(userId:string,token:string) {
 const a=Buffer.from(offersToken(userId)),b=Buffer.from(token);return /^[0-9a-f-]{36}$/i.test(userId)&&a.length===b.length&&timingSafeEqual(a,b);
}
export async function setMarketingEmails(db:Database,userId:string,on:boolean) {
 await db.query(`INSERT INTO student_profiles(user_id,marketing_emails) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET marketing_emails=EXCLUDED.marketing_emails,updated_at=now()`,[userId,on]);
}
export async function marketingEmails(db:Database,userId:string) {
 const [row]=await db.query<{on:boolean}>('SELECT marketing_emails AS on FROM student_profiles WHERE user_id=$1',[userId]);return row?.on??true;
}

// ---- Queue: decide which emails are due ----
const MARKETING=`COALESCE((SELECT p.marketing_emails FROM student_profiles p WHERE p.user_id=%s),true)`;
const ACTIVE_USER=(col:string)=>`EXISTS(SELECT 1 FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=${col} AND a.status='active' AND u.email_verified)`;
const HAS_ACCESS=(user:string,exam:string)=>`EXISTS(SELECT 1 FROM entitlements n WHERE n.user_id=${user} AND n.exam_id=${exam} AND n.source IN ('subscription','partner','complimentary') AND n.revoked_at IS NULL AND n.ends_at>now())`;
export async function queueLifecycleEmails(db:Database,gateway:StripeGateway|null,now=new Date()) {
 const s=await offerSettings(db),at=now.toISOString();let queued=0;
 const add=async(rows:{kind:string;user_id:string;ref:string;coupon_id?:string|null}[])=>{for(const r of rows){const ins=await db.query('INSERT INTO lifecycle_emails(kind,user_id,ref,coupon_id) VALUES($1,$2,$3,$4) ON CONFLICT(kind,ref) DO NOTHING RETURNING id',[r.kind,r.user_id,r.ref,r.coupon_id??null]);queued+=ins.length;}};
 // Renewal reminder: auto-renew on, renewing within the reminder window. One per billing period.
 await add(await db.query(`SELECT 'renewal_reminder' AS kind,s.user_id,s.id||':'||to_char(s.current_period_end,'YYYY-MM-DD') AS ref FROM subscriptions s
  WHERE s.status='active' AND NOT s.cancel_at_period_end AND s.access_hold IS NULL AND s.current_period_end>$1::timestamptz AND s.current_period_end<=$1::timestamptz+make_interval(days=>$2) AND ${ACTIVE_USER('s.user_id')}`,[at,s.renewalReminderDays]));
 // Receipt for each paid invoice. Only recent ones, so turning this on never emails old payments.
 await add(await db.query(`SELECT 'receipt' AS kind,p.user_id,p.stripe_invoice_id AS ref FROM billing_payments p WHERE p.amount_cents>0 AND p.user_id IS NOT NULL AND p.paid_at>$1::timestamptz-interval '3 days' AND ${ACTIVE_USER('p.user_id')}`,[at]));
 // Payment failed: once per billing period while in the grace window.
 await add(await db.query(`SELECT 'payment_failed' AS kind,s.user_id,s.id||':'||to_char(s.current_period_end,'YYYY-MM-DD') AS ref FROM subscriptions s
  WHERE s.status='past_due' AND s.grace_until>$1::timestamptz AND s.access_hold IS NULL AND ${ACTIVE_USER('s.user_id')}`,[at]));
 // Trial emails on day 2 and day 3, while the trial is still running and nothing has been bought.
 for(const [kind,day] of [['trial_day2',1],['trial_day3',2]] as const)
  await add(await db.query(`SELECT $3 AS kind,t.user_id,t.user_id||':'||t.exam_id AS ref FROM trials t WHERE t.started_at<=$1::timestamptz-make_interval(days=>$2) AND t.ends_at>$1::timestamptz
   AND NOT ${HAS_ACCESS('t.user_id','t.exam_id')} AND ${ACTIVE_USER('t.user_id')}`,[at,day,kind]));
 // Offers need Stripe (the code is created there) and the student's agreement to receive offers.
 if(gateway){
  if(s.winBackPercent){
   // Lapsed 14 to 21 days ago (the week's window stops a first run emailing everyone who ever lapsed); refunds and disputes excluded.
   const lapsed=await db.query<{user_id:string;exam_id:string;ref:string;name:string}>(`SELECT DISTINCT ON (s.user_id,s.exam_id) s.user_id,s.exam_id,s.user_id||':'||s.exam_id AS ref,e.name FROM subscriptions s JOIN entitlements n ON n.id=s.entitlement_id JOIN exams e ON e.id=s.exam_id
    WHERE s.access_hold IS NULL AND n.ends_at<=$1::timestamptz-make_interval(days=>$2) AND n.ends_at>$1::timestamptz-make_interval(days=>$2+7) AND NOT ${HAS_ACCESS('s.user_id','s.exam_id')}
    AND NOT EXISTS(SELECT 1 FROM subscriptions o WHERE o.user_id=s.user_id AND o.exam_id=s.exam_id AND o.status IN ('active','trialing','past_due'))
    AND NOT EXISTS(SELECT 1 FROM lifecycle_emails l WHERE l.kind='win_back' AND l.ref=s.user_id||':'||s.exam_id) AND ${MARKETING.replace('%s','s.user_id')} AND ${ACTIVE_USER('s.user_id')} ORDER BY s.user_id,s.exam_id,n.ends_at DESC`,[at,s.winBackAfterDays]);
   for(const l of lapsed){const c=await issuePersonalCoupon(db,gateway,{userId:l.user_id,examId:l.exam_id,purpose:'win_back',percentOff:s.winBackPercent,validDays:s.winBackValidDays,name:`Win-back ${s.winBackPercent}% · ${l.name}`}).catch(()=>null);
    if(c?.synced)await add([{kind:'win_back',user_id:l.user_id,ref:l.ref,coupon_id:c.id}]);}
  }
  if(s.trialOfferPercent){
   // Trial offer: in the last 48 hours of the trial, valid until 48 hours after it ends.
   const ending=await db.query<{user_id:string;exam_id:string;ref:string;ends_at:string;name:string}>(`SELECT t.user_id,t.exam_id,t.user_id||':'||t.exam_id AS ref,t.ends_at::text,e.name FROM trials t JOIN exams e ON e.id=t.exam_id
    WHERE t.ends_at>$1::timestamptz AND t.ends_at<=$1::timestamptz+make_interval(hours=>$2) AND NOT ${HAS_ACCESS('t.user_id','t.exam_id')}
    AND NOT EXISTS(SELECT 1 FROM lifecycle_emails l WHERE l.kind='trial_offer' AND l.ref=t.user_id||':'||t.exam_id) AND ${MARKETING.replace('%s','t.user_id')} AND ${ACTIVE_USER('t.user_id')}`,[at,s.trialOfferHours]);
   for(const t of ending){const valid=Math.max(1,Math.ceil((Date.parse(t.ends_at)+s.trialOfferHours*3600_000-now.getTime())/DAY));
    const c=await issuePersonalCoupon(db,gateway,{userId:t.user_id,examId:t.exam_id,purpose:'trial_offer',percentOff:s.trialOfferPercent,validDays:valid,name:`Trial offer ${s.trialOfferPercent}% · ${t.name}`}).catch(()=>null);
    if(c?.synced)await add([{kind:'trial_offer',user_id:t.user_id,ref:t.ref,coupon_id:c.id}]);}
  }
 }
 return queued;
}

// ---- Send: write each email from current data, so a stale one is skipped rather than sent ----
const usd=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const date=(v:string)=>new Date(v).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
type Draft={subject:string;text:string}|null;
async function draft(db:Database,row:{kind:string;user_id:string;ref:string;coupon_id:string|null},site:string,name:string):Promise<Draft> {
 const hi=`Hello ${name.split(/\s+/)[0]||'there'},`,sign='\n\nRecalls Tutor';
 const offersFooter=`\n\nYou get offers like this because you studied with Recalls Tutor. To stop offer emails: ${site}/email/offers?u=${row.user_id}&t=${offersToken(row.user_id)}`;
 if(row.kind==='renewal_reminder'||row.kind==='payment_failed'){
  const [s]=await db.query<{exam:string;months:number;price:number;end:string;status:string;renews:boolean;grace:string|null}>(`SELECT e.name AS exam,p.months,p.price_cents AS price,s.current_period_end::text AS end,s.status,NOT s.cancel_at_period_end AS renews,s.grace_until::text AS grace FROM subscriptions s JOIN exams e ON e.id=s.exam_id JOIN plans p ON p.id=s.plan_id WHERE s.id=$1`,[row.ref.split(':')[0]]);
  if(!s)return null;
  if(row.kind==='renewal_reminder'){if(s.status!=='active'||!s.renews)return null;
   return {subject:`Your ${s.exam} plan renews on ${date(s.end)}`,text:`${hi}\n\nYour ${s.months}-month ${s.exam} plan renews automatically on ${date(s.end)} for ${usd(s.price)}. You don't need to do anything to keep practising.\n\nTo turn off auto-renew or update your card, go to My plans: ${site}/account/plans\nYou keep access until the end of the period you have paid for.${sign}`};}
  if(s.status!=='past_due')return null;
  return {subject:`We couldn't take your ${s.exam} renewal payment`,text:`${hi}\n\nYour ${s.exam} renewal payment didn't go through. Your access continues until ${s.grace?date(s.grace):'the end of the grace period'} while the payment is retried.\n\nUpdate your card under "Manage billing and invoices" in My plans to keep access: ${site}/account/plans\nAll your progress is kept.${sign}`};
 }
 if(row.kind==='receipt'){
  const [p]=await db.query<{exam:string|null;months:number|null;amount:number;discount:number;paid:string;kind:string;code:string|null}>(`SELECT e.name AS exam,pl.months,p.amount_cents AS amount,p.discount_cents AS discount,p.paid_at::text AS paid,p.kind,c.code FROM billing_payments p LEFT JOIN exams e ON e.id=p.exam_id LEFT JOIN plans pl ON pl.id=p.plan_id LEFT JOIN coupons c ON c.id=p.coupon_id WHERE p.stripe_invoice_id=$1`,[row.ref]);
  if(!p)return null;
  return {subject:`Receipt: ${p.exam??'Recalls Tutor'} ${p.kind==='renewal'?'renewal':'plan'}`,text:`${hi}\n\nThank you. We received ${usd(p.amount)} on ${date(p.paid)} for your ${p.months?`${p.months}-month `:''}${p.exam??''} plan${p.kind==='renewal'?' renewal':''}.${p.discount>0?`\nDiscount${p.code?` (${p.code})`:''}: ${usd(p.discount)}.`:''}\n\nYour invoices are under "Manage billing and invoices" in My plans: ${site}/account/plans\nRefund policy: ${site}/refund-policy${sign}`};
 }
 if(row.kind==='trial_day2'||row.kind==='trial_day3'){
  const [userId,examId]=row.ref.split(':');
  const [t]=await db.query<{exam:string;ends:string;seo:string;family:string;has:boolean}>(`SELECT e.name AS exam,t.ends_at::text AS ends,e.seo_slug AS seo,f.slug AS family,${HAS_ACCESS('t.user_id','t.exam_id')} AS has FROM trials t JOIN exams e ON e.id=t.exam_id JOIN exam_families f ON f.id=e.family_id WHERE t.user_id=$1 AND t.exam_id=$2`,[userId,examId]);
  if(!t||t.has||Date.parse(t.ends)<=Date.now())return null;
  const plans=`${site}/${t.family}/${t.seo}#plans`;
  return row.kind==='trial_day2'
   ?{subject:`Your ${t.exam} trial ends ${date(t.ends)}`,text:`${hi}\n\nYour free ${t.exam} trial ends on ${date(t.ends)}. Keep going while you can: ${site}/practice\n\nIf you'd like to carry on afterwards, choose a plan and all your progress comes with you: ${plans}${sign}`}
   :{subject:`Last day of your ${t.exam} trial`,text:`${hi}\n\nYour free ${t.exam} trial ends ${date(t.ends)}. Your answers, notes and mistakes deck are kept, so choosing a plan picks up exactly where you left off: ${plans}${sign}`};
 }
 if(row.kind==='win_back'||row.kind==='trial_offer'||row.kind==='referral_reward'){
  const [c]=await db.query<{code:string;percent:number;expires:string;active:boolean;used:boolean;exam:string;seo:string;family:string;exam_id:string}>(`SELECT c.code,c.percent_off::float AS percent,c.expires_at::text AS expires,c.active,EXISTS(SELECT 1 FROM billing_payments p WHERE p.coupon_id=c.id) AS used,e.name AS exam,e.seo_slug AS seo,f.slug AS family,e.id AS exam_id
   FROM coupons c JOIN exams e ON e.id=c.exam_ids[1] JOIN exam_families f ON f.id=e.family_id WHERE c.id=$1`,[row.coupon_id]);
  if(!c||!c.active||c.used||Date.parse(c.expires)<=Date.now()||!(await marketingEmails(db,row.user_id)))return null;
  if(row.kind!=='referral_reward'&&(await db.query(`SELECT 1 WHERE ${HAS_ACCESS('$1::uuid','$2::uuid')}`,[row.user_id,c.exam_id])).length)return null;
  const link=`${site}/${c.family}/${c.seo}?code=${c.code}#plans`;
  if(row.kind==='referral_reward')return {subject:`A friend joined: ${c.percent}% off ${c.exam} for you`,text:`${hi}\n\nA friend you invited has started a plan. Thank you. Here is ${c.percent}% off your next ${c.exam} payment.\n\nYour code: ${c.code}\nIt works once, on your account, until ${date(c.expires)}.\nUse it here: ${link}${sign}${offersFooter}`};
  return row.kind==='win_back'
   ?{subject:`${c.percent}% off to come back to ${c.exam}`,text:`${hi}\n\nYour ${c.exam} plan has ended, but your progress is still here. If you'd like to pick up where you left off, here is ${c.percent}% off your first payment.\n\nYour code: ${c.code}\nIt works once, on your account, until ${date(c.expires)}.\nChoose a plan with the code applied: ${link}${sign}${offersFooter}`}
   :{subject:`${c.percent}% off ${c.exam} after your trial`,text:`${hi}\n\nYour free ${c.exam} trial is nearly over. If you want to keep practising, here is ${c.percent}% off your first payment, for trial students only.\n\nYour code: ${c.code}\nIt works once, on your account, until ${date(c.expires)}.\nChoose a plan with the code applied: ${link}${sign}${offersFooter}`};
 }
 return null;
}
export async function sendLifecycleEmails(db:Database,mailer:Mailer,site:string,limit=100) {
 const rows=await db.query<{id:string;kind:string;user_id:string;ref:string;coupon_id:string|null;email:string;name:string}>(`SELECT l.id,l.kind,l.user_id,l.ref,l.coupon_id,u.email,u.name FROM lifecycle_emails l JOIN app_users a ON a.id=l.user_id JOIN auth_users u ON u.id=a.auth_id
  WHERE l.sent_at IS NULL AND l.attempts<$1 AND l.created_at>now()-interval '7 days' ORDER BY l.created_at LIMIT $2`,[MAX_ATTEMPTS,limit]);
 let sent=0,skipped=0,failed=0;
 for(const r of rows){
  // Claim the row first so two runs at once never send the same email twice.
  const [claim]=await db.query('UPDATE lifecycle_emails SET attempts=attempts+1 WHERE id=$1 AND sent_at IS NULL AND attempts<$2 RETURNING id',[r.id,MAX_ATTEMPTS]);
  if(!claim)continue;
  try {
   const mail=await draft(db,r,site,r.name);
   if(!mail){await db.query(`UPDATE lifecycle_emails SET sent_at=now(),last_error='skipped: no longer applies' WHERE id=$1`,[r.id]);skipped++;continue;}
   await mailer({to:r.email,...mail});
   await db.query('UPDATE lifecycle_emails SET sent_at=now(),last_error=NULL WHERE id=$1',[r.id]);sent++;
  } catch(error) {
   failed++;await db.query('UPDATE lifecycle_emails SET last_error=$2 WHERE id=$1',[r.id,(error instanceof Error?error.message:'failed').slice(0,300)]);
  }
 }
 return {sent,skipped,failed};
}
export async function runLifecycle(db:Database,gateway:StripeGateway|null,mailer:Mailer,site:string) {
 const queued=await queueLifecycleEmails(db,gateway);
 return {queued,...(await sendLifecycleEmails(db,mailer,site))};
}
// Studio: what went out recently.
export async function lifecycleSummary(db:Database) {
 return db.query<{kind:string;sent:number;skipped:number;waiting:number;failing:number}>(`SELECT kind,count(*) FILTER (WHERE sent_at IS NOT NULL AND last_error IS NULL)::int AS sent,count(*) FILTER (WHERE last_error LIKE 'skipped%')::int AS skipped,
  count(*) FILTER (WHERE sent_at IS NULL AND attempts<${MAX_ATTEMPTS})::int AS waiting,count(*) FILTER (WHERE sent_at IS NULL AND attempts>=${MAX_ATTEMPTS})::int AS failing FROM lifecycle_emails WHERE created_at>now()-interval '30 days' GROUP BY kind ORDER BY kind`);
}

// ---- TRIAL-2: one trial per exam per device ----
export const hashSignal=(value:string)=>createHash('sha256').update(`${secret()}:${value}`).digest('hex');

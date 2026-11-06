import {createHash,randomBytes} from 'node:crypto';
import {isIP} from 'node:net';
import type {Database} from '../db/client';
import {requireId} from './studio';
import {enqueueWebhook,newWebhookSecret,validWebhookUrl,WEBHOOK_EVENTS,type Mode,type WebhookEvent} from './partner-webhooks';
// PART-2/3/4: partner seats and enrolments. Everything here is scoped to one organisation; the portal and the /v1
// API call the same functions, so a seat assigned by hand and one assigned by a course checkout behave alike.
export class PartnerError extends Error {
 constructor(message:string,readonly reason:string,readonly status=400,readonly detail?:Record<string,unknown>) {super(message);}
}
export type Mailer=(mail:{to:string;subject:string;text:string})=>Promise<void>;
export type Org={id:string;name:string;status:string;billing:'prepaid'|'postpaid';credit_limit_seats:number|null;low_balance_at:number};
export const TEST_SEATS=25;
const ACCESS_SOURCES=`('subscription','partner','complimentary')`;
// A seat in a pack is used unless its enrolment was revoked before activation (that seat goes back to the balance).
const PACK_USED=`((SELECT count(*) FROM partner_enrollments pe WHERE pe.seat_pack_id=sp.id AND NOT (pe.status='revoked' AND pe.activated_at IS NULL))+(SELECT count(*) FROM partner_extensions x WHERE x.seat_pack_id=sp.id))::int`;
export const productId=(slug:string,months:number)=>`${slug}-${months}m`;
export function parseProduct(value:unknown) {const m=typeof value==='string'?/^([a-z0-9][a-z0-9-]*)-(3|6|12)m$/.exec(value):null;return m?{slug:m[1],months:Number(m[2])}:null;}
const iso=(v:unknown)=>v==null?null:new Date(v as string).toISOString();
const sha256=(v:string)=>createHash('sha256').update(v).digest('hex');
export function normaliseEmail(value:unknown) {
 const email=typeof value==='string'?value.trim().toLowerCase():'';
 if(email.length>254||!/^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[a-z]{2,}$/.test(email))throw new PartnerError(`${typeof value==='string'&&value.trim()?`"${value.trim().slice(0,80)}" is`:'This is'} not a valid email address.`,'invalid_email',422);
 return email;
}
async function audit(db:Database,actorId:string|null|undefined,entityId:string,action:string,after:unknown) {
 if(actorId)await db.query('INSERT INTO audit_log(actor_id,entity_id,action,after_json) VALUES($1,$2,$3,$4::jsonb)',[actorId,entityId,action,JSON.stringify(after)]);
}
// ---------------------------------------------------------------- access to an organisation
export type Membership={id:string;name:string;status:string;billing:'prepaid'|'postpaid';mfa:boolean};
export async function partnerMemberships(db:Database,actorId:string) {
 return db.query<{id:string;name:string;status:string}>(`SELECT o.id,o.name,o.status FROM organisation_members m JOIN organisations o ON o.id=m.organisation_id WHERE m.user_id=$1 ORDER BY o.name`,[actorId]);
}
export async function requirePartnerAdmin(db:Database,actorId:string,orgId:string,opts:{write?:boolean;mfa?:boolean}={}):Promise<Membership> {
 requireId(orgId);
 const [m]=await db.query<Membership>(`SELECT o.id,o.name,o.status,o.billing,u.two_factor_enabled AS mfa FROM organisation_members m JOIN organisations o ON o.id=m.organisation_id JOIN app_users a ON a.id=m.user_id JOIN auth_users u ON u.id=a.auth_id
  WHERE m.organisation_id=$1 AND m.user_id=$2 AND a.status='active' AND u.email_verified`,[orgId,actorId]);
 if(!m)throw new Error('You are not a partner admin for this organisation.');
 if(opts.write&&m.status!=='active')throw new Error(m.status==='pending'?'Your partner account is waiting for approval. You can assign seats once Recalls Tutor approves it.':'Your partner account is suspended. Contact Recalls Tutor.');
 if(opts.mfa&&!m.mfa)throw new Error('Turn on two-step sign-in in Account security before managing API keys and webhooks.');
 return m;
}
// Sandbox requests also work while a partner is pending approval, so it can build its integration first.
async function lockOrg(tx:Database,orgId:string,sandbox=false):Promise<Org> {
 const [org]=await tx.query<Org>('SELECT id,name,status,billing,credit_limit_seats,low_balance_at FROM organisations WHERE id=$1 FOR UPDATE',[orgId]);
 if(!org)throw new PartnerError('Partner not found.','not_found',404);
 if(org.status!=='active'&&!(sandbox&&org.status==='pending'))throw new PartnerError('This partner account is not active.','partner_inactive',403);
 return org;
}
// ---------------------------------------------------------------- products and seats
export type Product={product:string;examId:string;examSlug:string;exam:string;months:number;seatPriceCents:number|null;live:boolean};
export async function listProducts(db:Database,orgId:string):Promise<Product[]> {
 const rows=await db.query<{exam_id:string;slug:string;name:string;months:number;price:number|null;live:boolean}>(`SELECT p.exam_id,e.slug,e.name,p.months,p.seat_price_cents AS price,e.launch_status='live' AS live FROM partner_products p JOIN exams e ON e.id=p.exam_id WHERE p.organisation_id=$1 ORDER BY e.name,p.months`,[orgId]);
 return rows.map(r=>({product:productId(r.slug,r.months),examId:r.exam_id,examSlug:r.slug,exam:r.name,months:r.months,seatPriceCents:r.price,live:r.live}));
}
async function requireProduct(db:Database,orgId:string,examId:string,months:number) {
 if(!(await db.query('SELECT 1 FROM partner_products WHERE organisation_id=$1 AND exam_id=$2 AND months=$3',[orgId,examId,months])).length)
  throw new PartnerError('This product is not available to your account. Ask Recalls Tutor to add it.','product_not_allowed',422);
}
export async function resolveProduct(db:Database,orgId:string,value:unknown) {
 const parsed=parseProduct(value);
 if(!parsed)throw new PartnerError('Give a product such as "mrcog-part-1-6m". GET /v1/products lists yours.','invalid_product',422);
 const [exam]=await db.query<{id:string}>('SELECT id FROM exams WHERE slug=$1',[parsed.slug]);
 if(!exam)throw new PartnerError('This product is not available to your account.','product_not_allowed',422);
 await requireProduct(db,orgId,exam.id,parsed.months);
 return {examId:exam.id,months:parsed.months};
}
async function sandboxUsed(db:Database,orgId:string,examId:string,months:number) {
 const [{n}]=await db.query<{n:number}>(`SELECT ((SELECT count(*) FROM partner_enrollments WHERE organisation_id=$1 AND exam_id=$2 AND months=$3 AND sandbox AND status<>'revoked')
  +(SELECT count(*) FROM partner_extensions x JOIN partner_enrollments pe ON pe.id=x.enrollment_id WHERE pe.organisation_id=$1 AND pe.exam_id=$2 AND x.months=$3 AND pe.sandbox AND pe.status<>'revoked'))::int AS n`,[orgId,examId,months]);
 return n;
}
async function remaining(db:Database,orgId:string,examId:string,months:number) {
 const [{n}]=await db.query<{n:number}>(`SELECT COALESCE(sum(sp.seats-${PACK_USED}),0)::int AS n FROM seat_packs sp WHERE sp.organisation_id=$1 AND sp.exam_id=$2 AND sp.months=$3 AND sp.expires_at>now()`,[orgId,examId,months]);
 return n;
}
async function postpaidUsedThisMonth(db:Database,orgId:string) {
 const [{n}]=await db.query<{n:number}>(`SELECT ((SELECT count(*) FROM partner_enrollments WHERE organisation_id=$1 AND NOT sandbox AND seat_pack_id IS NULL AND created_at>=date_trunc('month',now()) AND NOT (status='revoked' AND activated_at IS NULL))
  +(SELECT count(*) FROM partner_extensions x JOIN partner_enrollments pe ON pe.id=x.enrollment_id WHERE pe.organisation_id=$1 AND NOT pe.sandbox AND x.seat_pack_id IS NULL AND x.created_at>=date_trunc('month',now())))::int AS n`,[orgId]);
 return n;
}
// Takes one seat and returns the pack it came from (null for postpaid and sandbox). Prepaid seats come from the
// pack that expires first, so rolled-over seats are used before newer ones.
async function takeSeat(tx:Database,org:Org,examId:string,months:number,sandbox:boolean):Promise<string|null> {
 if(sandbox) {
  if(await sandboxUsed(tx,org.id,examId,months)>=TEST_SEATS)throw new PartnerError(`All ${TEST_SEATS} test seats for this product are in use. Revoke some sandbox enrolments to free them.`,'no_seats',402);
  return null;
 }
 if(org.billing==='postpaid') {
  if(org.credit_limit_seats!==null&&await postpaidUsedThisMonth(tx,org.id)>=org.credit_limit_seats)throw new PartnerError(`You have reached this month's limit of ${org.credit_limit_seats} seats. Contact Recalls Tutor to raise it.`,'credit_limit',402);
  return null;
 }
 const [pack]=await tx.query<{id:string}>(`SELECT sp.id FROM seat_packs sp WHERE sp.organisation_id=$1 AND sp.exam_id=$2 AND sp.months=$3 AND sp.expires_at>now() AND sp.seats>${PACK_USED} ORDER BY sp.expires_at,sp.purchased_at LIMIT 1`,[org.id,examId,months]);
 if(!pack)throw new PartnerError('No seats are left for this product. Buy a seat pack to assign more.','no_seats',402);
 return pack.id;
}
// seats.low_balance fires once, at the moment the balance reaches the partner's threshold.
async function checkLowBalance(tx:Database,org:Org,examId:string,months:number,sandbox:boolean) {
 if(!sandbox&&org.billing!=='prepaid')return;
 const left=sandbox?TEST_SEATS-await sandboxUsed(tx,org.id,examId,months):await remaining(tx,org.id,examId,months);
 if(left!==org.low_balance_at)return;
 const [exam]=await tx.query<{slug:string;name:string}>('SELECT slug,name FROM exams WHERE id=$1',[examId]);
 await enqueueWebhook(tx,org.id,sandbox?'test':'live','seats.low_balance',{product:productId(exam.slug,months),remaining:left,threshold:org.low_balance_at});
 if(!sandbox)await tx.query(`INSERT INTO partner_alerts(organisation_id,kind,exam_id,months,message) VALUES($1,'low_balance',$2,$3,$4)`,[org.id,examId,months,`${left} ${left===1?'seat is':'seats are'} left for ${exam.name} (${months} months).`]);
}
export type SeatBalance={product:string;exam:string;months:number;available:number|null;assigned:number;activated:number;packs:{id:string;seats:number;remaining:number;expiresAt:string;purchasedAt:string}[]};
export async function seatBalances(db:Database,orgId:string,sandbox:boolean) {
 const [org]=await db.query<Org>('SELECT id,name,status,billing,credit_limit_seats,low_balance_at FROM organisations WHERE id=$1',[orgId]);
 const products=await listProducts(db,orgId),balances:SeatBalance[]=[];
 for(const p of products) {
  const [counts]=await db.query<{assigned:number;activated:number}>(`SELECT count(*) FILTER (WHERE status<>'revoked')::int AS assigned,count(*) FILTER (WHERE activated_at IS NOT NULL)::int AS activated FROM partner_enrollments WHERE organisation_id=$1 AND exam_id=$2 AND months=$3 AND sandbox=$4`,[orgId,p.examId,p.months,sandbox]);
  const packs=sandbox||org.billing==='postpaid'?[]:await db.query<{id:string;seats:number;remaining:number;expiresAt:string;purchasedAt:string}>(`SELECT sp.id,sp.seats,(sp.seats-${PACK_USED}) AS remaining,sp.expires_at AS "expiresAt",sp.purchased_at AS "purchasedAt" FROM seat_packs sp WHERE sp.organisation_id=$1 AND sp.exam_id=$2 AND sp.months=$3 AND sp.expires_at>now() ORDER BY sp.expires_at`,[orgId,p.examId,p.months]);
  const available=sandbox?TEST_SEATS-await sandboxUsed(db,orgId,p.examId,p.months):org.billing==='postpaid'?null:packs.reduce((s,k)=>s+k.remaining,0);
  balances.push({product:p.product,exam:p.exam,months:p.months,available,...counts,packs:packs.map(k=>({...k,expiresAt:iso(k.expiresAt)!,purchasedAt:iso(k.purchasedAt)!}))});
 }
 const credit=org.billing==='postpaid'&&!sandbox?{limit:org.credit_limit_seats,usedThisMonth:await postpaidUsedThisMonth(db,orgId)}:null;
 return {billing:sandbox?'sandbox':org.billing,lowBalanceAt:org.low_balance_at,credit,balances};
}
// ---------------------------------------------------------------- enrolments
export type Enrollment={id:string;object:'enrollment';email:string;product:string;exam:{slug:string;name:string};months:number;status:'invited'|'active'|'expired'|'revoked';
 sandbox:boolean;source:string;external_ref:string|null;created_at:string;activated_at:string|null;access_ends_at:string|null;revoked_at:string|null};
const ENROLLMENT_SELECT=`SELECT pe.id,pe.email,e.slug,e.name AS exam,pe.months,pe.sandbox,pe.source,pe.external_ref,pe.status,(pe.status='active' AND pe.ends_at<=now()) AS expired,pe.created_at,pe.activated_at,pe.ends_at,pe.revoked_at,pe.organisation_id,pe.user_id FROM partner_enrollments pe JOIN exams e ON e.id=pe.exam_id`;
type EnrollmentRow={id:string;email:string;slug:string;exam:string;months:number;sandbox:boolean;source:string;external_ref:string|null;status:'invited'|'active'|'revoked';expired:boolean;created_at:string;activated_at:string|null;ends_at:string|null;revoked_at:string|null;organisation_id:string;user_id:string|null};
const toEnrollment=(r:EnrollmentRow):Enrollment=>({id:r.id,object:'enrollment',email:r.email,product:productId(r.slug,r.months),exam:{slug:r.slug,name:r.exam},months:r.months,status:r.expired?'expired':r.status,sandbox:r.sandbox,source:r.source,external_ref:r.external_ref,
 created_at:iso(r.created_at)!,activated_at:iso(r.activated_at),access_ends_at:iso(r.ends_at),revoked_at:iso(r.revoked_at)});
async function loadEnrollment(db:Database,orgId:string,sandbox:boolean,id:string,lock=false) {
 if(!/^[0-9a-f-]{36}$/i.test(id))return null;
 const [row]=await db.query<EnrollmentRow>(`${ENROLLMENT_SELECT} WHERE pe.id=$1 AND pe.organisation_id=$2 AND pe.sandbox=$3${lock?' FOR UPDATE OF pe':''}`,[id,orgId,sandbox]);
 return row??null;
}
export async function getEnrollment(db:Database,orgId:string,sandbox:boolean,id:string) {const row=await loadEnrollment(db,orgId,sandbox,id);return row?toEnrollment(row):null;}
async function notFound():Promise<never> {throw new PartnerError('Enrolment not found.','not_found',404);}
async function announce(tx:Database,id:string,event:WebhookEvent) {
 const [row]=await tx.query<EnrollmentRow>(`${ENROLLMENT_SELECT} WHERE pe.id=$1`,[id]);
 await enqueueWebhook(tx,row.organisation_id,row.sandbox?'test':'live',event,{enrollment:toEnrollment(row)});
}
// Activation writes the 'partner' entitlement. It starts now and its months are added after any access the
// student already has for this exam, so a seat never overlaps a paid plan.
async function activate(tx:Database,enrollmentId:string,userId:string) {
 const [e]=await tx.query<{organisation_id:string;exam_id:string;months:number}>(`SELECT organisation_id,exam_id,months FROM partner_enrollments WHERE id=$1 AND status='invited'`,[enrollmentId]);
 if(!e)return;
 const [{from}]=await tx.query<{from:string}>(`SELECT GREATEST(now(),COALESCE(max(ends_at),now())) AS from FROM entitlements WHERE user_id=$1 AND exam_id=$2 AND source IN ${ACCESS_SOURCES} AND revoked_at IS NULL`,[userId,e.exam_id]);
 const [n]=await tx.query<{id:string;ends_at:string}>(`INSERT INTO entitlements(user_id,exam_id,organisation_id,source,starts_at,ends_at) VALUES($1,$2,$3,'partner',now(),$4::timestamptz+make_interval(months=>$5)) RETURNING id,ends_at`,[userId,e.exam_id,e.organisation_id,from,e.months]);
 await tx.query(`UPDATE partner_enrollments SET status='active',user_id=$2,entitlement_id=$3,activated_at=now(),ends_at=$4 WHERE id=$1`,[enrollmentId,userId,n.id,n.ends_at]);
 await announce(tx,enrollmentId,'enrollment.activated');
}
export type AssignInput={examId:string;months:number;email:string;source:'portal'|'csv'|'link'|'api';sandbox?:boolean;externalRef?:string|null;createdBy?:string|null;linkId?:string|null};
async function assign(tx:Database,org:Org,input:AssignInput) {
 const email=normaliseEmail(input.email),sandbox=input.sandbox===true;
 const externalRef=typeof input.externalRef==='string'&&input.externalRef.trim()?input.externalRef.trim():null;
 if(externalRef&&externalRef.length>200)throw new PartnerError('external_ref can be up to 200 characters.','invalid_request',422);
 await requireProduct(tx,org.id,input.examId,input.months);
 const [dup]=await tx.query<{id:string}>(`SELECT id FROM partner_enrollments WHERE organisation_id=$1 AND exam_id=$2 AND email=$3 AND sandbox=$4 AND (status='invited' OR (status='active' AND ends_at>now())) LIMIT 1`,[org.id,input.examId,email,sandbox]);
 if(dup)throw new PartnerError(`${email} already has a seat for this exam. Extend it instead.`,'already_enrolled',409,{enrollment_id:dup.id});
 const pack=await takeSeat(tx,org,input.examId,input.months,sandbox);
 const [row]=await tx.query<{id:string}>(`INSERT INTO partner_enrollments(organisation_id,exam_id,months,email,sandbox,source,external_ref,seat_pack_id,link_id,created_by,invite_sent_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $5 OR $6='link' THEN now() END) RETURNING id`,[org.id,input.examId,input.months,email,sandbox,input.source,externalRef,pack,input.linkId??null,input.createdBy??null]);
 if(sandbox) {
  await tx.query(`UPDATE partner_enrollments SET status='active',activated_at=now(),ends_at=now()+make_interval(months=>months) WHERE id=$1`,[row.id]);
  await announce(tx,row.id,'enrollment.activated');
 } else {
  // An existing verified account gets access at once; otherwise the seat waits for a sign-up with this email.
  const [user]=await tx.query<{id:string}>(`SELECT a.id FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE lower(u.email)=$1 AND a.status='active' AND u.email_verified LIMIT 1`,[email]);
  if(user)await activate(tx,row.id,user.id);
 }
 await checkLowBalance(tx,org,input.examId,input.months,sandbox);
 return row.id;
}
export async function createEnrollment(db:Database,orgId:string,input:AssignInput):Promise<Enrollment> {
 return db.transaction(async tx=>{const org=await lockOrg(tx,orgId,input.sandbox===true);const id=await assign(tx,org,input);await audit(tx,input.createdBy,id,'partner.seat_assigned',{organisationId:orgId,source:input.source,sandbox:input.sandbox===true});return toEnrollment((await loadEnrollment(tx,orgId,input.sandbox===true,id))!);});
}
export const MAX_BULK=500;
// PART-3 CSV: one email per line (the first column is used). Seats are checked for the whole file first, so a
// file is either assigned in full or refused with how many seats are missing.
export function parseEmailList(text:string) {
 const out:string[]=[],seen=new Set<string>();
 for(const line of text.split(/\r?\n/)) {
  const cell=line.split(/[,;\t]/)[0]?.trim().replace(/^"|"$/g,'')??'';
  if(!cell||/^e-?mail/i.test(cell))continue;
  const key=cell.toLowerCase();if(seen.has(key))continue;seen.add(key);out.push(cell);
 }
 return out;
}
export type BulkResult={email:string;ok:boolean;status?:string;message?:string};
export async function assignMany(db:Database,actorId:string,orgId:string,input:{examId:string;months:number;emails:string[];source:'portal'|'csv'}) {
 await requirePartnerAdmin(db,actorId,orgId,{write:true});
 requireId(input.examId);
 if(!input.emails.length)throw new Error('Add at least one email address.');
 if(input.emails.length>MAX_BULK)throw new Error(`Assign up to ${MAX_BULK} students at a time.`);
 return db.transaction(async tx=>{
  const org=await lockOrg(tx,orgId);
  await requireProduct(tx,orgId,input.examId,input.months);
  const valid:string[]=[],results:BulkResult[]=[];
  for(const raw of input.emails) {
   try {
    const email=normaliseEmail(raw);
    if((await tx.query(`SELECT 1 FROM partner_enrollments WHERE organisation_id=$1 AND exam_id=$2 AND email=$3 AND NOT sandbox AND (status='invited' OR (status='active' AND ends_at>now()))`,[orgId,input.examId,email])).length)results.push({email,ok:false,message:'Already has a seat for this exam.'});
    else valid.push(email);
   } catch(e){results.push({email:raw.slice(0,80),ok:false,message:e instanceof Error?e.message:'Invalid.'});}
  }
  if(org.billing==='prepaid') {
   const left=await remaining(tx,orgId,input.examId,input.months);
   if(valid.length>left)throw new Error(`This needs ${valid.length} seats and ${left} ${left===1?'is':'are'} available. Buy more seats or assign fewer students.`);
  } else if(org.credit_limit_seats!==null) {
   const left=org.credit_limit_seats-await postpaidUsedThisMonth(tx,orgId);
   if(valid.length>left)throw new Error(`This needs ${valid.length} seats and your monthly limit allows ${Math.max(0,left)} more.`);
  }
  const ids:string[]=[];
  for(const email of valid) {const id=await assign(tx,org,{examId:input.examId,months:input.months,email,source:input.source,createdBy:actorId});ids.push(id);
   const [s]=await tx.query<{status:string}>('SELECT status FROM partner_enrollments WHERE id=$1',[id]);results.push({email,ok:true,status:s.status});}
  await audit(tx,actorId,orgId,'partner.seats_assigned',{count:ids.length,source:input.source,examId:input.examId,months:input.months});
  return {ids,results};
 });
}
export async function listEnrollments(db:Database,orgId:string,opts:{sandbox?:boolean;email?:string;status?:string;limit?:number;offset?:number}={}) {
 const email=(opts.email??'').trim().toLowerCase().slice(0,254),limit=Math.min(Math.max(Math.floor(opts.limit??50),1),200),offset=Math.max(0,Math.floor(opts.offset??0));
 const status={invited:`pe.status='invited'`,active:`pe.status='active' AND pe.ends_at>now()`,expired:`pe.status='active' AND pe.ends_at<=now()`,revoked:`pe.status='revoked'`}[opts.status??'']??'true';
 const rows=await db.query<EnrollmentRow&{total:number}>(`${ENROLLMENT_SELECT.replace('SELECT ','SELECT count(*) OVER()::int AS total,')} WHERE pe.organisation_id=$1 AND pe.sandbox=$2 AND ($3='' OR pe.email LIKE '%'||$3||'%' OR pe.external_ref=$3) AND ${status} ORDER BY pe.created_at DESC LIMIT ${limit} OFFSET ${offset}`,[orgId,opts.sandbox===true,email]);
 return {total:rows[0]?.total??0,data:rows.map(toEnrollment)};
}
export async function revokeEnrollment(db:Database,orgId:string,sandbox:boolean,id:string,actorId?:string|null) {
 return db.transaction(async tx=>{
  await lockOrg(tx,orgId,sandbox);
  const row=await loadEnrollment(tx,orgId,sandbox,id,true)??await notFound();
  if(row.status==='revoked')throw new PartnerError('This enrolment is already revoked.','already_revoked',409);
  await tx.query(`UPDATE partner_enrollments SET status='revoked',revoked_at=now() WHERE id=$1`,[id]);
  await tx.query(`UPDATE entitlements SET revoked_at=now() WHERE id=(SELECT entitlement_id FROM partner_enrollments WHERE id=$1) AND revoked_at IS NULL`,[id]);
  await audit(tx,actorId,id,'partner.seat_revoked',{organisationId:orgId,activated:row.activated_at!==null});
  return {enrollment:toEnrollment((await loadEnrollment(tx,orgId,sandbox,id))!),seatReturned:row.activated_at===null};
 });
}
// PATCH: an invited seat can switch duration (its seat is swapped); an active or expired one can be extended,
// which uses one more seat of the chosen duration and adds those months to the end date.
export async function changeEnrollment(db:Database,orgId:string,sandbox:boolean,id:string,change:{months?:unknown;extendMonths?:unknown},actorId?:string|null) {
 const pick=(v:unknown)=>v===undefined?undefined:[3,6,12].includes(Number(v))&&Number.isInteger(Number(v))?Number(v):(()=>{throw new PartnerError('Months must be 3, 6 or 12.','invalid_request',422);})();
 const months=pick(change.months),extend=pick(change.extendMonths);
 if((months===undefined)===(extend===undefined))throw new PartnerError('Send either "months" (for an invited seat) or "extend_months" (for an active one).','invalid_request',422);
 return db.transaction(async tx=>{
  const org=await lockOrg(tx,orgId,sandbox);
  const row=await loadEnrollment(tx,orgId,sandbox,id,true)??await notFound();
  const [{exam_id:examId}]=await tx.query<{exam_id:string}>('SELECT exam_id FROM partner_enrollments WHERE id=$1',[id]);
  if(months!==undefined) {
   if(row.status!=='invited')throw new PartnerError('Only an invited seat can change duration. Use extend_months for an active one.','invalid_state',409);
   if(months===row.months)throw new PartnerError(`This seat is already ${months} months.`,'invalid_request',422);
   await requireProduct(tx,orgId,examId,months);
   // Sandbox and postpaid seats are not tied to a pack, so only the duration changes (it was already counted).
   if(sandbox&&await sandboxUsed(tx,orgId,examId,months)>=TEST_SEATS)throw new PartnerError('All test seats for that product are in use.','no_seats',402);
   if(sandbox||org.billing==='postpaid')await tx.query('UPDATE partner_enrollments SET months=$2 WHERE id=$1',[id,months]);
   else {
    // Release the old pack seat first, then take one of the new duration; the transaction undoes both on failure.
    await tx.query('UPDATE partner_enrollments SET seat_pack_id=NULL,months=$2 WHERE id=$1',[id,months]);
    await tx.query('UPDATE partner_enrollments SET seat_pack_id=$2 WHERE id=$1',[id,await takeSeat(tx,org,examId,months,false)]);
   }
   await checkLowBalance(tx,org,examId,months,sandbox);
  } else {
   if(row.status!=='active')throw new PartnerError(row.status==='invited'?'This seat has not been activated yet. Change its duration with "months" instead.':'A revoked enrolment cannot be extended. Create a new one.','invalid_state',409);
   await requireProduct(tx,orgId,examId,extend!);
   const pack=await takeSeat(tx,org,examId,extend!,sandbox);
   await tx.query('INSERT INTO partner_extensions(enrollment_id,months,seat_pack_id,created_by) VALUES($1,$2,$3,$4)',[id,extend,pack,actorId??null]);
   const [{ends}]=await tx.query<{ends:string}>(`UPDATE partner_enrollments SET ends_at=GREATEST(ends_at,now())+make_interval(months=>$2),expiring_sent_at=NULL,expired_sent_at=NULL WHERE id=$1 RETURNING ends_at AS ends`,[id,extend]);
   await tx.query('UPDATE entitlements SET ends_at=$2 WHERE id=(SELECT entitlement_id FROM partner_enrollments WHERE id=$1)',[id,ends]);
   await checkLowBalance(tx,org,examId,extend!,sandbox);
  }
  await audit(tx,actorId,id,'partner.seat_changed',{organisationId:orgId,months,extendMonths:extend});
  return toEnrollment((await loadEnrollment(tx,orgId,sandbox,id))!);
 });
}
// When a student signs in with a verified email, every seat waiting for that email is activated.
export async function claimInvites(db:Database,userId:string,email:string) {
 const lower=email.toLowerCase();
 if(!(await db.query(`SELECT 1 FROM partner_enrollments WHERE email=$1 AND status='invited' AND NOT sandbox LIMIT 1`,[lower])).length)return 0;
 return db.transaction(async tx=>{
  const rows=await tx.query<{id:string}>(`SELECT pe.id FROM partner_enrollments pe JOIN organisations o ON o.id=pe.organisation_id WHERE pe.email=$1 AND pe.status='invited' AND NOT pe.sandbox AND o.status='active' FOR UPDATE OF pe SKIP LOCKED`,[lower]);
  for(const r of rows)await activate(tx,r.id,userId);
  return rows.length;
 });
}
// ---------------------------------------------------------------- progress (consent only)
export type Progress={answered:number;correct:number;accuracy:number|null;sessions:number;mocks:number;average_mock_score:number|null;last_active_at:string|null};
async function progressFor(db:Database,userId:string,examId:string):Promise<Progress> {
 const [p]=await db.query<{answered:number;correct:number;sessions:number;last:string|null}>(`SELECT count(i.selected)::int AS answered,count(*) FILTER (WHERE i.correct)::int AS correct,count(DISTINCT p.id)::int AS sessions,max(i.answered_at) AS last FROM practice_attempts p JOIN practice_items i ON i.attempt_id=p.id WHERE p.user_id=$1 AND p.exam_id=$2`,[userId,examId]);
 const [m]=await db.query<{mocks:number;average:number|null}>(`SELECT count(*)::int AS mocks,round(avg(score))::int AS average FROM (SELECT 100.0*count(*) FILTER (WHERE i.correct)/count(*) AS score FROM practice_attempts p JOIN practice_items i ON i.attempt_id=p.id
  WHERE p.user_id=$1 AND p.exam_id=$2 AND p.mode='exam' AND (p.submitted_at IS NOT NULL OR p.deadline_at<=now()) GROUP BY p.id) s`,[userId,examId]);
 return {answered:p.answered,correct:p.correct,accuracy:p.answered?Math.round(100*p.correct/p.answered):null,sessions:p.sessions,mocks:m.mocks,average_mock_score:m.average,last_active_at:iso(p.last)};
}
const CONSENTED=`EXISTS(SELECT 1 FROM partner_consents c WHERE c.user_id=pe.user_id AND c.organisation_id=pe.organisation_id AND c.revoked_at IS NULL)`;
export async function enrollmentProgress(db:Database,orgId:string,sandbox:boolean,id:string) {
 const row=await loadEnrollment(db,orgId,sandbox,id)??await notFound();
 if(sandbox)return {enrollment_id:id,consent:true,progress:{answered:0,correct:0,accuracy:null,sessions:0,mocks:0,average_mock_score:null,last_active_at:null} satisfies Progress};
 const [c]=await db.query<{ok:boolean;exam_id:string}>(`SELECT ${CONSENTED} AS ok,pe.exam_id FROM partner_enrollments pe WHERE pe.id=$1`,[id]);
 if(!row.user_id||!c.ok)throw new PartnerError('This student has not agreed to share their progress with you.','consent_required',403);
 return {enrollment_id:id,consent:true,progress:await progressFor(db,row.user_id,c.exam_id)};
}
export async function cohortReport(db:Database,orgId:string) {
 const [counts]=await db.query<{assigned:number;activated:number;invited:number;consented:number}>(`SELECT count(*) FILTER (WHERE status<>'revoked')::int AS assigned,count(*) FILTER (WHERE activated_at IS NOT NULL AND status<>'revoked')::int AS activated,count(*) FILTER (WHERE status='invited')::int AS invited,
  count(*) FILTER (WHERE status<>'revoked' AND user_id IS NOT NULL AND ${CONSENTED})::int AS consented FROM partner_enrollments pe WHERE organisation_id=$1 AND NOT sandbox`,[orgId]);
 const people=await db.query<{id:string;email:string;exam:string;exam_id:string;user_id:string;ends_at:string}>(`SELECT pe.id,pe.email,e.name AS exam,pe.exam_id,pe.user_id,pe.ends_at FROM partner_enrollments pe JOIN exams e ON e.id=pe.exam_id
  WHERE pe.organisation_id=$1 AND NOT pe.sandbox AND pe.status='active' AND ${CONSENTED} ORDER BY pe.activated_at DESC LIMIT 300`,[orgId]);
 const students=[];
 for(const p of people)students.push({id:p.id,email:p.email,exam:p.exam,accessEndsAt:iso(p.ends_at),...await progressFor(db,p.user_id,p.exam_id)});
 const scored=students.filter(s=>s.average_mock_score!==null);
 return {...counts,activationRate:counts.assigned?Math.round(100*counts.activated/counts.assigned):null,
  answered:students.reduce((s,x)=>s+x.answered,0),averageMockScore:scored.length?Math.round(scored.reduce((s,x)=>s+x.average_mock_score!,0)/scored.length):null,students};
}
// Student side: the partners that gave this student a seat, and whether progress is shared with each.
export async function studentPartners(db:Database,userId:string) {
 return db.query<{id:string;name:string;sharing:boolean}>(`SELECT DISTINCT o.id,o.name,EXISTS(SELECT 1 FROM partner_consents c WHERE c.user_id=$1 AND c.organisation_id=o.id AND c.revoked_at IS NULL) AS sharing
  FROM partner_enrollments pe JOIN organisations o ON o.id=pe.organisation_id WHERE pe.user_id=$1 AND NOT pe.sandbox ORDER BY o.name`,[userId]);
}
export async function setPartnerConsent(db:Database,userId:string,orgId:string,share:boolean) {
 requireId(orgId);
 if(!(await db.query('SELECT 1 FROM partner_enrollments WHERE user_id=$1 AND organisation_id=$2 AND NOT sandbox LIMIT 1',[userId,orgId])).length)throw new Error('This partner has not given you a seat.');
 if(share)await db.query(`INSERT INTO partner_consents(user_id,organisation_id) VALUES($1,$2) ON CONFLICT(user_id,organisation_id) DO UPDATE SET granted_at=now(),revoked_at=NULL`,[userId,orgId]);
 else await db.query('UPDATE partner_consents SET revoked_at=now() WHERE user_id=$1 AND organisation_id=$2 AND revoked_at IS NULL',[userId,orgId]);
}
// ---------------------------------------------------------------- invite links
const linkUrl=(token:string)=>`${(process.env.BETTER_AUTH_URL??'').replace(/\/$/,'')}/join/${token}`;
export async function createInviteLink(db:Database,actorId:string,orgId:string,input:{examId:string;months:number;cap:number;days:number;label:string}) {
 await requirePartnerAdmin(db,actorId,orgId,{write:true});requireId(input.examId);
 if(!Number.isInteger(input.cap)||input.cap<1||input.cap>1000)throw new Error('Set a cap between 1 and 1,000 students.');
 if(!Number.isInteger(input.days)||input.days<1||input.days>365)throw new Error('Choose how long the link works: 1 to 365 days.');
 if(![3,6,12].includes(input.months))throw new Error('Choose 3, 6 or 12 months.');
 await requireProduct(db,orgId,input.examId,input.months);
 const token=randomBytes(18).toString('base64url');
 const [row]=await db.query<{id:string}>(`INSERT INTO partner_invite_links(organisation_id,exam_id,months,token_hash,label,cap,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6,now()+make_interval(days=>$7),$8) RETURNING id`,[orgId,input.examId,input.months,sha256(token),input.label.trim().slice(0,120),input.cap,input.days,actorId]);
 await audit(db,actorId,row.id,'partner.invite_link_created',{organisationId:orgId,cap:input.cap,days:input.days});
 return {id:row.id,url:linkUrl(token)};
}
export async function listInviteLinks(db:Database,orgId:string) {
 const rows=await db.query<{id:string;label:string;exam:string;months:number;cap:number;used:number;expires_at:string;revoked_at:string|null;created_at:string}>(`SELECT l.id,l.label,e.name AS exam,l.months,l.cap,(SELECT count(*)::int FROM partner_enrollments pe WHERE pe.link_id=l.id) AS used,l.expires_at,l.revoked_at,l.created_at
  FROM partner_invite_links l JOIN exams e ON e.id=l.exam_id WHERE l.organisation_id=$1 ORDER BY l.created_at DESC LIMIT 50`,[orgId]);
 return rows.map(r=>({...r,expires_at:iso(r.expires_at)!,revoked_at:iso(r.revoked_at),created_at:iso(r.created_at)!,live:!r.revoked_at&&new Date(r.expires_at)>new Date()&&r.used<r.cap}));
}
export async function revokeInviteLink(db:Database,actorId:string,orgId:string,linkId:string) {
 await requirePartnerAdmin(db,actorId,orgId);requireId(linkId);
 if(!(await db.query('UPDATE partner_invite_links SET revoked_at=now() WHERE id=$1 AND organisation_id=$2 AND revoked_at IS NULL RETURNING id',[linkId,orgId])).length)throw new Error('Link not found or already turned off.');
 await audit(db,actorId,linkId,'partner.invite_link_revoked',{organisationId:orgId});
}
export async function inviteByToken(db:Database,token:string) {
 if(!/^[A-Za-z0-9_-]{20,40}$/.test(token))return null;
 const [l]=await db.query<{id:string;org:string;org_status:string;exam:string;months:number;cap:number;used:number;expired:boolean;revoked:boolean;logo:string|null;color:string|null}>(`SELECT l.id,COALESCE(o.brand_name,o.name) AS org,o.brand_logo_url AS logo,o.brand_color AS color,o.status AS org_status,e.name AS exam,l.months,l.cap,(SELECT count(*)::int FROM partner_enrollments pe WHERE pe.link_id=l.id) AS used,l.expires_at<=now() AS expired,l.revoked_at IS NOT NULL AS revoked
  FROM partner_invite_links l JOIN organisations o ON o.id=l.organisation_id JOIN exams e ON e.id=l.exam_id WHERE l.token_hash=$1`,[sha256(token)]);
 if(!l)return null;
 return {...l,usable:!l.expired&&!l.revoked&&l.used<l.cap&&l.org_status==='active'};
}
export async function claimInviteLink(db:Database,userId:string,token:string) {
 if(!/^[A-Za-z0-9_-]{20,40}$/.test(token))throw new Error('This invite link is not valid.');
 return db.transaction(async tx=>{
  const [l]=await tx.query<{id:string;organisation_id:string;exam_id:string;months:number;cap:number;expired:boolean;revoked:boolean}>(`SELECT id,organisation_id,exam_id,months,cap,expires_at<=now() AS expired,revoked_at IS NOT NULL AS revoked FROM partner_invite_links WHERE token_hash=$1 FOR UPDATE`,[sha256(token)]);
  if(!l||l.revoked)throw new Error('This invite link has been turned off. Ask your course provider for a new one.');
  if(l.expired)throw new Error('This invite link has expired. Ask your course provider for a new one.');
  const [user]=await tx.query<{email:string}>(`SELECT lower(u.email) AS email FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1 AND a.status='active' AND u.email_verified`,[userId]);
  if(!user)throw new Error('Verify your email address first, then open the link again.');
  const org=await lockOrg(tx,l.organisation_id).catch(()=>{throw new Error('This course provider cannot assign seats right now.');});
  const [{used}]=await tx.query<{used:number}>('SELECT count(*)::int AS used FROM partner_enrollments WHERE link_id=$1',[l.id]);
  if(used>=l.cap)throw new Error('All seats on this invite link have been taken. Ask your course provider for another link.');
  try {await assign(tx,org,{examId:l.exam_id,months:l.months,email:user.email,source:'link',linkId:l.id});}
  catch(e) {if(e instanceof PartnerError&&e.reason==='already_enrolled')throw new Error('You already have a seat for this exam from this course provider.');if(e instanceof PartnerError&&e.reason==='no_seats')throw new Error('Your course provider has no seats left. Let them know.');throw e;}
  const [{ends}]=await tx.query<{ends:string}>(`SELECT max(ends_at) AS ends FROM partner_enrollments WHERE link_id=$1 AND email=$2`,[l.id,user.email]);
  return {endsAt:iso(ends)};
 });
}
// ---------------------------------------------------------------- emails
const base=()=>(process.env.BETTER_AUTH_URL??'').replace(/\/$/,'');
const longDate=(v:string)=>new Date(v).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
// Sends the "you have a seat" email once per enrolment. Each one is claimed before sending, so two workers never
// send the same email; a failed send is released for the next sweep.
export async function sendEnrollmentEmails(db:Database,mailer:Mailer,ids?:string[]) {
 const rows=await db.query<{id:string;email:string;status:string;org:string;exam:string;months:number;ends_at:string|null}>(`SELECT pe.id,pe.email,pe.status,o.name AS org,e.name AS exam,pe.months,pe.ends_at FROM partner_enrollments pe JOIN organisations o ON o.id=pe.organisation_id JOIN exams e ON e.id=pe.exam_id
  WHERE NOT pe.sandbox AND pe.invite_sent_at IS NULL AND pe.status IN ('invited','active') AND ${ids?'pe.id=ANY($1::uuid[])':`pe.created_at>now()-interval '2 days' AND $1::uuid[] IS NULL`} LIMIT 500`,[ids??null]);
 let sent=0;
 for(const r of rows) {
  if(!(await db.query('UPDATE partner_enrollments SET invite_sent_at=now() WHERE id=$1 AND invite_sent_at IS NULL RETURNING id',[r.id])).length)continue;
  const text=r.status==='active'
   ?`${r.org} has given you access to the ${r.exam} question bank on Recalls Tutor until ${longDate(r.ends_at!)}.\n\nSign in to start practising:\n${base()}/practice`
   :`${r.org} has given you ${r.months} months of access to the ${r.exam} question bank on Recalls Tutor.\n\nCreate your account with this email address (${r.email}) to start:\n${base()}/sign-up\n\nYour ${r.months} months start when you first sign in. If you already use Recalls Tutor with a different email, ask ${r.org} to assign the seat to that address.`;
  try {await mailer({to:r.email,subject:`${r.org}: your ${r.exam} access on Recalls Tutor`,text});sent++;}
  catch {await db.query('UPDATE partner_enrollments SET invite_sent_at=NULL WHERE id=$1',[r.id]);}
 }
 return sent;
}
// ---------------------------------------------------------------- API keys
export type ApiKeyRow={id:string;mode:Mode;label:string;prefix:string;ipAllow:string[];createdAt:string;lastUsedAt:string|null;expiresAt:string|null;revokedAt:string|null;suspendedAt:string|null};
export function parseIpList(text:string) {
 const items=text.split(/[\s,]+/).map(s=>s.trim()).filter(Boolean);
 if(items.length>20)throw new Error('Add up to 20 IP addresses or ranges.');
 for(const item of items) {
  const [ip,bits]=item.split('/');
  const ok=bits===undefined?isIP(ip)!==0:isIP(ip)===4&&/^\d+$/.test(bits)&&Number(bits)<=32;
  if(!ok)throw new Error(`"${item.slice(0,60)}" is not an IP address or IPv4 range (for example 203.0.113.0/24).`);
 }
 return items;
}
const v4=(ip:string)=>ip.split('.').reduce((n,p)=>(n<<8)+Number(p),0)>>>0;
export function ipAllowed(ip:string|null,list:string[]) {
 if(!list.length)return true;
 if(!ip)return false;
 const plain=ip.replace(/^::ffff:/,'');
 return list.some(entry=>{const [net,bits]=entry.split('/');
  if(bits===undefined)return net===plain;
  if(isIP(plain)!==4)return false;
  const mask=Number(bits)===0?0:(~0<<(32-Number(bits)))>>>0;return (v4(plain)&mask)===(v4(net)&mask);});
}
const MAX_KEYS=10;
async function insertKey(db:Database,orgId:string,actorId:string,mode:Mode,label:string,ipAllow:string[]) {
 const secret=`rt_${mode}_${randomBytes(32).toString('base64url')}`;
 const [row]=await db.query<{id:string}>('INSERT INTO api_keys(organisation_id,mode,label,prefix,secret_hash,ip_allow,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[orgId,mode,label,secret.slice(0,12),sha256(secret),ipAllow,actorId]);
 return {id:row.id,secret};
}
export async function createApiKey(db:Database,actorId:string,orgId:string,input:{mode:string;label:string;ipAllow:string}) {
 const m=await requirePartnerAdmin(db,actorId,orgId,{mfa:true});
 if(input.mode!=='live'&&input.mode!=='test')throw new Error('Choose a live or a sandbox key.');
 if(input.mode==='live'&&m.status!=='active')throw new Error('Live keys are available once your partner account is approved. You can create a sandbox key now.');
 const label=input.label.trim().slice(0,80),ips=parseIpList(input.ipAllow);
 const [{n}]=await db.query<{n:number}>(`SELECT count(*)::int AS n FROM api_keys WHERE organisation_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())`,[orgId]);
 if(n>=MAX_KEYS)throw new Error(`You can have up to ${MAX_KEYS} keys. Revoke one you no longer use.`);
 const key=await insertKey(db,orgId,actorId,input.mode,label,ips);
 await audit(db,actorId,key.id,'partner.api_key_created',{organisationId:orgId,mode:input.mode,ipAllow:ips.length});
 return key;
}
// The old key keeps working for 24 hours so the partner can deploy the new one without downtime.
export async function rotateApiKey(db:Database,actorId:string,orgId:string,keyId:string) {
 await requirePartnerAdmin(db,actorId,orgId,{mfa:true});requireId(keyId);
 return db.transaction(async tx=>{
  const [old]=await tx.query<{mode:Mode;label:string;ip_allow:string[];suspended:boolean}>(`SELECT mode,label,ip_allow,suspended_at IS NOT NULL AS suspended FROM api_keys WHERE id=$1 AND organisation_id=$2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE`,[keyId,orgId]);
  if(!old)throw new Error('Key not found, or it has already been revoked or rotated.');
  if(old.suspended)throw new Error('This key is suspended by Recalls Tutor. Contact us before rotating it.');
  await tx.query(`UPDATE api_keys SET expires_at=LEAST(COALESCE(expires_at,'infinity'),now()+interval '24 hours') WHERE id=$1`,[keyId]);
  const key=await insertKey(tx,orgId,actorId,old.mode,old.label,old.ip_allow);
  await audit(tx,actorId,key.id,'partner.api_key_rotated',{organisationId:orgId,replaced:keyId});
  return key;
 });
}
export async function revokeApiKey(db:Database,actorId:string,orgId:string,keyId:string) {
 await requirePartnerAdmin(db,actorId,orgId);requireId(keyId);
 if(!(await db.query('UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND organisation_id=$2 AND revoked_at IS NULL RETURNING id',[keyId,orgId])).length)throw new Error('Key not found or already revoked.');
 await audit(db,actorId,keyId,'partner.api_key_revoked',{organisationId:orgId});
}
export async function setKeyIps(db:Database,actorId:string,orgId:string,keyId:string,ipAllow:string) {
 await requirePartnerAdmin(db,actorId,orgId,{mfa:true});requireId(keyId);
 const ips=parseIpList(ipAllow);
 if(!(await db.query('UPDATE api_keys SET ip_allow=$3 WHERE id=$1 AND organisation_id=$2 AND revoked_at IS NULL RETURNING id',[keyId,orgId,ips])).length)throw new Error('Key not found or revoked.');
 await audit(db,actorId,keyId,'partner.api_key_ips_changed',{organisationId:orgId,ipAllow:ips.length});
}
export async function listApiKeys(db:Database,orgId:string):Promise<ApiKeyRow[]> {
 const rows=await db.query<ApiKeyRow>(`SELECT id,mode,label,prefix,ip_allow AS "ipAllow",created_at AS "createdAt",last_used_at AS "lastUsedAt",expires_at AS "expiresAt",revoked_at AS "revokedAt",suspended_at AS "suspendedAt" FROM api_keys WHERE organisation_id=$1 AND (revoked_at IS NULL OR revoked_at>now()-interval '30 days') ORDER BY created_at DESC`,[orgId]);
 return rows.map(r=>({...r,createdAt:iso(r.createdAt)!,lastUsedAt:iso(r.lastUsedAt),expiresAt:iso(r.expiresAt),revokedAt:iso(r.revokedAt),suspendedAt:iso(r.suspendedAt)}));
}
export type KeyContext={keyId:string;orgId:string;mode:Mode;ipAllow:string[]};
export async function findApiKey(db:Database,secret:string):Promise<(KeyContext&{problem:null|'revoked'|'suspended'|'partner_inactive'})|null> {
 if(!/^rt_(live|test)_[A-Za-z0-9_-]{43}$/.test(secret))return null;
 const [k]=await db.query<{id:string;organisation_id:string;mode:Mode;ip_allow:string[];dead:boolean;suspended:boolean;org_status:string}>(`SELECT k.id,k.organisation_id,k.mode,k.ip_allow,(k.revoked_at IS NOT NULL OR k.expires_at<=now()) AS dead,k.suspended_at IS NOT NULL AS suspended,o.status AS org_status FROM api_keys k JOIN organisations o ON o.id=k.organisation_id WHERE k.secret_hash=$1`,[sha256(secret)]);
 if(!k)return null;
 // A pending partner can use sandbox keys while it is set up; live keys need an approved, unsuspended partner.
 const problem=k.dead?'revoked':k.suspended?'suspended':(k.org_status==='suspended'||(k.mode==='live'&&k.org_status!=='active'))?'partner_inactive':null;
 return {keyId:k.id,orgId:k.organisation_id,mode:k.mode,ipAllow:k.ip_allow,problem};
}
export async function listApiRequests(db:Database,orgId:string,limit=100) {
 const rows=await db.query<{id:string;at:string;method:string;path:string;status:number;mode:string;ip:string|null;replayed:boolean;ms:number;prefix:string|null}>(`SELECT r.id,r.created_at AS at,r.method,r.path,r.status,r.mode,r.ip,r.replayed,r.duration_ms AS ms,k.prefix FROM api_requests r LEFT JOIN api_keys k ON k.id=r.key_id WHERE r.organisation_id=$1 ORDER BY r.created_at DESC LIMIT $2`,[orgId,limit]);
 return rows.map(r=>({...r,at:iso(r.at)!}));
}
// ---------------------------------------------------------------- webhook endpoints
const MAX_ENDPOINTS=5;
export async function createWebhookEndpoint(db:Database,actorId:string,orgId:string,input:{mode:string;url:string;events:string[]}) {
 await requirePartnerAdmin(db,actorId,orgId,{mfa:true});
 if(input.mode!=='live'&&input.mode!=='test')throw new Error('Choose live or sandbox events.');
 const url=validWebhookUrl(input.url),events=WEBHOOK_EVENTS.filter(e=>input.events.includes(e));
 if(!events.length)throw new Error('Choose at least one event.');
 const [{n}]=await db.query<{n:number}>('SELECT count(*)::int AS n FROM webhook_endpoints WHERE organisation_id=$1 AND disabled_at IS NULL',[orgId]);
 if(n>=MAX_ENDPOINTS)throw new Error(`You can have up to ${MAX_ENDPOINTS} webhook endpoints. Turn one off first.`);
 const secret=newWebhookSecret();
 const [row]=await db.query<{id:string}>('INSERT INTO webhook_endpoints(organisation_id,mode,url,secret,events,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[orgId,input.mode,url,secret,events,actorId]);
 await audit(db,actorId,row.id,'partner.webhook_created',{organisationId:orgId,mode:input.mode,events});
 return {id:row.id,secret};
}
export async function rotateWebhookSecret(db:Database,actorId:string,orgId:string,endpointId:string) {
 await requirePartnerAdmin(db,actorId,orgId,{mfa:true});requireId(endpointId);
 const secret=newWebhookSecret();
 if(!(await db.query('UPDATE webhook_endpoints SET secret=$3 WHERE id=$1 AND organisation_id=$2 AND disabled_at IS NULL RETURNING id',[endpointId,orgId,secret])).length)throw new Error('Endpoint not found.');
 await audit(db,actorId,endpointId,'partner.webhook_secret_rotated',{organisationId:orgId});
 return secret;
}
export async function disableWebhookEndpoint(db:Database,actorId:string,orgId:string,endpointId:string) {
 await requirePartnerAdmin(db,actorId,orgId);requireId(endpointId);
 if(!(await db.query('UPDATE webhook_endpoints SET disabled_at=now() WHERE id=$1 AND organisation_id=$2 AND disabled_at IS NULL RETURNING id',[endpointId,orgId])).length)throw new Error('Endpoint not found or already off.');
 await audit(db,actorId,endpointId,'partner.webhook_disabled',{organisationId:orgId});
}
export async function retryDelivery(db:Database,actorId:string,orgId:string,deliveryId:string) {
 await requirePartnerAdmin(db,actorId,orgId);requireId(deliveryId);
 if(!(await db.query(`UPDATE webhook_deliveries d SET next_attempt_at=now() FROM webhook_endpoints e WHERE d.id=$1 AND e.id=d.endpoint_id AND e.organisation_id=$2 AND e.disabled_at IS NULL AND d.delivered_at IS NULL RETURNING d.id`,[deliveryId,orgId])).length)throw new Error('Delivery not found or already delivered.');
}
export async function listWebhookEndpoints(db:Database,orgId:string) {
 const endpoints=await db.query<{id:string;mode:Mode;url:string;events:string[];created_at:string}>(`SELECT id,mode,url,events,created_at FROM webhook_endpoints WHERE organisation_id=$1 AND disabled_at IS NULL ORDER BY created_at`,[orgId]);
 const out=[];
 for(const e of endpoints) {
  const deliveries=await db.query<{id:string;event:string;created_at:string;delivered_at:string|null;attempts:number;last_status:number|null;last_error:string|null;gave_up:boolean}>(`SELECT id,event,created_at,delivered_at,attempts,last_status,last_error,(delivered_at IS NULL AND next_attempt_at IS NULL) AS gave_up FROM webhook_deliveries WHERE endpoint_id=$1 ORDER BY created_at DESC LIMIT 10`,[e.id]);
  out.push({...e,created_at:iso(e.created_at)!,deliveries:deliveries.map(d=>({...d,created_at:iso(d.created_at)!,delivered_at:iso(d.delivered_at)}))});
 }
 return out;
}
// ---------------------------------------------------------------- portal overview and billing
export async function partnerAlerts(db:Database,orgId:string) {
 const rows=await db.query<{id:string;kind:string;message:string;created_at:string}>(`SELECT id,kind,message,created_at FROM partner_alerts WHERE organisation_id=$1 AND dismissed_at IS NULL ORDER BY created_at DESC LIMIT 20`,[orgId]);
 return rows.map(r=>({...r,created_at:iso(r.created_at)!}));
}
export async function dismissAlert(db:Database,actorId:string,orgId:string,alertId:string) {
 await requirePartnerAdmin(db,actorId,orgId);requireId(alertId);
 await db.query('UPDATE partner_alerts SET dismissed_at=now() WHERE id=$1 AND organisation_id=$2',[alertId,orgId]);
}
export async function partnerBilling(db:Database,orgId:string) {
 const packs=await db.query<{id:string;exam:string;months:number;seats:number;remaining:number;price_cents:number|null;reference:string;purchased_at:string;expires_at:string}>(`SELECT sp.id,e.name AS exam,sp.months,sp.seats,GREATEST(sp.seats-${PACK_USED},0) AS remaining,sp.price_cents,sp.reference,sp.purchased_at,sp.expires_at FROM seat_packs sp JOIN exams e ON e.id=sp.exam_id WHERE sp.organisation_id=$1 ORDER BY sp.purchased_at DESC`,[orgId]);
 // Postpaid statements: seats activated (and extensions) each month, at the agreed seat price.
 const usage=await db.query<{month:string;exam:string;months:number;seats:number;price:number|null}>(`WITH uses AS (
   SELECT date_trunc('month',pe.activated_at) AS month,pe.exam_id,pe.months FROM partner_enrollments pe WHERE pe.organisation_id=$1 AND NOT pe.sandbox AND pe.activated_at IS NOT NULL AND pe.seat_pack_id IS NULL
   UNION ALL SELECT date_trunc('month',x.created_at),pe.exam_id,x.months FROM partner_extensions x JOIN partner_enrollments pe ON pe.id=x.enrollment_id WHERE pe.organisation_id=$1 AND NOT pe.sandbox AND x.seat_pack_id IS NULL)
  SELECT to_char(u.month,'YYYY-MM') AS month,e.name AS exam,u.months,count(*)::int AS seats,pp.seat_price_cents AS price FROM uses u JOIN exams e ON e.id=u.exam_id LEFT JOIN partner_products pp ON pp.organisation_id=$1 AND pp.exam_id=u.exam_id AND pp.months=u.months
  GROUP BY 1,2,3,5 ORDER BY 1 DESC,2,3`,[orgId]);
 return {packs:packs.map(p=>({...p,purchased_at:iso(p.purchased_at)!,expires_at:iso(p.expires_at)!,expired:new Date(p.expires_at)<=new Date()})),usage};
}
// ---------------------------------------------------------------- scheduled sweep (cron)
// Sends enrollment.expiring (7 days before) and enrollment.expired once each, raises expiring-pack alerts 14 days
// ahead, emails new alerts and unsent seat emails, and prunes old idempotency records and logs.
export async function sweepPartners(db:Database,mailer?:Mailer) {
 const expiring=await db.query<{id:string}>(`UPDATE partner_enrollments SET expiring_sent_at=now() WHERE status='active' AND expiring_sent_at IS NULL AND ends_at>now() AND ends_at<=now()+interval '7 days' RETURNING id`);
 for(const e of expiring)await announce(db,e.id,'enrollment.expiring');
 const expired=await db.query<{id:string}>(`UPDATE partner_enrollments SET expired_sent_at=now(),expiring_sent_at=COALESCE(expiring_sent_at,now()) WHERE status='active' AND expired_sent_at IS NULL AND ends_at<=now() RETURNING id`);
 for(const e of expired)await announce(db,e.id,'enrollment.expired');
 const packs=await db.query<{organisation_id:string;exam_id:string;months:number;left:number;exam:string;expires_at:string}>(`UPDATE seat_packs sp SET expiring_sent_at=now() FROM exams e WHERE e.id=sp.exam_id AND sp.expiring_sent_at IS NULL AND sp.expires_at>now() AND sp.expires_at<=now()+interval '14 days' AND sp.seats>${PACK_USED}
  RETURNING sp.organisation_id,sp.exam_id,sp.months,(sp.seats-${PACK_USED}) AS left,e.name AS exam,sp.expires_at`);
 for(const p of packs)await db.query(`INSERT INTO partner_alerts(organisation_id,kind,exam_id,months,message) VALUES($1,'pack_expiring',$2,$3,$4)`,[p.organisation_id,p.exam_id,p.months,`${p.left} unused ${p.left===1?'seat':'seats'} for ${p.exam} (${p.months} months) expire on ${longDate(p.expires_at)}.`]);
 let emails=0;
 if(mailer) {
  emails+=await sendEnrollmentEmails(db,mailer);
  const alerts=await db.query<{id:string;organisation_id:string;message:string;org:string}>(`UPDATE partner_alerts a SET emailed_at=now() FROM organisations o WHERE o.id=a.organisation_id AND a.emailed_at IS NULL AND a.created_at>now()-interval '2 days' RETURNING a.id,a.organisation_id,a.message,o.name AS org`);
  for(const a of alerts) {
   const to=await db.query<{email:string}>(`SELECT DISTINCT u.email FROM organisation_members m JOIN app_users x ON x.id=m.user_id JOIN auth_users u ON u.id=x.auth_id WHERE m.organisation_id=$1 AND x.status='active' AND u.email_verified
    UNION SELECT contact_email FROM organisations WHERE id=$1 AND contact_email IS NOT NULL`,[a.organisation_id]);
   for(const r of to){try{await mailer({to:r.email,subject:`Recalls Tutor partner alert for ${a.org}`,text:`${a.message}\n\nSee your seats in the Partner Portal:\n${base()}/partner`});emails++;}catch{/* shown in the portal regardless */}}
  }
 }
 await db.query(`DELETE FROM api_idempotency WHERE created_at<now()-interval '24 hours'`);
 await db.query(`DELETE FROM api_requests WHERE created_at<now()-interval '90 days'`);
 await db.query(`DELETE FROM webhook_deliveries WHERE created_at<now()-interval '30 days' AND (delivered_at IS NOT NULL OR next_attempt_at IS NULL)`);
 return {expiring:expiring.length,expired:expired.length,packs:packs.length,emails};
}

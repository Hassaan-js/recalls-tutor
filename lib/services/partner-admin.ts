import type {Database} from '../db/client';
import {requireSuperAdmin} from './admin';
import {requireId} from './studio';
import {listApiKeys,partnerBilling} from './partners';
// PART-6: a Super Admin creates and approves partners, sets what they may sell and at what seat price, records
// seat-pack purchases, adds partner admins, and can suspend a partner or one API key instantly.
const iso=(v:unknown)=>v==null?null:new Date(v as string).toISOString();
async function audit(db:Database,actorId:string,entityId:string,action:string,before:unknown,after:unknown) {
 await db.query('INSERT INTO audit_log(actor_id,entity_id,action,before_json,after_json) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',[actorId,entityId,action,JSON.stringify(before),JSON.stringify(after)]);
}
export type PartnerRow={id:string;name:string;slug:string|null;status:string;billing:string;members:number;assigned:number;activated:number;available:number|null;liveKeys:number;createdAt:string};
export async function listPartners(db:Database,actorId:string):Promise<PartnerRow[]> {
 await requireSuperAdmin(db,actorId);
 const rows=await db.query<PartnerRow>(`SELECT o.id,o.name,o.slug,o.status,o.billing,o.created_at AS "createdAt",
  (SELECT count(*)::int FROM organisation_members m WHERE m.organisation_id=o.id) AS members,
  (SELECT count(*)::int FROM partner_enrollments pe WHERE pe.organisation_id=o.id AND NOT pe.sandbox AND pe.status<>'revoked') AS assigned,
  (SELECT count(*)::int FROM partner_enrollments pe WHERE pe.organisation_id=o.id AND NOT pe.sandbox AND pe.activated_at IS NOT NULL) AS activated,
  CASE WHEN o.billing='prepaid' THEN (SELECT COALESCE(sum(sp.seats-((SELECT count(*) FROM partner_enrollments pe WHERE pe.seat_pack_id=sp.id AND NOT (pe.status='revoked' AND pe.activated_at IS NULL))+(SELECT count(*) FROM partner_extensions x WHERE x.seat_pack_id=sp.id))),0)::int FROM seat_packs sp WHERE sp.organisation_id=o.id AND sp.expires_at>now()) END AS available,
  (SELECT count(*)::int FROM api_keys k WHERE k.organisation_id=o.id AND k.mode='live' AND k.revoked_at IS NULL AND k.suspended_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>now())) AS "liveKeys"
  FROM organisations o ORDER BY array_position(ARRAY['pending','active','suspended'],o.status),o.name`);
 return rows.map(r=>({...r,createdAt:iso(r.createdAt)!}));
}
const slugify=(v:string)=>v.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50);
function cleanPartner(input:{name:string;contactEmail:string;billing:string;creditLimit:string|number|null;lowBalanceAt?:string|number;notes:string}) {
 const name=input.name.trim();
 if(name.length<2||name.length>120)throw new Error('Give the partner a name (2 to 120 characters).');
 const contactEmail=input.contactEmail.trim().toLowerCase();
 if(contactEmail&&!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(contactEmail))throw new Error('Enter a valid contact email, or leave it empty.');
 if(input.billing!=='prepaid'&&input.billing!=='postpaid')throw new Error('Choose prepaid seat packs or postpaid billing.');
 const credit=input.creditLimit===null||input.creditLimit===''?null:Number(input.creditLimit);
 if(credit!==null&&(!Number.isInteger(credit)||credit<1||credit>100000))throw new Error('The monthly seat limit must be a whole number from 1 to 100,000, or empty for no limit.');
 const low=input.lowBalanceAt===undefined||input.lowBalanceAt===''?5:Number(input.lowBalanceAt);
 if(!Number.isInteger(low)||low<0||low>10000)throw new Error('The low-balance alert must be a whole number of seats.');
 if(input.notes.length>1000)throw new Error('Notes can be up to 1,000 characters.');
 return {name,contactEmail:contactEmail||null,billing:input.billing,credit:input.billing==='postpaid'?credit:null,low,notes:input.notes.trim()};
}
export async function createPartner(db:Database,actorId:string,input:{name:string;contactEmail:string;billing:string;creditLimit:string|number|null;notes:string}) {
 const p=cleanPartner(input);
 return db.transaction(async tx=>{
  await requireSuperAdmin(tx,actorId);
  let slug=slugify(p.name).padEnd(3,'0');
  if((await tx.query('SELECT 1 FROM organisations WHERE slug=$1',[slug])).length)slug=`${slug.slice(0,44)}-${Math.random().toString(36).slice(2,7)}`;
  const [row]=await tx.query<{id:string}>(`INSERT INTO organisations(name,slug,contact_email,billing,credit_limit_seats,low_balance_at,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[p.name,slug,p.contactEmail,p.billing,p.credit,p.low,p.notes]);
  await audit(tx,actorId,row.id,'partner.created',null,{name:p.name,billing:p.billing,creditLimit:p.credit});
  return row.id;
 });
}
export async function updatePartner(db:Database,actorId:string,orgId:string,input:{name:string;contactEmail:string;billing:string;creditLimit:string|number|null;lowBalanceAt:string|number;notes:string}) {
 requireId(orgId);const p=cleanPartner(input);
 return db.transaction(async tx=>{
  await requireSuperAdmin(tx,actorId);
  const [before]=await tx.query('SELECT name,contact_email,billing,credit_limit_seats,low_balance_at FROM organisations WHERE id=$1 FOR UPDATE',[orgId]);
  if(!before)throw new Error('Partner not found.');
  await tx.query('UPDATE organisations SET name=$2,contact_email=$3,billing=$4,credit_limit_seats=$5,low_balance_at=$6,notes=$7 WHERE id=$1',[orgId,p.name,p.contactEmail,p.billing,p.credit,p.low,p.notes]);
  await audit(tx,actorId,orgId,'partner.updated',before,{name:p.name,contact_email:p.contactEmail,billing:p.billing,credit_limit_seats:p.credit,low_balance_at:p.low});
 });
}
// Approve a pending partner; suspend (API keys stop at once, the portal turns read-only, students keep the access
// they already have); or reinstate.
export async function setPartnerStatus(db:Database,actorId:string,orgId:string,action:string,note:string) {
 requireId(orgId);
 const next={approve:'active',suspend:'suspended',reinstate:'active'}[action];
 if(!next)throw new Error('Unknown action.');
 if(action==='suspend'&&(!note.trim()||note.length>300))throw new Error('Give a reason for the suspension (up to 300 characters).');
 return db.transaction(async tx=>{
  await requireSuperAdmin(tx,actorId);
  const [org]=await tx.query<{status:string}>('SELECT status FROM organisations WHERE id=$1 FOR UPDATE',[orgId]);
  if(!org)throw new Error('Partner not found.');
  const from={approve:'pending',suspend:'active',reinstate:'suspended'}[action];
  if(org.status!==from&&!(action==='suspend'&&org.status==='pending'))throw new Error(`This partner is ${org.status}.`);
  if(action==='approve'&&!(await tx.query('SELECT 1 FROM partner_products WHERE organisation_id=$1',[orgId])).length)throw new Error('Choose at least one product the partner may assign before approving.');
  await tx.query(`UPDATE organisations SET status=$2,approved_at=CASE WHEN $3 THEN now() ELSE approved_at END,suspended_at=CASE WHEN $2='suspended' THEN now() ELSE NULL END WHERE id=$1`,[orgId,next,action==='approve']);
  await audit(tx,actorId,orgId,`partner.${action==='approve'?'approved':action==='suspend'?'suspended':'reinstated'}`,{status:org.status},{status:next,note:note.trim()||undefined});
 });
}
export type ProductSetting={examId:string;months:number;priceCents:number|null};
export async function setPartnerProducts(db:Database,actorId:string,orgId:string,products:ProductSetting[]) {
 requireId(orgId);
 for(const p of products) {
  requireId(p.examId);
  if(![3,6,12].includes(p.months))throw new Error('Durations are 3, 6 or 12 months.');
  if(p.priceCents!==null&&(!Number.isInteger(p.priceCents)||p.priceCents<0||p.priceCents>10_000_00))throw new Error('Enter seat prices in dollars, for example 45.00.');
 }
 return db.transaction(async tx=>{
  await requireSuperAdmin(tx,actorId);
  if(!(await tx.query('SELECT 1 FROM organisations WHERE id=$1 FOR UPDATE',[orgId])).length)throw new Error('Partner not found.');
  const before=await tx.query('SELECT exam_id,months,seat_price_cents FROM partner_products WHERE organisation_id=$1 ORDER BY exam_id,months',[orgId]);
  await tx.query('DELETE FROM partner_products WHERE organisation_id=$1',[orgId]);
  for(const p of products)await tx.query('INSERT INTO partner_products(organisation_id,exam_id,months,seat_price_cents) VALUES($1,$2,$3,$4)',[orgId,p.examId,p.months,p.priceCents]);
  await audit(tx,actorId,orgId,'partner.products_set',{products:before.length},{products:products.length});
 });
}
export async function addSeatPack(db:Database,actorId:string,orgId:string,input:{examId:string;months:number;seats:number;priceCents:number|null;expiresOn:string;reference:string}) {
 requireId(orgId);requireId(input.examId);
 if(!Number.isInteger(input.seats)||input.seats<1||input.seats>100000)throw new Error('Seats must be a whole number from 1 to 100,000.');
 if(input.priceCents!==null&&(!Number.isInteger(input.priceCents)||input.priceCents<0))throw new Error('Enter the amount paid in dollars, or leave it empty.');
 const expires=new Date(`${input.expiresOn}T23:59:59Z`);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn)||Number.isNaN(expires.getTime())||expires<=new Date())throw new Error('Choose an expiry date in the future.');
 if(expires.getTime()>Date.now()+3*366*86400000)throw new Error('Packs can expire up to three years ahead.');
 return db.transaction(async tx=>{
  await requireSuperAdmin(tx,actorId);
  const [org]=await tx.query<{billing:string}>('SELECT billing FROM organisations WHERE id=$1 FOR UPDATE',[orgId]);
  if(!org)throw new Error('Partner not found.');
  if(org.billing!=='prepaid')throw new Error('This partner is billed monthly for seats it activates. Switch it to prepaid to record seat packs.');
  if(!(await tx.query('SELECT 1 FROM partner_products WHERE organisation_id=$1 AND exam_id=$2 AND months=$3',[orgId,input.examId,input.months])).length)throw new Error('Allow this product for the partner first.');
  const [row]=await tx.query<{id:string}>('INSERT INTO seat_packs(organisation_id,exam_id,months,seats,price_cents,reference,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[orgId,input.examId,input.months,input.seats,input.priceCents,input.reference.trim().slice(0,200),expires.toISOString(),actorId]);
  // A new pack clears the low-balance alert it answers.
  await tx.query(`UPDATE partner_alerts SET dismissed_at=now() WHERE organisation_id=$1 AND kind='low_balance' AND exam_id=$2 AND months=$3 AND dismissed_at IS NULL`,[orgId,input.examId,input.months]);
  await audit(tx,actorId,row.id,'partner.seat_pack_added',null,{organisationId:orgId,seats:input.seats,months:input.months,priceCents:input.priceCents,expiresOn:input.expiresOn});
  return row.id;
 });
}
export async function addPartnerMember(db:Database,actorId:string,orgId:string,email:string) {
 requireId(orgId);
 return db.transaction(async tx=>{
  await requireSuperAdmin(tx,actorId);
  if(!(await tx.query('SELECT 1 FROM organisations WHERE id=$1',[orgId])).length)throw new Error('Partner not found.');
  const [user]=await tx.query<{id:string;verified:boolean}>(`SELECT a.id,u.email_verified AS verified FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE lower(u.email)=lower($1) AND a.status='active'`,[email.trim()]);
  if(!user)throw new Error('No active account uses that email. Ask the partner admin to create a Recalls Tutor account first.');
  if(!user.verified)throw new Error('This account has not verified its email yet.');
  if(!(await tx.query('INSERT INTO organisation_members(organisation_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id',[orgId,user.id])).length)throw new Error('This account is already a partner admin here.');
  await audit(tx,actorId,orgId,'partner.member_added',null,{userId:user.id});
 });
}
export async function removePartnerMember(db:Database,actorId:string,orgId:string,userId:string) {
 requireId(orgId);requireId(userId);
 await requireSuperAdmin(db,actorId);
 if(!(await db.query('DELETE FROM organisation_members WHERE organisation_id=$1 AND user_id=$2 RETURNING user_id',[orgId,userId])).length)throw new Error('Not a partner admin here.');
 await audit(db,actorId,orgId,'partner.member_removed',{userId},null);
}
export async function setKeySuspended(db:Database,actorId:string,keyId:string,suspend:boolean) {
 requireId(keyId);
 await requireSuperAdmin(db,actorId);
 const rows=await db.query<{organisation_id:string}>(`UPDATE api_keys SET suspended_at=${suspend?'now()':'NULL'} WHERE id=$1 AND revoked_at IS NULL AND (suspended_at IS ${suspend?'':'NOT '}NULL) RETURNING organisation_id`,[keyId]);
 if(!rows.length)throw new Error(suspend?'Key not found, revoked or already suspended.':'Key not found or not suspended.');
 await audit(db,actorId,keyId,suspend?'partner.api_key_suspended':'partner.api_key_unsuspended',null,{organisationId:rows[0].organisation_id});
}
export async function getPartnerDetail(db:Database,actorId:string,orgId:string) {
 requireId(orgId);
 await requireSuperAdmin(db,actorId);
 const [org]=await db.query<{id:string;name:string;slug:string;status:string;billing:'prepaid'|'postpaid';credit_limit_seats:number|null;low_balance_at:number;contact_email:string|null;notes:string;created_at:string;approved_at:string|null;suspended_at:string|null;brand_name:string|null;brand_logo_url:string|null;brand_color:string|null}>(`SELECT id,name,slug,status,billing,credit_limit_seats,low_balance_at,contact_email,notes,created_at,approved_at,suspended_at,brand_name,brand_logo_url,brand_color FROM organisations WHERE id=$1`,[orgId]);
 if(!org)return null;
 const [members,products,exams,counts,requests24h,billing,keys]=await Promise.all([
  db.query<{id:string;name:string;email:string;twoFactor:boolean}>(`SELECT a.id,u.name,u.email,u.two_factor_enabled AS "twoFactor" FROM organisation_members m JOIN app_users a ON a.id=m.user_id JOIN auth_users u ON u.id=a.auth_id WHERE m.organisation_id=$1 ORDER BY u.name`,[orgId]),
  db.query<{examId:string;months:number;priceCents:number|null}>(`SELECT exam_id AS "examId",months,seat_price_cents AS "priceCents" FROM partner_products WHERE organisation_id=$1`,[orgId]),
  db.query<{id:string;name:string;live:boolean}>(`SELECT id,name,launch_status='live' AS live FROM exams ORDER BY name`),
  db.query<{assigned:number;activated:number;invited:number;sandbox:number}>(`SELECT count(*) FILTER (WHERE NOT sandbox AND status<>'revoked')::int AS assigned,count(*) FILTER (WHERE NOT sandbox AND activated_at IS NOT NULL)::int AS activated,count(*) FILTER (WHERE NOT sandbox AND status='invited')::int AS invited,count(*) FILTER (WHERE sandbox)::int AS sandbox FROM partner_enrollments WHERE organisation_id=$1`,[orgId]),
  db.query<{n:number;errors:number}>(`SELECT count(*)::int AS n,count(*) FILTER (WHERE status>=400)::int AS errors FROM api_requests WHERE organisation_id=$1 AND created_at>now()-interval '24 hours'`,[orgId]),
  partnerBilling(db,orgId),listApiKeys(db,orgId),
 ]);
 return {org:{...org,created_at:iso(org.created_at)!,approved_at:iso(org.approved_at),suspended_at:iso(org.suspended_at)},members,products,exams,counts:counts[0],requests24h:requests24h[0],billing,keys};
}
// Partner revenue, kept apart from direct sales: seat packs by purchase month, and postpaid seats by activation
// month at the agreed seat price. Amounts are what was recorded here; invoices themselves are issued in Stripe.
export async function partnerRevenue(db:Database,actorId:string) {
 await requireSuperAdmin(db,actorId);
 return db.query<{month:string;partner:string;kind:'pack'|'postpaid';seats:number;cents:number;unpriced:number}>(`WITH lines AS (
   SELECT date_trunc('month',sp.purchased_at) AS month,sp.organisation_id,'pack' AS kind,sp.seats,COALESCE(sp.price_cents,0) AS cents,(sp.price_cents IS NULL)::int AS unpriced FROM seat_packs sp
   UNION ALL SELECT date_trunc('month',pe.activated_at),pe.organisation_id,'postpaid',1,COALESCE(pp.seat_price_cents,0),(pp.seat_price_cents IS NULL)::int FROM partner_enrollments pe LEFT JOIN partner_products pp ON pp.organisation_id=pe.organisation_id AND pp.exam_id=pe.exam_id AND pp.months=pe.months WHERE NOT pe.sandbox AND pe.activated_at IS NOT NULL AND pe.seat_pack_id IS NULL
   UNION ALL SELECT date_trunc('month',x.created_at),pe.organisation_id,'postpaid',1,COALESCE(pp.seat_price_cents,0),(pp.seat_price_cents IS NULL)::int FROM partner_extensions x JOIN partner_enrollments pe ON pe.id=x.enrollment_id LEFT JOIN partner_products pp ON pp.organisation_id=pe.organisation_id AND pp.exam_id=pe.exam_id AND pp.months=x.months WHERE NOT pe.sandbox AND x.seat_pack_id IS NULL)
  SELECT to_char(l.month,'YYYY-MM') AS month,o.name AS partner,l.kind,sum(l.seats)::int AS seats,sum(l.cents)::int AS cents,sum(l.unpriced)::int AS unpriced FROM lines l JOIN organisations o ON o.id=l.organisation_id GROUP BY 1,2,3 ORDER BY 1 DESC,2,3 LIMIT 240`);
}

// PART-2 white-label (R3): the partner's display name, logo (an https image address) and brand colour. The colour
// must keep white text readable (contrast 4.5:1), since it is used for buttons on the invite page.
function luminance(hex:string){const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];}
export async function setPartnerBranding(db:Database,actorId:string,orgId:string,input:{brandName:string;logoUrl:string;color:string}) {
 requireId(orgId);await requireSuperAdmin(db,actorId);
 const name=input.brandName.trim()||null,logo=input.logoUrl.trim()||null,color=input.color.trim()||null;
 if(name&&name.length>80)throw new Error('Keep the display name under 80 characters.');
 if(logo){let u:URL;try{u=new URL(logo);}catch{throw new Error('Enter the full logo address, starting https://.');}
  if(u.protocol!=='https:'||!/\.(png|svg|jpe?g|webp)$/i.test(u.pathname))throw new Error('The logo must be an https address of a PNG, SVG, JPG or WebP image.');}
 if(color){if(!/^#[0-9a-fA-F]{6}$/.test(color))throw new Error('Enter the colour as a hex code, for example #1f4e79.');
  if((1.05)/(luminance(color)+0.05)<4.5)throw new Error('This colour is too light for white button text. Choose a darker shade.');}
 await db.query('UPDATE organisations SET brand_name=$2,brand_logo_url=$3,brand_color=$4 WHERE id=$1',[orgId,name,logo,color]);
 await audit(db,actorId,orgId,'partner.branding',null,{name,logo,color});
}

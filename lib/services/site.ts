import type {Database} from '../db/client';
import {requireId} from './studio';
import {trialSettings,type ExamSettings} from './catalogue-admin';
// SEO-6: everything here is public. Only names, counts, sittings, topics, plans and FAQs leave this module;
// question stems, options, explanations and sources never do.
export const examPath=(family:string,exam:string)=>`/${family}/${exam}`;
export const sittingPath=(family:string,exam:string,sitting:string)=>`/${family}/${exam}/${sitting}`;
export type PublicPlan={id:string;months:number;priceCents:number;perMonthCents:number;savingsPercent:number|null;highlighted:boolean;purchasable:boolean};
// SEO-7: price per month, savings against the shortest plan, and the 6-month plan highlighted.
export function planDisplay(plans:{id:string;months:number;priceCents:number;purchasable?:boolean}[]):PublicPlan[] {
 const sorted=[...plans].sort((a,b)=>a.months-b.months),base=sorted[0]?sorted[0].priceCents/sorted[0].months:0;
 return sorted.map(p=>{const perMonth=Math.round(p.priceCents/p.months),saving=base&&p!==sorted[0]?Math.round(100*(1-perMonth/base)):0;return {...p,purchasable:p.purchasable===true,perMonthCents:perMonth,savingsPercent:saving>0?saving:null,highlighted:p.months===6};});
}
type ExamRow={id:string;name:string;description:string;launchStatus:string;familySlug:string;familyName:string;seoSlug:string;settings:ExamSettings;questionCount:number};
const EXAM_SQL=`SELECT e.id,e.name,e.description,e.launch_status AS "launchStatus",f.slug AS "familySlug",f.name AS "familyName",e.seo_slug AS "seoSlug",e.settings,
 (SELECT count(*)::int FROM questions q WHERE q.exam_id=e.id AND q.status='published') AS "questionCount" FROM exams e JOIN exam_families f ON f.id=e.family_id`;
async function trialOffer(db:Database,exam:{id:string;settings:ExamSettings}) {
 const trial=trialSettings(exam.settings);if(!trial.enabled)return null;
 const [pool]=await db.query(`SELECT 1 FROM questions q JOIN question_sittings qs ON qs.question_id=q.id JOIN sittings s ON s.id=qs.sitting_id AND s.trial_pool WHERE q.exam_id=$1 AND q.status='published' LIMIT 1`,[exam.id]);
 return pool?{days:trial.days,questionLimit:trial.questionLimit}:null;
}
export async function listPublicFamilies(db:Database) {
 return db.query<{slug:string;name:string;exams:number}>('SELECT f.slug,f.name,(SELECT count(*)::int FROM exams e WHERE e.family_id=f.id) AS exams FROM exam_families f ORDER BY f.name');
}
export async function getFamilyPage(db:Database,familySlug:string) {
 const [family]=await db.query<{id:string;slug:string;name:string}>('SELECT id,slug,name FROM exam_families WHERE slug=$1',[familySlug]);
 if(!family)return null;
 const exams=await db.query<ExamRow>(`${EXAM_SQL} WHERE e.family_id=$1 ORDER BY e.name`,[family.id]);
 return {...family,exams:await Promise.all(exams.map(async({settings,...e})=>({...e,trial:await trialOffer(db,{id:e.id,settings}),
  sittings:(await db.query<{n:number}>('SELECT count(*)::int AS n FROM sittings WHERE exam_id=$1 AND published',[e.id]))[0].n})))};
}
export async function getExamPage(db:Database,familySlug:string,examSlug:string) {
 const [exam]=await db.query<ExamRow&{blueprint:{count?:number}}>(`${EXAM_SQL.replace('e.settings,','e.settings,e.blueprint,')} WHERE f.slug=$1 AND e.seo_slug=$2`,[familySlug,examSlug]);
 if(!exam)return null;
 const sittings=await db.query<{id:string;slug:string;label:string;year:number;month:number|null;questions:number}>(`SELECT s.id,s.slug,s.label,s.year,s.month,(SELECT count(*)::int FROM question_sittings qs JOIN questions q ON q.id=qs.question_id AND q.status='published' WHERE qs.sitting_id=s.id) AS questions FROM sittings s WHERE s.exam_id=$1 AND s.published ORDER BY s.year DESC,s.month DESC NULLS LAST`,[exam.id]);
 const plans=planDisplay(await db.query<{id:string;months:number;priceCents:number;purchasable:boolean}>('SELECT id,months,price_cents AS "priceCents",stripe_price_id IS NOT NULL AS purchasable FROM plans WHERE exam_id=$1 AND active ORDER BY months',[exam.id]));
 const topics=await db.query<{name:string;questions:number}>(`SELECT COALESCE(p.name,t.name) AS name,count(q.id)::int AS questions FROM questions q JOIN topics t ON t.id=q.topic_id LEFT JOIN topics p ON p.id=t.parent_id WHERE q.exam_id=$1 AND q.status='published' GROUP BY 1 ORDER BY 2 DESC,1 LIMIT 12`,[exam.id]);
 const [{highYield}]=await db.query<{highYield:number}>(`SELECT count(*)::int AS "highYield" FROM questions q WHERE q.exam_id=$1 AND q.status='published' AND (SELECT count(*) FROM question_sittings qs WHERE qs.question_id=q.id)>=$2::int`,[exam.id,Number(exam.settings?.highYieldMin)>=2?Number(exam.settings.highYieldMin):2]);
 const {settings,blueprint,...rest}=exam;
 return {...rest,sittings,plans,topics,highYield,faqs:await listFaqs(db,exam.id),trial:await trialOffer(db,{id:exam.id,settings}),
  format:{questions:Number(blueprint?.count)>0?Number(blueprint.count):null,minutes:Number(settings?.durationMinutes)>0?Number(settings.durationMinutes):null,passMark:Number(settings?.passMarkPercent)>0?Number(settings.passMarkPercent):null}};
}
export async function getSittingPage(db:Database,familySlug:string,examSlug:string,sittingSlug:string) {
 const exam=await getExamPage(db,familySlug,examSlug);
 const sitting=exam?.sittings.find(s=>s.slug===sittingSlug);
 if(!exam||!sitting)return null;
 const topics=await db.query<{name:string;questions:number}>(`SELECT COALESCE(p.name,t.name,'Other') AS name,count(q.id)::int AS questions FROM question_sittings qs JOIN questions q ON q.id=qs.question_id AND q.status='published' LEFT JOIN topics t ON t.id=q.topic_id LEFT JOIN topics p ON p.id=t.parent_id WHERE qs.sitting_id=$1 GROUP BY 1 ORDER BY 2 DESC,1`,[sitting.id]);
 const [{repeats}]=await db.query<{repeats:number}>(`SELECT count(*)::int AS repeats FROM question_sittings qs JOIN questions q ON q.id=qs.question_id AND q.status='published' WHERE qs.sitting_id=$1 AND (SELECT count(*) FROM question_sittings o WHERE o.question_id=qs.question_id)>1`,[sitting.id]);
 return {exam,sitting,topics,repeats};
}
export async function listFaqs(db:Database,examId:string|null) {
 return db.query<{id:string;question:string;answer:string;examId:string|null}>(`SELECT id,question,answer,exam_id AS "examId" FROM faqs WHERE exam_id IS NULL OR exam_id=$1 ORDER BY exam_id IS NULL,sort,created_at`,[examId]);
}
export async function getSitePage(db:Database,slug:string) {
 const [page]=await db.query<{slug:string;title:string;body:string;updatedAt:string}>('SELECT slug,title,body,updated_at::text AS "updatedAt" FROM site_pages WHERE slug=$1',[slug]);
 return page??null;
}
export async function getPageMeta(db:Database,path:string) {
 const [meta]=await db.query<{title:string|null;description:string|null;h1:string|null}>('SELECT title,description,h1 FROM page_meta WHERE path=$1',[path]);
 return {title:meta?.title||null,description:meta?.description||null,h1:meta?.h1||null};
}
export async function findRedirect(db:Database,path:string) {
 const [row]=await db.query<{to:string}>('SELECT to_path AS "to" FROM redirects WHERE from_path=$1',[path.toLowerCase().replace(/\/+$/,'')]);
 return row?.to??null;
}
// SEO-1/SEO-6: past sittings stay listed permanently once published.
export async function sitemapEntries(db:Database) {
 const exams=await db.query<{family:string;exam:string;id:string}>('SELECT f.slug AS family,e.seo_slug AS exam,e.id FROM exams e JOIN exam_families f ON f.id=e.family_id ORDER BY f.slug,e.seo_slug');
 const sittings=await db.query<{family:string;exam:string;sitting:string}>('SELECT f.slug AS family,e.seo_slug AS exam,s.slug AS sitting FROM sittings s JOIN exams e ON e.id=s.exam_id JOIN exam_families f ON f.id=e.family_id WHERE s.published ORDER BY s.year DESC,s.month DESC NULLS LAST');
 const families=[...new Set(exams.map(e=>e.family))];
 return [...families.map(f=>`/${f}`),...exams.map(e=>examPath(e.family,e.exam)),...sittings.map(s=>sittingPath(s.family,s.exam,s.sitting))];
}
// ---- Studio → Website (content managers and Super Admins) ----
async function requireManager(db:Database,actorId:string) {
 const [actor]=await db.query(`SELECT 1 FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1 AND a.status='active' AND u.email_verified=true AND a.role IN ('content_manager','super_admin') AND (a.role<>'super_admin' OR u.two_factor_enabled=true)`,[actorId]);
 if(!actor)throw new Error('Only a content manager can edit the website.');
}
async function audit(db:Database,actorId:string,entity:string,action:string,after:unknown) {
 await db.query('INSERT INTO audit_log(actor_id,entity_id,action,after_json) VALUES($1,$1,$2,$3::jsonb)',[actorId,action,JSON.stringify({entity,...(after as object)})]);
}
const PATH=/^\/[a-z0-9/-]*$/;
export async function savePageMeta(db:Database,actorId:string,input:{path:string;title:string;description:string;h1:string}) {
 const path=input.path.trim().toLowerCase().replace(/(.)\/+$/,'$1');
 if(!PATH.test(path))throw new Error('Choose a valid page.');
 if(input.title.length>70)throw new Error('Keep the title under 70 characters so search results do not cut it off.');
 if(input.description.length>170)throw new Error('Keep the description under 170 characters.');
 if(input.h1.length>120)throw new Error('Keep the heading under 120 characters.');
 return db.transaction(async tx=>{
  await requireManager(tx,actorId);
  const values=[input.title.trim()||null,input.description.trim()||null,input.h1.trim()||null];
  if(values.every(v=>v===null))await tx.query('DELETE FROM page_meta WHERE path=$1',[path]);
  else await tx.query('INSERT INTO page_meta(path,title,description,h1,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(path) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,h1=EXCLUDED.h1,updated_by=EXCLUDED.updated_by,updated_at=now()',[path,...values,actorId]);
  await audit(tx,actorId,path,'website.meta_updated',{title:values[0],description:values[1],h1:values[2]});
 });
}
export async function saveSitePage(db:Database,actorId:string,input:{slug:string;title:string;body:string}) {
 if(!input.title.trim()||input.title.length>120)throw new Error('Give the page a title of up to 120 characters.');
 if(!input.body.trim()||input.body.length>40000)throw new Error('The page text must be between 1 and 40,000 characters.');
 return db.transaction(async tx=>{
  await requireManager(tx,actorId);
  const rows=await tx.query('UPDATE site_pages SET title=$2,body=$3,updated_by=$4,updated_at=now() WHERE slug=$1 RETURNING slug',[input.slug,input.title.trim(),input.body.trim(),actorId]);
  if(!rows.length)throw new Error('Page not found.');
  await audit(tx,actorId,input.slug,'website.page_updated',{title:input.title.trim()});
 });
}
export async function addFaq(db:Database,actorId:string,input:{examId:string|null;question:string;answer:string}) {
 if(input.examId)requireId(input.examId);
 if(!input.question.trim()||input.question.length>300||!input.answer.trim()||input.answer.length>3000)throw new Error('Give a question (up to 300 characters) and an answer (up to 3,000).');
 return db.transaction(async tx=>{
  await requireManager(tx,actorId);
  const [{next}]=await tx.query<{next:number}>('SELECT COALESCE(max(sort),-1)+1 AS next FROM faqs WHERE exam_id IS NOT DISTINCT FROM $1::uuid',[input.examId]);
  await tx.query('INSERT INTO faqs(exam_id,question,answer,sort) VALUES($1,$2,$3,$4)',[input.examId,input.question.trim(),input.answer.trim(),next]);
  await audit(tx,actorId,'faq','website.faq_added',{question:input.question.trim(),examId:input.examId});
 });
}
export async function deleteFaq(db:Database,actorId:string,faqId:string) {
 requireId(faqId);
 return db.transaction(async tx=>{
  await requireManager(tx,actorId);
  const rows=await tx.query<{question:string}>('DELETE FROM faqs WHERE id=$1 RETURNING question',[faqId]);
  if(!rows.length)throw new Error('FAQ not found.');
  await audit(tx,actorId,'faq','website.faq_deleted',{question:rows[0].question});
 });
}
export async function addRedirect(db:Database,actorId:string,input:{from:string;to:string}) {
 const from=input.from.trim().toLowerCase().replace(/\/+$/,''),to=input.to.trim().toLowerCase();
 if(!/^\/[a-z0-9/-]+$/.test(from))throw new Error('The old address must be a path like /old-page, using lowercase letters, numbers and hyphens.');
 if(!/^\/[a-z0-9/#?=&-]*$/.test(to))throw new Error('The new address must be a path on this site, like /mrcog/part-1-recalls.');
 if(from===to.replace(/[#?].*$/,''))throw new Error('A page cannot redirect to itself.');
 return db.transaction(async tx=>{
  await requireManager(tx,actorId);
  if((await tx.query('SELECT 1 FROM redirects WHERE from_path=$1',[to.replace(/[#?].*$/,'')])).length)throw new Error('The new address is itself redirected. Point to the final page instead.');
  await tx.query('INSERT INTO redirects(from_path,to_path,created_by) VALUES($1,$2,$3) ON CONFLICT(from_path) DO UPDATE SET to_path=EXCLUDED.to_path,created_by=EXCLUDED.created_by,created_at=now()',[from,to,actorId]);
  await audit(tx,actorId,from,'website.redirect_saved',{to});
 });
}
export async function deleteRedirect(db:Database,actorId:string,from:string) {
 return db.transaction(async tx=>{
  await requireManager(tx,actorId);
  if(!(await tx.query('DELETE FROM redirects WHERE from_path=$1 RETURNING from_path',[from])).length)throw new Error('Redirect not found.');
  await audit(tx,actorId,from,'website.redirect_deleted',{});
 });
}
export async function getWebsiteAdmin(db:Database,actorId:string) {
 await requireManager(db,actorId);
 const exams=await db.query<{id:string;name:string;family:string;exam:string}>('SELECT e.id,e.name,f.slug AS family,e.seo_slug AS exam FROM exams e JOIN exam_families f ON f.id=e.family_id ORDER BY e.name');
 const sittings=await db.query<{label:string;path:string}>(`SELECT e.name||' · '||s.label AS label,'/'||f.slug||'/'||e.seo_slug||'/'||s.slug AS path FROM sittings s JOIN exams e ON e.id=s.exam_id JOIN exam_families f ON f.id=e.family_id WHERE s.published ORDER BY e.name,s.year DESC,s.month DESC NULLS LAST`);
 const families=await db.query<{label:string;path:string}>(`SELECT name||' (family hub)' AS label,'/'||slug AS path FROM exam_families ORDER BY name`);
 const pages=[{label:'Home',path:'/'},{label:'Pricing',path:'/pricing'},{label:'FAQ',path:'/faq'},...['about','contact','terms','privacy','refund-policy'].map(s=>({label:s.replace('-',' ').replace(/^./,c=>c.toUpperCase()),path:`/${s}`})),...families,...exams.map(e=>({label:e.name,path:examPath(e.family,e.exam)})),...sittings];
 const meta=await db.query<{path:string;title:string|null;description:string|null;h1:string|null}>('SELECT path,title,description,h1 FROM page_meta');
 return {pages:pages.map(p=>({...p,...(meta.find(m=>m.path===p.path)??{title:null,description:null,h1:null})})),
  sitePages:await db.query<{slug:string;title:string;body:string;updatedAt:string}>('SELECT slug,title,body,updated_at::text AS "updatedAt" FROM site_pages ORDER BY slug'),
  faqs:await db.query<{id:string;question:string;answer:string;examId:string|null;exam:string|null}>('SELECT f.id,f.question,f.answer,f.exam_id AS "examId",e.name AS exam FROM faqs f LEFT JOIN exams e ON e.id=f.exam_id ORDER BY e.name NULLS FIRST,f.sort'),
  redirects:await db.query<{from:string;to:string}>('SELECT from_path AS "from",to_path AS "to" FROM redirects ORDER BY from_path'),exams};
}

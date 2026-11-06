import { getDatabase, type Database } from '../db/client';
export type ExamSummary = {id:string;slug:string;familySlug:string;seoSlug:string;name:string;familyName:string;description:string;launchStatus:'planned'|'live';questionCount:number};
export type ExamDetail = ExamSummary & {sittings:{id:string;label:string;slug:string;year:number}[];plans:{id:string;months:number;priceCents:number}[];trial:{days:number;questionLimit:number}|null};
const summarySql = `SELECT e.id,e.slug,f.slug AS "familySlug",e.seo_slug AS "seoSlug",e.name,f.name AS "familyName",e.description,e.launch_status AS "launchStatus",
 (SELECT count(*)::integer FROM questions q WHERE q.exam_id=e.id AND q.status='published' AND q.current_version_id IS NOT NULL) AS "questionCount"
 FROM exams e JOIN exam_families f ON f.id=e.family_id`;
export async function listExams(db: Database = getDatabase()): Promise<ExamSummary[]> {
 return db.query<ExamSummary>(summarySql+' ORDER BY f.name DESC,e.name');
}
export async function getExamBySlug(slug: string, db: Database = getDatabase()): Promise<ExamDetail|null> {
 const [exam] = await db.query<ExamSummary>(summarySql+' WHERE e.slug=$1',[slug]);
 if (!exam) return null;
 const sittings = await db.query<ExamDetail['sittings'][number]>('SELECT id,label,slug,year FROM sittings WHERE exam_id=$1 AND published=true ORDER BY year DESC,starts_on DESC NULLS LAST',[exam.id]);
 const plans = await db.query<ExamDetail['plans'][number]>('SELECT id,months,price_cents AS "priceCents" FROM plans WHERE exam_id=$1 AND active=true ORDER BY months',[exam.id]);
 // The public page only learns whether a trial is offered, never which questions are in its pool.
 const [trial] = await db.query<{settings:{trial?:{enabled?:boolean;days?:number;questionLimit?:number}};pool:boolean}>(`SELECT e.settings,EXISTS(SELECT 1 FROM questions q JOIN question_sittings qs ON qs.question_id=q.id JOIN sittings s ON s.id=qs.sitting_id AND s.trial_pool WHERE q.exam_id=e.id AND q.status='published') AS pool FROM exams e WHERE e.id=$1`,[exam.id]);
 const offer = trial.settings?.trial?.enabled===true && trial.pool ? {days:trial.settings.trial.days??3,questionLimit:trial.settings.trial.questionLimit??50} : null;
 return {...exam,sittings,plans,trial:offer};
}

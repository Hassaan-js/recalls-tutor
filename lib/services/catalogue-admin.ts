import type {Database} from '../db/client';
import {requireId} from './studio';
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
async function requireRole(db:Database,actorId:string,roles:string[]) {
 const [actor]=await db.query<{role:string}>(`SELECT a.role FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1 AND a.status='active' AND u.email_verified=true AND (a.role<>'super_admin' OR u.two_factor_enabled=true)`,[actorId]);
 if(!actor||!roles.includes(actor.role))throw new Error('You do not have permission for this action.');
 return actor.role;
}
const MANAGERS=['content_manager','super_admin'];
async function audit(db:Database,actorId:string,entityId:string,action:string,before:unknown,after:unknown) {
 await db.query('INSERT INTO audit_log(actor_id,entity_id,action,before_json,after_json) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',[actorId,entityId,action,JSON.stringify(before),JSON.stringify(after)]);
}
export function slugify(value:string) {return value.toLowerCase().normalize('NFKD').replace(/[^\p{L}\d]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,80);}
export type TrialSettings={enabled:boolean;days:number;questionLimit:number;mockSize:number};
export type ExamSettings={durationMinutes?:number;passMarkPercent?:number;highYieldMin?:number;needsExpertBelow?:number;duplicateFlagAbove?:number;approvedSources?:string[];styleProfile?:{tone?:string;stemLength?:string;guidelineSources?:string[];notes?:string};trial?:TrialSettings};
// PRD TRIAL-1 defaults; every value is editable per exam by a Super Admin.
export const TRIAL_DEFAULTS:TrialSettings={enabled:false,days:3,questionLimit:50,mockSize:25};
export function trialSettings(settings:ExamSettings):TrialSettings {return {...TRIAL_DEFAULTS,...(settings?.trial??{})};}
export type CatalogueExam={id:string;name:string;slug:string;questionCount:number|null;settings:ExamSettings;
 sittings:{id:string;label:string;slug:string;year:number;month:number|null;published:boolean;trialPool:boolean;questions:number}[];
 topics:{id:string;name:string;parentId:string|null;questions:number}[]};
export async function getCatalogueAdmin(db:Database,actorId:string):Promise<CatalogueExam[]> {
 await requireRole(db,actorId,['reviewer',...MANAGERS]);
 const exams=await db.query<{id:string;name:string;slug:string;blueprint:{count?:number};settings:ExamSettings}>('SELECT id,name,slug,blueprint,settings FROM exams ORDER BY name');
 return Promise.all(exams.map(async e=>({id:e.id,name:e.name,slug:e.slug,settings:e.settings??{},questionCount:Number(e.blueprint?.count)>0?Number(e.blueprint.count):null,
  sittings:await db.query(`SELECT s.id,s.label,s.slug,s.year,s.month,s.published,s.trial_pool AS "trialPool",(SELECT count(*)::int FROM question_sittings qs WHERE qs.sitting_id=s.id) AS questions FROM sittings s WHERE s.exam_id=$1 ORDER BY s.year DESC,s.month DESC NULLS LAST`,[e.id]),
  topics:await db.query(`SELECT t.id,t.name,t.parent_id AS "parentId",(SELECT count(*)::int FROM questions q WHERE q.topic_id=t.id) AS questions FROM topics t WHERE t.exam_id=$1 ORDER BY t.name`,[e.id])})));
}
function optionalNumber(value:unknown,min:number,max:number,label:string,integer=true) {
 if(value===null||value===undefined||value==='')return undefined;
 const n=Number(value);if(!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n)))throw new Error(`${label} must be between ${min} and ${max}.`);
 return n;
}
// Exam timing and pass marks are entered by the content team; nothing is assumed when a field is left blank.
export async function updateExamSettings(db:Database,actorId:string,examId:string,input:{questionCount:unknown;durationMinutes:unknown;passMarkPercent:unknown;highYieldMin:unknown;needsExpertBelow:unknown;approvedSources:string[];styleNotes:string;trial?:{enabled:boolean;days:unknown;questionLimit:unknown;mockSize:unknown}}) {
 requireId(examId);
 if(input.approvedSources.length>50||input.approvedSources.some(s=>s.length>300))throw new Error('Approved sources: up to 50 lines of 300 characters.');
 if(input.styleNotes.length>4000)throw new Error('Style notes must be under 4,000 characters.');
 const count=optionalNumber(input.questionCount,1,1000,'Questions per paper'),duration=optionalNumber(input.durationMinutes,1,600,'Duration'),pass=optionalNumber(input.passMarkPercent,1,100,'Pass mark',false);
 const highYield=optionalNumber(input.highYieldMin,2,20,'High-yield threshold'),expert=optionalNumber(input.needsExpertBelow,1,100,'Expert-review threshold');
 return db.transaction(async tx=>{
  const role=await requireRole(tx,actorId,MANAGERS);
  const [exam]=await tx.query<{blueprint:Record<string,unknown>;settings:ExamSettings}>('SELECT blueprint,settings FROM exams WHERE id=$1 FOR UPDATE',[examId]);
  if(!exam)throw new Error('Exam not found.');
  const settings:ExamSettings={...exam.settings};
  const set=<K extends keyof ExamSettings>(key:K,value:ExamSettings[K]|undefined)=>{if(value===undefined)delete settings[key];else settings[key]=value;};
  set('durationMinutes',duration);set('passMarkPercent',pass);set('highYieldMin',highYield);set('needsExpertBelow',expert);
  set('approvedSources',input.approvedSources.length?input.approvedSources:undefined);
  set('styleProfile',input.styleNotes.trim()?{...(settings.styleProfile??{}),notes:input.styleNotes.trim()}:undefined);
  if(input.trial) {
   if(role!=='super_admin')throw new Error('Only a Super Admin can change free-trial settings.');
   settings.trial={enabled:input.trial.enabled===true,days:optionalNumber(input.trial.days,1,30,'Trial days')??TRIAL_DEFAULTS.days,questionLimit:optionalNumber(input.trial.questionLimit,1,500,'Trial question limit')??TRIAL_DEFAULTS.questionLimit,mockSize:optionalNumber(input.trial.mockSize,1,200,'Trial mini mock size')??TRIAL_DEFAULTS.mockSize};
  }
  const blueprint={...exam.blueprint};if(count===undefined)delete blueprint.count;else blueprint.count=count;
  await tx.query('UPDATE exams SET settings=$2::jsonb,blueprint=$3::jsonb WHERE id=$1',[examId,JSON.stringify(settings),JSON.stringify(blueprint)]);
  await audit(tx,actorId,examId,'exam.settings_updated',{settings:exam.settings,blueprint:exam.blueprint},{settings,blueprint});
 });
}
export async function createSitting(db:Database,actorId:string,input:{examId:string;year:number;month:number;label:string}) {
 requireId(input.examId);
 if(!Number.isInteger(input.year)||input.year<1990||input.year>2100||!Number.isInteger(input.month)||input.month<1||input.month>12)throw new Error('Choose a valid month and year.');
 const label=(input.label.trim()||`${MONTHS[input.month-1]} ${input.year}`).slice(0,120),slug=slugify(label);
 if(!slug)throw new Error('Provide a sitting label.');
 return db.transaction(async tx=>{
  await requireRole(tx,actorId,MANAGERS);
  if((await tx.query('SELECT 1 FROM sittings WHERE exam_id=$1 AND slug=$2',[input.examId,slug])).length)throw new Error('This exam already has a sitting with that name.');
  const [sitting]=await tx.query<{id:string}>('INSERT INTO sittings(exam_id,slug,label,year,month,starts_on) VALUES($1,$2,$3,$4,$5,make_date($4,$5,1)) RETURNING id',[input.examId,slug,label,input.year,input.month]);
  await audit(tx,actorId,sitting.id,'sitting.created',null,{examId:input.examId,label,year:input.year,month:input.month});
  return sitting.id;
 });
}
export async function updateSitting(db:Database,actorId:string,sittingId:string,changes:{published?:boolean;trialPool?:boolean}) {
 requireId(sittingId);
 return db.transaction(async tx=>{
  await requireRole(tx,actorId,MANAGERS);
  const [before]=await tx.query<{published:boolean;trial_pool:boolean}>('SELECT published,trial_pool FROM sittings WHERE id=$1 FOR UPDATE',[sittingId]);
  if(!before)throw new Error('Sitting not found.');
  const published=changes.published??before.published,trialPool=changes.trialPool??before.trial_pool;
  await tx.query('UPDATE sittings SET published=$2,trial_pool=$3 WHERE id=$1',[sittingId,published,trialPool]);
  await audit(tx,actorId,sittingId,'sitting.updated',before,{published,trial_pool:trialPool});
 });
}
export async function createTopic(db:Database,actorId:string,input:{examId:string;name:string;parentId:string|null}) {
 requireId(input.examId);if(input.parentId)requireId(input.parentId);
 const name=input.name.trim().slice(0,120),slug=slugify(input.parentId?`${input.parentId.slice(0,8)} ${name}`:name);
 if(!name)throw new Error('Provide a topic name.');
 return db.transaction(async tx=>{
  await requireRole(tx,actorId,MANAGERS);
  if(input.parentId&&!(await tx.query('SELECT 1 FROM topics WHERE id=$1 AND exam_id=$2 AND parent_id IS NULL',[input.parentId,input.examId])).length)throw new Error('Choose a top-level topic from the same exam as the parent.');
  if((await tx.query('SELECT 1 FROM topics WHERE exam_id=$1 AND lower(name)=lower($2) AND parent_id IS NOT DISTINCT FROM $3::uuid',[input.examId,name,input.parentId])).length)throw new Error('This topic already exists.');
  const [topic]=await tx.query<{id:string}>('INSERT INTO topics(exam_id,parent_id,name,slug) VALUES($1,$2,$3,$4) RETURNING id',[input.examId,input.parentId,name,slug]);
  await audit(tx,actorId,topic.id,'topic.created',null,{examId:input.examId,name,parentId:input.parentId});
  return topic.id;
 });
}
// Topic choices for an exam, labelled "Parent › Child" so the controlled list is unambiguous for people and Claude.
export async function topicOptions(db:Database,examId:string) {
 return db.query<{id:string;label:string}>(`SELECT t.id,CASE WHEN p.id IS NULL THEN t.name ELSE p.name||' › '||t.name END AS label FROM topics t LEFT JOIN topics p ON p.id=t.parent_id WHERE t.exam_id=$1 ORDER BY COALESCE(p.name,t.name),p.name IS NOT NULL,t.name`,[examId]);
}
// R3 "more exam families": a Super Admin adds an exam (and its family when new). It starts as planned, with no
// timings, prices or trial, so nothing is sold or shown as ready until staff configure it.
export async function createExam(db:Database,actorId:string,input:{familySlug:string;familyName:string;name:string;slug:string;description:string}) {
 const family=slugify(input.familySlug),name=input.name.trim(),slug=slugify(input.slug||`${family}-${name}`),description=input.description.trim();
 if(!family)throw new Error('Choose or name the exam family, for example mrcog.');
 if(!name||name.length>120)throw new Error('Give the exam a name of up to 120 characters.');
 if(!description||description.length>600)throw new Error('Describe the exam in up to 600 characters. It appears on its website page.');
 if(!slug.startsWith(`${family}-`))throw new Error(`The exam address must start with the family, for example ${family}-part-1.`);
 return db.transaction(async tx=>{
  await requireRole(tx,actorId,['super_admin']);
  let [fam]=await tx.query<{id:string}>('SELECT id FROM exam_families WHERE slug=$1',[family]);
  if(!fam){const familyName=input.familyName.trim();if(!familyName||familyName.length>80)throw new Error('Name the new exam family, for example MRCOG.');
   [fam]=await tx.query<{id:string}>('INSERT INTO exam_families(slug,name) VALUES($1,$2) RETURNING id',[family,familyName]);}
  if((await tx.query('SELECT 1 FROM exams WHERE slug=$1',[slug])).length)throw new Error('An exam with this address already exists.');
  const seo=`${slug.slice(family.length+1)}-recalls`;
  const [exam]=await tx.query<{id:string}>(`INSERT INTO exams(family_id,slug,name,description,seo_slug) VALUES($1,$2,$3,$4,$5) RETURNING id`,[fam.id,slug,name,description,seo]);
  await audit(tx,actorId,exam.id,'exam.created',null,{family,slug,name});
  return {id:exam.id,slug};
 });
}

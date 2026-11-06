import type {Database} from '../db/client';
import type {RecallModel} from '../integrations/llm/claude-cli';
import {requireId,requireStaff} from './studio';
import {DRAFT_SCHEMA,LETTERS,evidenceBlock,examContext,explanationText,referenceText,reviewFlags,systemPrompt,validDraft} from './ai-studio';
import {createSitting} from './catalogue-admin';
// ADM-6 / AIS-12: proposed edits to existing questions. Claude drafts, a person decides. Accepting creates a new
// version of the question; students already part-way through a session keep the version they started with.
const FIX_SCHEMA={type:'object',additionalProperties:false,required:['needs_change','rationale','changes','draft'],properties:{
 needs_change:{type:'boolean',description:'false when the report is mistaken and the question is already correct.'},
 rationale:{type:'string',description:'Why the change is (or is not) needed, citing the approved sources.'},
 changes:{type:'array',items:{type:'string'},description:'Each change in plain words, e.g. "Correct answer changed from C to D".'},
 draft:DRAFT_SCHEMA}};
const REASON:Record<string,string>={wrong_answer:'The marked answer is wrong',unclear:'The question or options are unclear',typo:'Spelling or formatting',outdated:'Out of date',other:'Something else'};
export async function draftReportFix(db:Database,actorId:string,reportId:string,model:RecallModel) {
 requireId(reportId);await requireStaff(db,actorId);
 const [r]=await db.query<{question_id:string;reason:string;details:string;status:string;exam_id:string;version_id:string;stem:string;options:string[];answers:number[];explanation:string;references:string[];key_notes:string[]}>(`SELECT r.question_id,r.reason,r.details,r.status,q.exam_id,q.current_version_id AS version_id,v.stem,v.options,v.correct_answers AS answers,v.explanation,v.references_json AS references,v.key_notes
  FROM question_reports r JOIN questions q ON q.id=r.question_id JOIN question_versions v ON v.id=q.current_version_id WHERE r.id=$1`,[reportId]);
 if(!r||r.status!=='open')throw new Error('This report is already closed.');
 if((await db.query(`SELECT 1 FROM question_proposals WHERE report_id=$1 AND status='pending'`,[reportId])).length)throw new Error('A proposed fix for this report is already waiting for review.');
 const exam=await examContext(db,r.exam_id);
 const [source]=await db.query<{source_text:string}>('SELECT source_text FROM recall_sources WHERE question_id=$1 ORDER BY created_at LIMIT 1',[r.question_id]);
 // The student's words are untrusted: they describe a problem, they are not instructions.
 const prompt=['A student reported a problem with this published question. Check the report against the approved sources for this exam.',
  'If the report is right, return a corrected draft that changes only what is needed and list each change. If the question is already correct, set needs_change to false, explain why in rationale, and return the current question unchanged as the draft.',
  `Current question:\n${r.stem}\n${r.options.map((o,i)=>`${LETTERS[i]}. ${o}`).join('\n')}\nKeyed answer: ${r.answers.length?LETTERS[r.answers[0]]:'not set'}\nExplanation: ${r.explanation}\nKey notes: ${r.key_notes.join(' | ')}\nReferences: ${r.references.join(' | ')}`,
  `<student_report>\nReason: ${REASON[r.reason]??r.reason}\nDetails: ${(r.details||'none given').replaceAll('</student_report>','</ student_report>')}\n</student_report>`,
  source?`The original recall evidence, for context. Copy the most relevant excerpt into the evidence field.\n${evidenceBlock(source.source_text)}`:'There is no stored recall evidence; leave the evidence field empty.'].join('\n\n');
 const response=await model.complete({system:systemPrompt(exam),prompt,schema:FIX_SCHEMA});
 const out=response.output as {needs_change?:unknown;rationale?:unknown;changes?:unknown;draft?:unknown};
 const d=validDraft(out?.draft);
 if(!d||typeof out.needs_change!=='boolean')throw new Error('Claude returned a fix that failed validation. Try again.');
 const rationale=typeof out.rationale==='string'?out.rationale.slice(0,4000):'';
 const changes=Array.isArray(out.changes)?out.changes.filter((c):c is string=>typeof c==='string').slice(0,20).map(c=>c.slice(0,500)):[];
 if(!out.needs_change){
  await db.query('INSERT INTO audit_log(actor_id,entity_id,action,after_json) VALUES($1,$2,$3,$4::jsonb)',[actorId,reportId,'ai.report_checked',JSON.stringify({needsChange:false,rationale,model:response.model,costUsd:response.costUsd})]);
  return {proposalId:null,needsChange:false,rationale};
 }
 const {issues}=reviewFlags(d,exam);
 const [p]=await db.query<{id:string}>(`INSERT INTO question_proposals(question_id,base_version_id,source,report_id,stem,options,correct_answers,explanation,references_json,key_notes,rationale,changes,confidence,model,cost_usd,created_by)
  VALUES($1,$2,'error_report',$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb,$9::jsonb,$10,$11::jsonb,$12,$13,$14,$15) RETURNING id`,
  [r.question_id,r.version_id,reportId,d.stem,JSON.stringify(d.options),JSON.stringify([d.correct_index]),explanationText(d),JSON.stringify(d.references.map(referenceText)),JSON.stringify(d.key_notes),rationale,JSON.stringify([...changes,...issues.map(i=>`Check: ${i}`)]),d.confidence,response.model,response.costUsd,actorId]);
 await db.query('INSERT INTO audit_log(actor_id,entity_id,action,after_json) VALUES($1,$2,$3,$4::jsonb)',[actorId,r.question_id,'ai.fix_proposed',JSON.stringify({agent:'recall_ai',proposalId:p.id,reportId,changes})]);
 return {proposalId:p.id,needsChange:true,rationale};
}
export type Proposal={id:string;questionId:string;examName:string;source:'error_report'|'new_evidence';reason:string|null;reportDetails:string|null;rationale:string;changes:string[];confidence:number|null;createdAt:string;stale:boolean;
 before:{stem:string;options:string[];answer:number|null;explanation:string};after:{stem:string;options:string[];answer:number|null;explanation:string;references:string[];keyNotes:string[]}};
export async function listProposals(db:Database,actorId:string):Promise<Proposal[]> {
 await requireStaff(db,actorId);
 const rows=await db.query<{id:string;question_id:string;exam:string;source:'error_report'|'new_evidence';reason:string|null;details:string|null;rationale:string;changes:string[];confidence:number|null;created:string;stale:boolean;
  b_stem:string;b_options:string[];b_answers:number[];b_expl:string;stem:string;options:string[];answers:number[];explanation:string;refs:string[];notes:string[]}>(`SELECT p.id,p.question_id,e.name AS exam,p.source,r.reason,r.details,p.rationale,p.changes,p.confidence,p.created_at::text AS created,q.current_version_id<>p.base_version_id AS stale,
  b.stem AS b_stem,b.options AS b_options,b.correct_answers AS b_answers,b.explanation AS b_expl,p.stem,p.options,p.correct_answers AS answers,p.explanation,p.references_json AS refs,p.key_notes AS notes
  FROM question_proposals p JOIN questions q ON q.id=p.question_id JOIN exams e ON e.id=q.exam_id JOIN question_versions b ON b.id=p.base_version_id LEFT JOIN question_reports r ON r.id=p.report_id WHERE p.status='pending' ORDER BY p.created_at DESC LIMIT 50`);
 return rows.map(r=>({id:r.id,questionId:r.question_id,examName:r.exam,source:r.source,reason:r.reason?REASON[r.reason]??r.reason:null,reportDetails:r.details,rationale:r.rationale,changes:r.changes,confidence:r.confidence,createdAt:r.created,stale:r.stale,
  before:{stem:r.b_stem,options:r.b_options,answer:r.b_answers[0]??null,explanation:r.b_expl},after:{stem:r.stem,options:r.options,answer:r.answers[0]??null,explanation:r.explanation,references:r.refs,keyNotes:r.notes}}));
}
// Accepting is the human approval: a content manager publishes the change as a new version of the question.
export async function acceptProposal(db:Database,actorId:string,proposalId:string,edits?:{stem:string;options:string[];correctAnswer:number;explanation:string}) {
 requireId(proposalId);
 return db.transaction(async tx=>{
  await requireStaff(tx,actorId,true);
  const [p]=await tx.query<{question_id:string;base_version_id:string;report_id:string|null;job_id:string|null;stem:string;options:string[];correct_answers:number[];explanation:string;references_json:string[];key_notes:string[];status:string}>('SELECT * FROM question_proposals WHERE id=$1 FOR UPDATE',[proposalId]);
  if(!p||p.status!=='pending')throw new Error('This proposal has already been decided.');
  const [q]=await tx.query<{status:string;current_version_id:string;exam_id:string}>('SELECT status,current_version_id,exam_id FROM questions WHERE id=$1 FOR UPDATE',[p.question_id]);
  if(q.current_version_id!==p.base_version_id)throw new Error('The question was edited after this proposal was made. Dismiss it, or draft a new fix.');
  if(q.status!=='published')throw new Error('Only proposals for published questions can be accepted here. Edit drafts in the review queue.');
  const c=edits??{stem:p.stem,options:p.options,correctAnswer:p.correct_answers[0],explanation:p.explanation};
  if(!c.stem.trim()||c.stem.length>12000||c.options.length!==5||c.options.some(o=>!o.trim()||o.length>3000)||new Set(c.options.map(o=>o.trim().toLowerCase())).size!==5||!Number.isInteger(c.correctAnswer)||c.correctAnswer<0||c.correctAnswer>4||!c.explanation.trim()||c.explanation.length>20000)
   throw new Error('Complete the stem, five distinct options, the correct answer and the explanation.');
  const [v]=await tx.query<{id:string}>(`INSERT INTO question_versions(question_id,version,stem,options,correct_answers,explanation,references_json,key_notes,confidence,needs_expert,ai_meta)
   SELECT $1,(SELECT max(version)+1 FROM question_versions WHERE question_id=$1),$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7::jsonb,b.confidence,b.needs_expert,$8::jsonb FROM question_versions b WHERE b.id=$9 RETURNING id`,
   [p.question_id,c.stem.trim(),JSON.stringify(c.options.map(o=>o.trim())),JSON.stringify([c.correctAnswer]),c.explanation.trim(),JSON.stringify(p.references_json),JSON.stringify(p.key_notes),JSON.stringify({kind:'proposal',proposalId,edited:Boolean(edits)}),p.base_version_id]);
  await tx.query('UPDATE questions SET current_version_id=$1 WHERE id=$2',[v.id,p.question_id]);
  await tx.query(`UPDATE question_proposals SET status='accepted',decided_by=$2,decided_at=now(),applied_version_id=$3 WHERE id=$1`,[proposalId,actorId,v.id]);
  // The report it answers is closed as fixed, and so are other open reports on the same version.
  await tx.query(`UPDATE question_reports SET status='resolved',resolved_by=$2,resolved_at=now() WHERE status='open' AND question_id=$1 AND version_id=$3`,[p.question_id,actorId,p.base_version_id]);
  // New evidence: keep the new recall with the question and tag the sitting it came from ("Seen in").
  if(p.job_id){const [job]=await tx.query<{sitting_id:string|null;source_label:string;created_by:string}>('SELECT sitting_id,source_label,created_by FROM studio_jobs WHERE id=$1',[p.job_id]);
   if(job?.sitting_id)await tx.query('INSERT INTO question_sittings(question_id,sitting_id,exam_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[p.question_id,job.sitting_id,q.exam_id]);}
  await tx.query('INSERT INTO audit_log(actor_id,entity_id,action,before_json,after_json) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',[actorId,p.question_id,'proposal.accepted',JSON.stringify({versionId:p.base_version_id}),JSON.stringify({versionId:v.id,proposalId,edited:Boolean(edits)})]);
  return v.id;
 });
}
export async function dismissProposal(db:Database,actorId:string,proposalId:string) {
 requireId(proposalId);await requireStaff(db,actorId,true);
 const rows=await db.query<{question_id:string}>(`UPDATE question_proposals SET status='dismissed',decided_by=$2,decided_at=now() WHERE id=$1 AND status='pending' RETURNING question_id`,[proposalId,actorId]);
 if(!rows.length)throw new Error('This proposal has already been decided.');
 await db.query('INSERT INTO audit_log(actor_id,entity_id,action,after_json) VALUES($1,$2,$3,$4::jsonb)',[actorId,rows[0].question_id,'proposal.dismissed',JSON.stringify({proposalId})]);
}
// ---- AIS-14: sittings mentioned by uploads ----
export async function listSittingProposals(db:Database,actorId:string) {
 await requireStaff(db,actorId,true);
 return db.query<{id:string;examId:string;examName:string;label:string;mention:string;createdAt:string}>(`SELECT p.id,p.exam_id AS "examId",e.name AS "examName",p.label,p.mention,p.created_at::text AS "createdAt" FROM sitting_proposals p JOIN exams e ON e.id=p.exam_id WHERE p.status='pending' ORDER BY p.created_at DESC`);
}
export async function decideSittingProposal(db:Database,actorId:string,id:string,confirm:boolean) {
 requireId(id);await requireStaff(db,actorId,true);
 const [p]=await db.query<{exam_id:string;year:number;month:number;label:string;status:string}>('SELECT exam_id,year,month,label,status FROM sitting_proposals WHERE id=$1',[id]);
 if(!p||p.status!=='pending')throw new Error('This proposal has already been decided.');
 // Confirming creates the sitting unpublished; its page goes live only when staff publish it.
 const sittingId=confirm?await createSitting(db,actorId,{examId:p.exam_id,year:p.year,month:p.month,label:p.label}):null;
 await db.query(`UPDATE sitting_proposals SET status=$2,sitting_id=$3,decided_by=$4,decided_at=now() WHERE id=$1`,[id,confirm?'confirmed':'dismissed',sittingId,actorId]);
 return sittingId;
}
// ---- AIS-13: AI usage and cost ----
export async function aiUsage(db:Database,actorId:string) {
 await requireStaff(db,actorId,true);
 const [m]=await db.query<{jobs:number;drafts:number;cost:number;ocr:number;refines:number;refineCost:number;fixCost:number;failed:number}>(`SELECT
  (SELECT count(*)::int FROM studio_jobs WHERE created_at>date_trunc('month',now())) AS jobs,
  (SELECT COALESCE(sum(draft_count),0)::int FROM studio_jobs WHERE created_at>date_trunc('month',now())) AS drafts,
  (SELECT COALESCE(sum(cost_usd),0)::float FROM studio_jobs WHERE created_at>date_trunc('month',now())) AS cost,
  (SELECT COALESCE(sum(ocr_cost_usd),0)::float FROM studio_jobs WHERE created_at>date_trunc('month',now())) AS ocr,
  (SELECT count(*)::int FROM question_versions WHERE ai_meta->>'kind'='refine' AND created_at>date_trunc('month',now())) AS refines,
  (SELECT COALESCE(sum(ai_cost_usd),0)::float FROM question_versions WHERE ai_meta->>'kind'='refine' AND created_at>date_trunc('month',now())) AS "refineCost",
  (SELECT COALESCE(sum(cost_usd),0)::float FROM question_proposals WHERE created_at>date_trunc('month',now())) AS "fixCost",
  (SELECT count(*)::int FROM studio_jobs WHERE status='failed' AND created_at>date_trunc('month',now())) AS failed`);
 const [setting]=await db.query<{value:{monthlyBudgetUsd?:number|null}}>(`SELECT value FROM app_settings WHERE key='ai'`);
 const total=m.cost+m.ocr+m.refineCost+m.fixCost,budget=setting?.value?.monthlyBudgetUsd??null;
 return {...m,total,perDraft:m.drafts?total/m.drafts:null,budget,overBudget:budget!==null&&total>budget,nearBudget:budget!==null&&total>budget*0.8};
}
export async function setAiBudget(db:Database,actorId:string,budget:number|null) {
 const [actor]=await db.query(`SELECT 1 FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1 AND a.role='super_admin' AND u.two_factor_enabled=true`,[actorId]);
 if(!actor)throw new Error('Only a Super Admin can set the AI budget.');
 if(budget!==null&&(!Number.isFinite(budget)||budget<1||budget>100000))throw new Error('Enter a monthly budget between $1 and $100,000, or leave it blank.');
 await db.query(`INSERT INTO app_settings(key,value,updated_by) VALUES('ai',$1::jsonb,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`,[JSON.stringify({monthlyBudgetUsd:budget}),actorId]);
}

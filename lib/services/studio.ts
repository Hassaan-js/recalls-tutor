import type {Database} from '../db/client';
type StaffRole='reviewer'|'content_manager'|'super_admin';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requireId(value:string) {if(!uuid.test(value)) throw new Error('Invalid record identifier.');}
export async function requireStaff(db:Database,actorId:string,manager=false):Promise<StaffRole> {
 const [actor]=await db.query<{role:StaffRole}>(`SELECT a.role FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1 AND a.status='active' AND u.email_verified=true AND (a.role<>'super_admin' OR u.two_factor_enabled=true) FOR SHARE OF a,u`,[actorId]);
 if(!actor || !(manager?['content_manager','super_admin']:['reviewer','content_manager','super_admin']).includes(actor.role)) throw new Error('You do not have permission for this action.');
 return actor.role;
}
async function audit(db:Database,actorId:string,id:string,action:string,before:unknown,after:unknown) {
 await db.query('INSERT INTO audit_log(actor_id,entity_id,action,before_json,after_json) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',[actorId,id,action,JSON.stringify(before),JSON.stringify(after)]);
}
export type DraftInput={stem:string;options:string[];correctAnswer:number|null;explanation:string;references:string[];keyNotes?:string[]};
function validateDraft(draft:DraftInput,complete=false) {
 if(draft.stem.length>12000 || draft.explanation.length>20000 || draft.options.length!==5 || draft.options.some(o=>o.length>3000) || draft.references.length>20 || draft.references.some(r=>r.length>2000)||(draft.keyNotes??[]).length>10||(draft.keyNotes??[]).some(n=>n.length>1000)) throw new Error('Draft exceeds the supported field limits.');
 if(draft.correctAnswer!==null && (!Number.isInteger(draft.correctAnswer)||draft.correctAnswer<0||draft.correctAnswer>4)) throw new Error('Choose a valid correct answer.');
 if(complete && (!draft.stem.trim()||draft.options.some(o=>!o.trim())||draft.correctAnswer===null||!draft.explanation.trim()||!draft.references.some(r=>r.trim()))) throw new Error('Complete the stem, five options, correct answer, explanation and references before review.');
 if(complete && new Set(draft.options.map(o=>o.trim().toLowerCase())).size!==5) throw new Error('Each answer option must be distinct.');
}
export async function createRecall(db:Database,actorId:string,input:{examId:string;sourceLabel:string;sourceText:string;requestId:string}) {
 requireId(input.examId);requireId(input.requestId);
 if(!input.sourceText.trim()||input.sourceText.length>50000||!input.sourceLabel.trim()||input.sourceLabel.length>200) throw new Error('Provide a source label (up to 200 characters) and recall text (up to 50,000 characters).');
 return db.transaction(async tx=>{
  await requireStaff(tx,actorId,true);
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[actorId+input.requestId]);
  const [existing]=await tx.query<{question_id:string;source_text:string;source_label:string;exam_id:string}>('SELECT s.question_id,s.source_text,s.source_label,q.exam_id FROM recall_sources s JOIN questions q ON q.id=s.question_id WHERE s.created_by=$1 AND s.request_id=$2',[actorId,input.requestId]);
  if(existing) {
   if(existing.source_text!==input.sourceText||existing.source_label!==input.sourceLabel.trim()||existing.exam_id!==input.examId) throw new Error('This request was already used for another recall.');
   return existing.question_id;
  }
  if(!(await tx.query('SELECT id FROM exams WHERE id=$1',[input.examId])).length) throw new Error('Exam not found.');
  const [question]=await tx.query<{id:string}>('INSERT INTO questions(exam_id) VALUES($1) RETURNING id',[input.examId]);
  const [version]=await tx.query<{id:string}>(`INSERT INTO question_versions(question_id,version,stem,options,correct_answers,explanation) VALUES($1,1,'','["","","","",""]','[]','') RETURNING id`,[question.id]);
  await tx.query('UPDATE questions SET current_version_id=$1 WHERE id=$2',[version.id,question.id]);
  await tx.query('INSERT INTO recall_sources(question_id,source_text,source_label,created_by,request_id) VALUES($1,$2,$3,$4,$5)',[question.id,input.sourceText,input.sourceLabel.trim(),actorId,input.requestId]);
  await audit(tx,actorId,question.id,'recall.created',null,{versionId:version.id,status:'raw'});
  return question.id;
 });
}
export type AiMeta={kind:'job'|'refine';model:string;topic?:string;difficulty?:string;answerBasis?:string;issues:string[];distractorRationales?:string[];duplicateOf?:string|null;proposedTopic?:string|null;instruction?:string|null;generatedAt:string;editedByHuman?:boolean};
export type StudioQuestion={id:string;examId:string;publicSample:boolean;examName:string;status:string;versionId:string;version:number;stem:string;options:string[];correctAnswer:number|null;explanation:string;references:string[];keyNotes:string[];confidence:number|null;needsExpert:boolean;aiMeta:AiMeta|null;jobId:string|null;sourceText:string;sourceLabel:string;topicId:string|null;difficulty:string|null;sittingIds:string[];history:{version:number;createdAt:string}[]};
export async function listStudioQuestions(db:Database,actorId:string) {
 await requireStaff(db,actorId);
 // REV-1: open work first, lowest confidence first, so uncertain drafts get attention early.
 return db.query<{id:string;examName:string;status:string;stem:string;version:number;confidence:number|null;needsExpert:boolean;ai:boolean}>(`SELECT q.id,e.name AS "examName",q.status,v.stem,v.version,v.confidence,v.needs_expert AS "needsExpert",v.ai_meta IS NOT NULL AS ai FROM questions q JOIN exams e ON e.id=q.exam_id JOIN question_versions v ON v.id=q.current_version_id JOIN recall_sources s ON s.question_id=q.id ORDER BY q.status IN ('published','retired','rejected'),q.status='approved',v.confidence ASC NULLS LAST,s.created_at DESC LIMIT 100`);
}
export async function getStudioQuestion(db:Database,actorId:string,id:string):Promise<StudioQuestion|null> {
 requireId(id);await requireStaff(db,actorId);
 const [row]=await db.query<StudioQuestion & {answers:number[]}>(`SELECT q.id,q.exam_id AS "examId",q.public_sample AS "publicSample",e.name AS "examName",q.status,q.topic_id AS "topicId",q.difficulty,ARRAY(SELECT qs.sitting_id::text FROM question_sittings qs WHERE qs.question_id=q.id) AS "sittingIds",v.id AS "versionId",v.version,v.stem,v.options,v.correct_answers AS answers,v.explanation,v.references_json AS references,v.key_notes AS "keyNotes",v.confidence,v.needs_expert AS "needsExpert",v.ai_meta AS "aiMeta",s.job_id AS "jobId",s.source_text AS "sourceText",s.source_label AS "sourceLabel" FROM questions q JOIN exams e ON e.id=q.exam_id JOIN question_versions v ON v.id=q.current_version_id JOIN recall_sources s ON s.question_id=q.id WHERE q.id=$1`,[id]);
 if(!row)return null;
 const history=await db.query<{version:number;createdAt:string}>('SELECT version,created_at::text AS "createdAt" FROM question_versions WHERE question_id=$1 ORDER BY version DESC',[id]);
 return {...row,correctAnswer:row.answers[0]??null,history};
}
export async function saveStudioDraft(db:Database,actorId:string,id:string,versionId:string,draft:DraftInput) {
 requireId(id);requireId(versionId);validateDraft(draft);
 return db.transaction(async tx=>{
  await requireStaff(tx,actorId);
  const [question]=await tx.query<{status:string;current_version_id:string}>('SELECT status,current_version_id FROM questions WHERE id=$1 FOR UPDATE',[id]);
  if(!question)throw new Error('Question not found.');
  if(question.current_version_id!==versionId)throw new Error('This question changed. Reload before saving.');
  if(['published','retired','rejected'].includes(question.status))throw new Error('Published, retired and rejected questions cannot be edited in this workflow.');
  const [next]=await tx.query<{id:string}>(`INSERT INTO question_versions(question_id,version,stem,options,correct_answers,explanation,references_json,key_notes,confidence,needs_expert,ai_meta) SELECT $1,version+1,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,COALESCE($8::jsonb,key_notes),confidence,needs_expert,CASE WHEN ai_meta IS NULL THEN NULL ELSE ai_meta||'{"editedByHuman":true}'::jsonb END FROM question_versions WHERE id=$2 RETURNING id`,[id,versionId,draft.stem,JSON.stringify(draft.options),JSON.stringify(draft.correctAnswer===null?[]:[draft.correctAnswer]),draft.explanation,JSON.stringify(draft.references),draft.keyNotes?JSON.stringify(draft.keyNotes):null]);
  await tx.query("UPDATE questions SET current_version_id=$1,status='raw' WHERE id=$2",[next.id,id]);
  await audit(tx,actorId,id,'draft.saved',{versionId,status:question.status},{versionId:next.id,status:'raw'});
  return next.id;
 });
}
export type ReviewAction='submit_review'|'approve'|'publish'|'retire'|'request_changes'|'reject';
export async function reviewStudioQuestion(db:Database,actorId:string,id:string,versionId:string,action:ReviewAction,reviewed:boolean,note:string) {
 requireId(id);requireId(versionId);
 const transitions={submit_review:{from:['raw','ai_refined'],to:'in_review'},approve:{from:['in_review'],to:'approved'},publish:{from:['approved'],to:'published'},retire:{from:['published'],to:'retired'},request_changes:{from:['in_review','approved'],to:'raw'},reject:{from:['raw','ai_refined','in_review','approved'],to:'rejected'}};
 if(!Object.hasOwn(transitions,action))throw new Error('Invalid review action.');
 if(note.length>2000)throw new Error('Review note is too long.');
 return db.transaction(async tx=>{
  await requireStaff(tx,actorId,action==='publish'||action==='retire');
  const [q]=await tx.query<{status:string;current_version_id:string}>('SELECT status,current_version_id FROM questions WHERE id=$1 FOR UPDATE',[id]);
  if(!q||q.current_version_id!==versionId)throw new Error('This question changed. Reload before reviewing.');
  const transition=transitions[action];
  if(!transition.from.includes(q.status))throw new Error('This action is not available for the current status.');
  if(action==='approve'&&!reviewed)throw new Error('Confirm that you checked the answer and references.');
  if((action==='request_changes'||action==='reject')&&!note.trim())throw new Error(action==='reject'?'Explain why this draft is rejected.':'Explain the changes required.');
  if(['submit_review','approve','publish'].includes(action)) {
   const [v]=await tx.query<DraftInput & {answers:number[]}>('SELECT stem,options,correct_answers AS answers,explanation,references_json AS references FROM question_versions WHERE id=$1',[versionId]);
   validateDraft({...v,correctAnswer:v.answers[0]??null},true);
  }
  await tx.query('UPDATE questions SET status=$1 WHERE id=$2',[transition.to,id]);
  await audit(tx,actorId,id,`review.${action}`,{status:q.status,versionId},{status:transition.to,versionId,reviewed,note:note.trim()});
 });
}
// Tags are metadata on the question, so changing them never versions or unpublishes content (BR-1: year and diet come from sittings).
export async function setQuestionTags(db:Database,actorId:string,id:string,tags:{topicId:string|null;difficulty:string|null;sittingIds:string[]}) {
 requireId(id);if(tags.topicId)requireId(tags.topicId);tags.sittingIds.forEach(requireId);
 if(tags.difficulty!==null&&!['easy','medium','hard'].includes(tags.difficulty))throw new Error('Choose a valid difficulty.');
 if(tags.sittingIds.length>50)throw new Error('Too many sittings selected.');
 return db.transaction(async tx=>{
  await requireStaff(tx,actorId);
  const [q]=await tx.query<{exam_id:string;status:string;topic_id:string|null;difficulty:string|null}>('SELECT exam_id,status,topic_id,difficulty FROM questions WHERE id=$1 FOR UPDATE',[id]);
  if(!q)throw new Error('Question not found.');
  if(q.status==='rejected')throw new Error('Rejected drafts cannot be tagged.');
  if(tags.topicId&&!(await tx.query('SELECT 1 FROM topics WHERE id=$1 AND exam_id=$2',[tags.topicId,q.exam_id])).length)throw new Error('Choose a topic from this exam.');
  const sittings=[...new Set(tags.sittingIds)];
  if(sittings.length&&(await tx.query('SELECT 1 FROM sittings WHERE id=ANY($1::uuid[]) AND exam_id=$2',[sittings,q.exam_id])).length!==sittings.length)throw new Error('Choose sittings from this exam.');
  const before=(await tx.query<{sitting_id:string}>('SELECT sitting_id FROM question_sittings WHERE question_id=$1',[id])).map(r=>r.sitting_id);
  await tx.query('UPDATE questions SET topic_id=$2,difficulty=$3 WHERE id=$1',[id,tags.topicId,tags.difficulty]);
  await tx.query('DELETE FROM question_sittings WHERE question_id=$1 AND NOT (sitting_id=ANY($2::uuid[]))',[id,sittings]);
  for(const sitting of sittings)await tx.query('INSERT INTO question_sittings(question_id,sitting_id,exam_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,sitting,q.exam_id]);
  await audit(tx,actorId,id,'question.tagged',{topicId:q.topic_id,difficulty:q.difficulty,sittingIds:before},{topicId:tags.topicId,difficulty:tags.difficulty,sittingIds:sittings});
 });
}

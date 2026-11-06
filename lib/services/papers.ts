import type {Database} from '../db/client';
import {requireId} from './studio';
// QB-5: content managers build, reorder, lock, publish and unpublish papers.
async function requireManager(db:Database,actorId:string) {
 const [actor]=await db.query<{role:string}>(`SELECT a.role FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1 AND a.status='active' AND u.email_verified=true AND (a.role<>'super_admin' OR u.two_factor_enabled=true)`,[actorId]);
 if(!actor||!['content_manager','super_admin'].includes(actor.role))throw new Error('Only a content manager can manage papers.');
}
async function audit(db:Database,actorId:string,paperId:string,action:string,after:unknown) {
 await db.query('INSERT INTO audit_log(actor_id,entity_id,action,after_json) VALUES($1,$2,$3,$4::jsonb)',[actorId,paperId,action,JSON.stringify(after)]);
}
export type PaperSummary={id:string;examId:string;examName:string;title:string;sitting:string|null;status:'draft'|'published';locked:boolean;minutes:number;questions:number};
export async function listPapersAdmin(db:Database,actorId:string):Promise<PaperSummary[]> {
 await requireManager(db,actorId);
 return db.query<PaperSummary>(`SELECT p.id,p.exam_id AS "examId",e.name AS "examName",p.title,s.label AS sitting,p.status,p.locked,p.time_limit_minutes AS minutes,(SELECT count(*)::int FROM paper_questions pq WHERE pq.paper_id=p.id) AS questions FROM papers p JOIN exams e ON e.id=p.exam_id LEFT JOIN sittings s ON s.id=p.sitting_id ORDER BY p.created_at DESC`);
}
export async function createPaper(db:Database,actorId:string,input:{examId:string;title:string;sittingId:string|null;minutes:number}) {
 requireId(input.examId);if(input.sittingId)requireId(input.sittingId);
 const title=input.title.trim().slice(0,160);
 if(!title)throw new Error('Give the paper a title.');
 if(!Number.isInteger(input.minutes)||input.minutes<1||input.minutes>600)throw new Error('Time limit must be between 1 and 600 minutes.');
 return db.transaction(async tx=>{
  await requireManager(tx,actorId);
  if(input.sittingId&&!(await tx.query('SELECT 1 FROM sittings WHERE id=$1 AND exam_id=$2',[input.sittingId,input.examId])).length)throw new Error('Choose a sitting from this exam.');
  const [paper]=await tx.query<{id:string}>('INSERT INTO papers(exam_id,title,sitting_id,time_limit_minutes,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[input.examId,title,input.sittingId,input.minutes,actorId]);
  await audit(tx,actorId,paper.id,'paper.created',{examId:input.examId,title,sittingId:input.sittingId,minutes:input.minutes});
  return paper.id;
 });
}
export type PaperDetail=PaperSummary&{sittingId:string|null;blueprintCount:number|null;complete:boolean;
 items:{position:number;questionId:string;stem:string;status:string;topic:string|null}[]};
export async function getPaperAdmin(db:Database,actorId:string,paperId:string):Promise<PaperDetail|null> {
 requireId(paperId);await requireManager(db,actorId);
 const [paper]=await db.query<PaperSummary&{sittingId:string|null;blueprint:{count?:number}}>(`SELECT p.id,p.exam_id AS "examId",e.name AS "examName",p.title,p.sitting_id AS "sittingId",s.label AS sitting,p.status,p.locked,p.time_limit_minutes AS minutes,e.blueprint,(SELECT count(*)::int FROM paper_questions pq WHERE pq.paper_id=p.id) AS questions FROM papers p JOIN exams e ON e.id=p.exam_id LEFT JOIN sittings s ON s.id=p.sitting_id WHERE p.id=$1`,[paperId]);
 if(!paper)return null;
 const items=await db.query<PaperDetail['items'][number]>(`SELECT pq.position,q.id AS "questionId",v.stem,q.status,COALESCE(pt.name||' › '||t.name,t.name) AS topic FROM paper_questions pq JOIN questions q ON q.id=pq.question_id JOIN question_versions v ON v.id=q.current_version_id LEFT JOIN topics t ON t.id=q.topic_id LEFT JOIN topics pt ON pt.id=t.parent_id WHERE pq.paper_id=$1 ORDER BY pq.position`,[paperId]);
 const {blueprint,...rest}=paper;const blueprintCount=Number(blueprint?.count)>0?Number(blueprint.count):null;
 // A "Complete Paper" matches the blueprint question count (type mix and topic weights are not configured yet).
 return {...rest,blueprintCount,complete:blueprintCount!==null&&items.filter(i=>i.status==='published').length===blueprintCount,items};
}
export async function paperCandidates(db:Database,actorId:string,paperId:string,filter:{sittingId:string|null;topicId:string|null;text:string}) {
 requireId(paperId);if(filter.sittingId)requireId(filter.sittingId);if(filter.topicId)requireId(filter.topicId);
 await requireManager(db,actorId);
 return db.query<{id:string;stem:string;topic:string|null;sittings:string}>(`SELECT q.id,v.stem,t.name AS topic,COALESCE((SELECT string_agg(s.label,', ' ORDER BY s.year DESC,s.month DESC) FROM question_sittings qs JOIN sittings s ON s.id=qs.sitting_id WHERE qs.question_id=q.id),'') AS sittings
  FROM papers p JOIN questions q ON q.exam_id=p.exam_id AND q.status='published' JOIN question_versions v ON v.id=q.current_version_id LEFT JOIN topics t ON t.id=q.topic_id
  WHERE p.id=$1 AND q.id NOT IN (SELECT question_id FROM paper_questions WHERE paper_id=$1)
  AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM question_sittings qs WHERE qs.question_id=q.id AND qs.sitting_id=$2))
  AND ($3::uuid IS NULL OR q.topic_id=$3 OR t.parent_id=$3) AND ($4='' OR v.stem ILIKE '%'||$4||'%') ORDER BY v.created_at DESC LIMIT 50`,[paperId,filter.sittingId,filter.topicId,filter.text.trim().slice(0,100)]);
}
async function editablePaper(tx:Database,actorId:string,paperId:string) {
 requireId(paperId);await requireManager(tx,actorId);
 const [paper]=await tx.query<{exam_id:string;locked:boolean}>('SELECT exam_id,locked FROM papers WHERE id=$1 FOR UPDATE',[paperId]);
 if(!paper)throw new Error('Paper not found.');
 if(paper.locked)throw new Error('Unlock the paper before changing its questions.');
 return paper;
}
async function writeOrder(tx:Database,paperId:string,examId:string,ids:string[]) {
 await tx.query('DELETE FROM paper_questions WHERE paper_id=$1',[paperId]);
 for(const [i,id] of ids.entries())await tx.query('INSERT INTO paper_questions(paper_id,exam_id,position,question_id) VALUES($1,$2,$3,$4)',[paperId,examId,i+1,id]);
}
async function currentOrder(tx:Database,paperId:string) {return (await tx.query<{question_id:string}>('SELECT question_id FROM paper_questions WHERE paper_id=$1 ORDER BY position',[paperId])).map(r=>r.question_id);}
export async function addPaperQuestion(db:Database,actorId:string,paperId:string,questionId:string) {
 requireId(questionId);
 return db.transaction(async tx=>{
  const paper=await editablePaper(tx,actorId,paperId);
  if(!(await tx.query(`SELECT 1 FROM questions WHERE id=$1 AND exam_id=$2 AND status='published'`,[questionId,paper.exam_id])).length)throw new Error('Only published questions from this exam can be added.');
  const order=await currentOrder(tx,paperId);
  if(order.includes(questionId))throw new Error('This question is already in the paper.');
  if(order.length>=300)throw new Error('A paper can hold up to 300 questions.');
  await writeOrder(tx,paperId,paper.exam_id,[...order,questionId]);
  await audit(tx,actorId,paperId,'paper.question_added',{questionId});
 });
}
export async function removePaperQuestion(db:Database,actorId:string,paperId:string,questionId:string) {
 requireId(questionId);
 return db.transaction(async tx=>{
  const paper=await editablePaper(tx,actorId,paperId);
  await writeOrder(tx,paperId,paper.exam_id,(await currentOrder(tx,paperId)).filter(id=>id!==questionId));
  await audit(tx,actorId,paperId,'paper.question_removed',{questionId});
 });
}
export async function movePaperQuestion(db:Database,actorId:string,paperId:string,questionId:string,direction:'up'|'down') {
 requireId(questionId);
 return db.transaction(async tx=>{
  const paper=await editablePaper(tx,actorId,paperId);
  const order=await currentOrder(tx,paperId),from=order.indexOf(questionId),to=direction==='up'?from-1:from+1;
  if(from<0||to<0||to>=order.length)return;
  [order[from],order[to]]=[order[to],order[from]];
  await writeOrder(tx,paperId,paper.exam_id,order);
  await audit(tx,actorId,paperId,'paper.reordered',{questionId,direction});
 });
}
export async function setPaperState(db:Database,actorId:string,paperId:string,action:'lock'|'unlock'|'publish'|'unpublish') {
 requireId(paperId);
 return db.transaction(async tx=>{
  await requireManager(tx,actorId);
  const [paper]=await tx.query<{status:string;locked:boolean}>('SELECT status,locked FROM papers WHERE id=$1 FOR UPDATE',[paperId]);
  if(!paper)throw new Error('Paper not found.');
  if(action==='unlock'&&paper.status==='published')throw new Error('Unpublish the paper before unlocking it.');
  if(action==='publish') {
   if(!paper.locked)throw new Error('Lock the paper before publishing it.');
   if(!(await tx.query(`SELECT 1 FROM paper_questions pq JOIN questions q ON q.id=pq.question_id AND q.status='published' WHERE pq.paper_id=$1 LIMIT 1`,[paperId])).length)throw new Error('Add at least one published question first.');
  }
  const next={lock:{locked:true,status:paper.status},unlock:{locked:false,status:paper.status},publish:{locked:true,status:'published'},unpublish:{locked:paper.locked,status:'draft'}}[action];
  await tx.query('UPDATE papers SET locked=$2,status=$3 WHERE id=$1',[paperId,next.locked,next.status]);
  await audit(tx,actorId,paperId,`paper.${action}`,next);
 });
}
// QB-6: proposals for complete papers per sitting. One draft paper per published sitting that has no paper yet,
// built only from questions recalled in that sitting. When a sitting has more questions than the blueprint count,
// topics keep their share of the bank and high-yield, high-confidence questions come first. The content manager
// then adjusts, locks and publishes as usual. Exam timing is never invented: without it there is no proposal.
export type PaperProposal={paperId:string|null;sitting:string;questions:number;target:number|null;note:string};
export async function proposePapers(db:Database,actorId:string,examId:string):Promise<PaperProposal[]> {
 requireId(examId);await requireManager(db,actorId);
 const [exam]=await db.query<{blueprint:{count?:number};settings:{durationMinutes?:number;highYieldMin?:number}}>('SELECT blueprint,settings FROM exams WHERE id=$1',[examId]);
 if(!exam)throw new Error('Exam not found.');
 const minutes=Number(exam.settings?.durationMinutes),count=Number(exam.blueprint?.count)>0?Number(exam.blueprint.count):null;
 if(!(minutes>0))throw new Error('Set this exam’s duration in the catalogue first. Paper time limits come from it.');
 const sittings=await db.query<{id:string;label:string}>(`SELECT s.id,s.label FROM sittings s WHERE s.exam_id=$1 AND s.published AND NOT EXISTS(SELECT 1 FROM papers p WHERE p.sitting_id=s.id)
  AND EXISTS(SELECT 1 FROM question_sittings qs JOIN questions q ON q.id=qs.question_id AND q.status='published' WHERE qs.sitting_id=s.id) ORDER BY s.year DESC,s.month DESC NULLS LAST`,[examId]);
 const share=new Map((await db.query<{topic:string|null;n:number}>(`SELECT COALESCE(t.parent_id,t.id)::text AS topic,count(*)::int AS n FROM questions q LEFT JOIN topics t ON t.id=q.topic_id WHERE q.exam_id=$1 AND q.status='published' GROUP BY 1`,[examId])).map(r=>[r.topic,r.n]));
 const bank=[...share.values()].reduce((s,n)=>s+n,0)||1;
 const hyMin=Number(exam.settings?.highYieldMin)>=2?Number(exam.settings.highYieldMin):2;
 const out:PaperProposal[]=[];
 for(const s of sittings){
  const pool=await db.query<{id:string;topic:string|null;seen:number;confidence:number|null}>(`SELECT q.id,COALESCE(t.parent_id,t.id)::text AS topic,(SELECT count(*)::int FROM question_sittings x WHERE x.question_id=q.id) AS seen,v.confidence
   FROM question_sittings qs JOIN questions q ON q.id=qs.question_id AND q.status='published' JOIN question_versions v ON v.id=q.current_version_id LEFT JOIN topics t ON t.id=q.topic_id WHERE qs.sitting_id=$1 ORDER BY q.id`,[s.id]);
  const rank=(a:typeof pool[number],b:typeof pool[number])=>Number(b.seen>=hyMin)-Number(a.seen>=hyMin)||(b.confidence??0)-(a.confidence??0)||a.id.localeCompare(b.id);
  let chosen=pool;
  if(count&&pool.length>count){
   // Largest-remainder allocation of the blueprint count across topics, by their share of the whole bank.
   const groups=new Map<string|null,typeof pool>();for(const q of pool)groups.set(q.topic,[...(groups.get(q.topic)??[]),q].sort(rank));
   const quota=[...groups.keys()].map(t=>{const exact=count*(share.get(t)??0)/bank;return {t,n:Math.min(Math.floor(exact),groups.get(t)!.length),rem:exact-Math.floor(exact)};});
   let left=count-quota.reduce((s,q)=>s+q.n,0);
   for(const q of [...quota].sort((a,b)=>b.rem-a.rem))if(left>0&&q.n<groups.get(q.t)!.length){q.n++;left--;}
   chosen=quota.flatMap(q=>groups.get(q.t)!.slice(0,q.n));
   if(chosen.length<count)chosen=[...chosen,...pool.filter(q=>!chosen.includes(q)).sort(rank).slice(0,count-chosen.length)];
  }
  // Mix topics through the paper rather than grouping them.
  const byTopic=new Map<string|null,typeof pool>();for(const q of [...chosen].sort(rank))byTopic.set(q.topic,[...(byTopic.get(q.topic)??[]),q]);
  const order:string[]=[];while(order.length<chosen.length)for(const list of byTopic.values()){const q=list.shift();if(q)order.push(q.id);}
  const note=count===null?`All ${order.length} questions from this sitting. Set the blueprint question count to make complete papers.`
   :order.length<count?`${order.length} of ${count} questions: this sitting does not have enough published recalls for a complete paper yet.`
   :pool.length>count?`${count} of the sitting’s ${pool.length} questions, balanced across topics; high-yield and high-confidence first.`:`All ${count} questions from this sitting.`;
  const paperId=await db.transaction(async tx=>{
   const [p]=await tx.query<{id:string}>('INSERT INTO papers(exam_id,title,sitting_id,time_limit_minutes,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[examId,`${s.label} paper (proposed)`.slice(0,160),s.id,Math.round(minutes*(count&&order.length<count?order.length/count:1))||1,actorId]);
   for(const [i,q] of order.entries())await tx.query('INSERT INTO paper_questions(paper_id,exam_id,position,question_id) VALUES($1,$2,$3,$4)',[p.id,examId,i+1,q]);
   await audit(tx,actorId,p.id,'paper.proposed',{sittingId:s.id,questions:order.length,target:count,note});
   return p.id;
  });
  out.push({paperId,sitting:s.label,questions:order.length,target:count,note});
 }
 return out;
}

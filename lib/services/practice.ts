import type {Database} from '../db/client';
import {dueReviewIds} from './review';
import {requireId} from './studio';
import {topicOptions,trialSettings,type ExamSettings} from './catalogue-admin';
import {recordQuestionView} from './protection';
import {questionTools} from './student';
export type PracticeMode='revision'|'exam';
export type PracticePool='all'|'unanswered'|'mistakes'|'paper'|'review';
export type Confidence='sure'|'unsure'|'guess';
export type PracticeFilters={topicIds?:string[];sittingIds?:string[];difficulties?:string[];highYield?:boolean;latestSitting?:boolean;bookmarked?:boolean;flagged?:boolean};
const ANSWER_GRACE_MS=2000,MAX_ITEMS=100,MAX_TIME_MS=3*60*60*1000,DEFAULT_HIGH_YIELD=2;
// Paid and granted access; trials are handled separately because they carry their own pool and caps.
const ACCESS_SOURCES=`('subscription','partner','complimentary')`;
async function requireVerified(db:Database,userId:string) {
 const [user]=await db.query<{verified:boolean;status:string}>('SELECT u.email_verified AS verified,a.status FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1',[userId]);
 if(user?.status==='suspended')throw new Error('This account is suspended. Contact support if you think this is a mistake.');
 if(!user?.verified)throw new Error('Verify your email to practise.');
}
export async function hasExamAccess(db:Database,userId:string,examId:string) {
 return (await db.query(`SELECT 1 FROM entitlements WHERE user_id=$1 AND exam_id=$2 AND source IN ${ACCESS_SOURCES} AND revoked_at IS NULL AND starts_at<=now() AND ends_at>now() LIMIT 1`,[userId,examId])).length>0;
}
type TrialState={endsAt:string;limit:number;used:number;mockSize:number;mockAttemptId:string|null};
async function activeTrial(db:Database,userId:string,examId:string):Promise<TrialState|null> {
 const [trial]=await db.query<{endsAt:string;limit:number;mockAttemptId:string|null;settings:ExamSettings}>(`SELECT t.ends_at::text AS "endsAt",t.question_limit AS limit,t.mock_attempt_id AS "mockAttemptId",e.settings FROM trials t JOIN exams e ON e.id=t.exam_id WHERE t.user_id=$1 AND t.exam_id=$2 AND t.ends_at>now()`,[userId,examId]);
 if(!trial||!trialSettings(trial.settings).enabled)return null;
 return {endsAt:trial.endsAt,limit:trial.limit,used:await trialQuestionsUsed(db,userId,examId),mockSize:trialSettings(trial.settings).mockSize,mockAttemptId:trial.mockAttemptId};
}
// TRIAL-1: the question cap is counted on the server from answered trial items, never from the browser.
async function trialQuestionsUsed(db:Database,userId:string,examId:string) {
 const [row]=await db.query<{n:number}>(`SELECT count(*)::int AS n FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id WHERE a.user_id=$1 AND a.exam_id=$2 AND a.access='trial' AND i.selected IS NOT NULL`,[userId,examId]);
 return row.n;
}
const TRIAL_POOL=`q.id IN (SELECT qs.question_id FROM question_sittings qs JOIN sittings s ON s.id=qs.sitting_id WHERE s.trial_pool)`;
function examTiming(blueprint:{count?:number},settings:ExamSettings) {
 const count=Number(blueprint?.count),minutes=Number(settings?.durationMinutes);
 return Number.isInteger(count)&&count>0&&minutes>0?{count,msPerQuestion:minutes*60000/count}:null;
}
const highYieldMin=(settings:ExamSettings)=>Number(settings?.highYieldMin)>=2?Number(settings.highYieldMin):DEFAULT_HIGH_YIELD;
// Answers count once an attempt can show feedback: immediately in revision, after submission in exam mode.
const answeredSql=(user:string,exam:string)=>`SELECT i.question_id,i.correct,i.answered_at FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id WHERE a.user_id=${user} AND a.exam_id=${exam} AND i.selected IS NOT NULL AND (a.mode='revision' OR a.submitted_at IS NOT NULL)`;
async function mistakeIds(db:Database,userId:string,examId:string) {
 // A wrong answer stays in the deck until it is answered correctly twice afterwards.
 const rows=await db.query<{question_id:string}>(`WITH answered AS (${answeredSql('$1','$2')}), wrong AS (SELECT question_id,max(answered_at) AS at FROM answered WHERE NOT correct GROUP BY question_id)
  SELECT w.question_id FROM wrong w JOIN questions q ON q.id=w.question_id AND q.status='published' WHERE (SELECT count(*) FROM answered x WHERE x.question_id=w.question_id AND x.correct AND x.answered_at>w.at)<2`,[userId,examId]);
 return rows.map(r=>r.question_id);
}
// The latest sitting that has published questions ("Latest-diet pack", STU-8).
const latestSittingSql=(exam:string)=>`(SELECT s.id FROM sittings s WHERE s.exam_id=${exam} AND EXISTS(SELECT 1 FROM question_sittings qs JOIN questions pq ON pq.id=qs.question_id AND pq.status='published' WHERE qs.sitting_id=s.id) ORDER BY s.year DESC,s.month DESC NULLS LAST,s.starts_on DESC NULLS LAST LIMIT 1)`;
export type PracticeExam={id:string;name:string;access:'full'|'trial';endsAt:string;published:number;mistakes:number;examReady:boolean;highYieldMin:number;answered:number;correct:number;
 coverage:{id:string;label:string;total:number;answered:number}[];
 trial:{used:number;limit:number;mockAvailable:boolean}|null;topics:{id:string;label:string}[];sittings:{id:string;label:string;questions:number}[];
 papers:{id:string;title:string;sitting:string|null;questions:number;minutes:number}[]};
export async function listPracticeExams(db:Database,userId:string):Promise<PracticeExam[]> {
 await requireVerified(db,userId);
 const exams=await db.query<{id:string;name:string;blueprint:{count?:number};settings:ExamSettings;fullEnds:string|null;trialEnds:string|null}>(`SELECT e.id,e.name,e.blueprint,e.settings,
  (SELECT max(n.ends_at)::text FROM entitlements n WHERE n.user_id=$1 AND n.exam_id=e.id AND n.source IN ${ACCESS_SOURCES} AND n.revoked_at IS NULL AND n.starts_at<=now() AND n.ends_at>now()) AS "fullEnds",
  (SELECT t.ends_at::text FROM trials t WHERE t.user_id=$1 AND t.exam_id=e.id AND t.ends_at>now()) AS "trialEnds" FROM exams e ORDER BY e.name`,[userId]);
 const result:PracticeExam[]=[];
 for(const e of exams) {
  const trial=e.fullEnds?null:e.trialEnds?await activeTrial(db,userId,e.id):null;
  if(!e.fullEnds&&!trial)continue;
  const poolSql=trial?` AND ${TRIAL_POOL}`:'';
  const [{published}]=await db.query<{published:number}>(`SELECT count(*)::int AS published FROM questions q WHERE q.exam_id=$1 AND q.status='published'${poolSql}`,[e.id]);
  // Progress counts distinct questions, judged on the latest answer the student can see feedback for.
  const [progress]=await db.query<{answered:number;correct:number}>(`WITH last AS (SELECT DISTINCT ON (question_id) question_id,correct FROM (${answeredSql('$1','$2')}) a ORDER BY question_id,answered_at DESC) SELECT count(*)::int AS answered,count(*) FILTER (WHERE correct)::int AS correct FROM last`,[userId,e.id]);
  // Sitting coverage: of each sitting's published questions, how many this student has answered.
  const coverage=await db.query<{id:string;label:string;total:number;answered:number}>(`SELECT s.id,s.label,count(DISTINCT q.id)::int AS total,count(DISTINCT q.id) FILTER (WHERE q.id IN (SELECT question_id FROM (${answeredSql('$1','$2')}) a))::int AS answered FROM sittings s JOIN question_sittings qs ON qs.sitting_id=s.id JOIN questions q ON q.id=qs.question_id AND q.status='published'${poolSql} WHERE s.exam_id=$2 GROUP BY s.id ORDER BY s.year DESC,s.month DESC NULLS LAST LIMIT 8`,[userId,e.id]);
  result.push({id:e.id,name:e.name,access:trial?'trial':'full',endsAt:(e.fullEnds??trial!.endsAt),published,mistakes:(await mistakeIds(db,userId,e.id)).length,answered:progress.answered,correct:progress.correct,coverage,examReady:examTiming(e.blueprint,e.settings)!==null,highYieldMin:highYieldMin(e.settings),
   trial:trial?{used:trial.used,limit:trial.limit,mockAvailable:trial.mockAttemptId===null}:null,
   topics:await topicOptions(db,e.id),
   sittings:await db.query(`SELECT s.id,s.label,count(q.id)::int AS questions FROM sittings s JOIN question_sittings qs ON qs.sitting_id=s.id JOIN questions q ON q.id=qs.question_id AND q.status='published'${poolSql} WHERE s.exam_id=$1 GROUP BY s.id ORDER BY s.year DESC,s.month DESC NULLS LAST`,[e.id]),
   papers:trial?[]:await db.query(`SELECT p.id,p.title,s.label AS sitting,(SELECT count(*)::int FROM paper_questions pq JOIN questions q ON q.id=pq.question_id AND q.status='published' WHERE pq.paper_id=p.id) AS questions,p.time_limit_minutes AS minutes FROM papers p LEFT JOIN sittings s ON s.id=p.sitting_id WHERE p.exam_id=$1 AND p.status='published' ORDER BY s.year DESC NULLS LAST,s.month DESC NULLS LAST,p.title`,[e.id])});
 }
 return result;
}
export type TrialOffer={id:string;name:string;days:number;questionLimit:number};
export async function listTrialOffers(db:Database,userId:string):Promise<TrialOffer[]> {
 const exams=await db.query<{id:string;name:string;settings:ExamSettings}>(`SELECT e.id,e.name,e.settings FROM exams e WHERE NOT EXISTS(SELECT 1 FROM trials t WHERE t.user_id=$1 AND t.exam_id=e.id)
  AND NOT EXISTS(SELECT 1 FROM entitlements n WHERE n.user_id=$1 AND n.exam_id=e.id AND n.source IN ${ACCESS_SOURCES} AND n.revoked_at IS NULL AND n.ends_at>now())
  AND EXISTS(SELECT 1 FROM questions q WHERE q.exam_id=e.id AND q.status='published' AND ${TRIAL_POOL}) ORDER BY e.name`,[userId]);
 return exams.filter(e=>trialSettings(e.settings).enabled).map(e=>({id:e.id,name:e.name,days:trialSettings(e.settings).days,questionLimit:trialSettings(e.settings).questionLimit}));
}
// TRIAL-2: signals are hashes of a first-party device cookie and the network address (see lifecycle.ts).
export async function startTrial(db:Database,userId:string,examId:string,signals:{device?:string|null;network?:string|null}={}) {
 requireId(examId);
 return db.transaction(async tx=>{
  await requireVerified(tx,userId);
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[userId+examId]);
  const [exam]=await tx.query<{settings:ExamSettings}>('SELECT settings FROM exams WHERE id=$1',[examId]);
  if(!exam)throw new Error('Exam not found.');
  const settings=trialSettings(exam.settings);
  if(!settings.enabled)throw new Error('A free trial is not available for this exam yet.');
  if(await hasExamAccess(tx,userId,examId))throw new Error('You already have access to this exam.');
  if((await tx.query('SELECT 1 FROM trials WHERE user_id=$1 AND exam_id=$2',[userId,examId])).length)throw new Error('You have already used the free trial for this exam.');
  if(!(await tx.query(`SELECT 1 FROM questions q WHERE q.exam_id=$1 AND q.status='published' AND ${TRIAL_POOL} LIMIT 1`,[examId])).length)throw new Error('A free trial is not available for this exam yet.');
  if(signals.device){
   // Claim the device for this exam first, so two accounts on one device cannot both start a trial.
   const claimed=await tx.query('INSERT INTO trial_devices(device_hash,exam_id,user_id,network_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING user_id',[signals.device,examId,userId,signals.network??null]);
   const [used]=claimed.length?[]:await tx.query<{user_id:string}>('SELECT user_id FROM trial_devices WHERE device_hash=$1 AND exam_id=$2',[signals.device,examId]);
   if(used&&used.user_id!==userId)throw new Error('A free trial for this exam has already been used on this device. Choose a plan to keep practising.');
  }
  // A shared network (a hospital, a university) never blocks a trial; many trials from one network are recorded for review.
  const shared=signals.network?(await tx.query<{n:number}>("SELECT count(DISTINCT user_id)::int AS n FROM trial_devices WHERE network_hash=$1 AND exam_id=$2 AND created_at>now()-interval '30 days'",[signals.network,examId]))[0].n:0;
  const [trial]=await tx.query<{ends_at:string}>(`INSERT INTO trials(user_id,exam_id,ends_at,question_limit) VALUES($1,$2,now()+make_interval(days=>$3),$4) RETURNING ends_at::text`,[userId,examId,settings.days,settings.questionLimit]);
  const [entitlement]=await tx.query<{id:string}>(`INSERT INTO entitlements(user_id,exam_id,source,starts_at,ends_at) VALUES($1,$2,'trial',now(),$3) RETURNING id`,[userId,examId,trial.ends_at]);
  await tx.query('INSERT INTO audit_log(actor_id,entity_id,action,after_json) VALUES($1,$2,$3,$4::jsonb)',[userId,entitlement.id,'trial.started',JSON.stringify({examId,days:settings.days,questionLimit:settings.questionLimit,...(shared>=3?{sharedNetworkTrials:shared}:{})})]);
  return trial.ends_at;
 });
}
function cleanFilters(filters:PracticeFilters|undefined):PracticeFilters {
 const ids=(list:unknown)=>Array.isArray(list)?[...new Set(list.filter((v):v is string=>typeof v==='string'))].slice(0,50):[];
 const clean={topicIds:ids(filters?.topicIds),sittingIds:ids(filters?.sittingIds),difficulties:ids(filters?.difficulties).filter(d=>['easy','medium','hard'].includes(d)),highYield:filters?.highYield===true,latestSitting:filters?.latestSitting===true,bookmarked:filters?.bookmarked===true,flagged:filters?.flagged===true};
 [...clean.topicIds,...clean.sittingIds].forEach(requireId);
 return clean;
}
async function insertAttempt(tx:Database,input:{userId:string;examId:string;mode:PracticeMode;pool:PracticePool;requestId:string;deadline:string|null;paperId?:string|null;access:'full'|'trial';filters:PracticeFilters},questions:{id:string;version_id:string}[]) {
 const [attempt]=await tx.query<{id:string}>('INSERT INTO practice_attempts(user_id,exam_id,mode,pool,request_id,deadline_at,paper_id,access,filters) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING id',[input.userId,input.examId,input.mode,input.pool,input.requestId,input.deadline,input.paperId??null,input.access,JSON.stringify(input.filters)]);
 for(const [i,q] of questions.entries())await tx.query('INSERT INTO practice_items(attempt_id,position,question_id,version_id) VALUES($1,$2,$3,$4)',[attempt.id,i+1,q.id,q.version_id]);
 return attempt.id;
}
export async function startAttempt(db:Database,userId:string,input:{examId:string;mode:PracticeMode;pool:PracticePool;count:number;requestId:string;filters?:PracticeFilters}) {
 requireId(input.examId);requireId(input.requestId);
 if(!['revision','exam'].includes(input.mode)||!['all','unanswered','mistakes','review'].includes(input.pool))throw new Error('Choose a valid practice mode.');
 if(!Number.isInteger(input.count)||input.count<1||input.count>MAX_ITEMS)throw new Error(`Choose between 1 and ${MAX_ITEMS} questions.`);
 const filters=cleanFilters(input.filters);
 return db.transaction(async tx=>{
  await requireVerified(tx,userId);
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[userId+input.requestId]);
  const [existing]=await tx.query<{id:string}>('SELECT id FROM practice_attempts WHERE user_id=$1 AND request_id=$2',[userId,input.requestId]);
  if(existing)return existing.id;
  const full=await hasExamAccess(tx,userId,input.examId),trial=full?null:await activeTrial(tx,userId,input.examId);
  if(!full&&!trial)throw new Error('You do not have access to this exam.');
  const [exam]=await tx.query<{blueprint:{count?:number};settings:ExamSettings}>('SELECT blueprint,settings FROM exams WHERE id=$1',[input.examId]);
  const timing=examTiming(exam.blueprint,exam.settings);
  if(input.mode==='exam'&&!timing)throw new Error('Exam Mode is not yet configured for this exam.');
  let count=input.count;
  if(trial) {
   // A trial allows Revision Mode up to the question cap and a single mini mock.
   if(trial.used>=trial.limit)throw new Error('You have used all the questions in your free trial.');
   if(input.mode==='exam'){if(trial.mockAttemptId)throw new Error('You have already taken the free-trial mini mock.');count=trial.mockSize;}
   count=Math.min(count,trial.limit-trial.used);
  }
  const params:unknown[]=[];const p=(value:unknown)=>{params.push(value);return `$${params.length}`;};
  const user=p(userId),examParam=p(input.examId);
  const where=[`q.exam_id=${examParam}`,`q.status='published'`,`${user}::uuid IS NOT NULL`];
  if(input.pool==='unanswered')where.push(`q.id NOT IN (SELECT question_id FROM (${answeredSql(user,examParam)}) answered)`);
  if(input.pool==='mistakes')where.push(`q.id=ANY(${p(await mistakeIds(tx,userId,input.examId))}::uuid[])`);
  if(input.pool==='review')where.push(`q.id=ANY(${p(await dueReviewIds(tx,userId,input.examId))}::uuid[])`);
  if(filters.topicIds!.length){const t=p(filters.topicIds);where.push(`(q.topic_id=ANY(${t}::uuid[]) OR q.topic_id IN (SELECT id FROM topics WHERE parent_id=ANY(${t}::uuid[])))`);}
  if(filters.sittingIds!.length)where.push(`EXISTS(SELECT 1 FROM question_sittings qs WHERE qs.question_id=q.id AND qs.sitting_id=ANY(${p(filters.sittingIds)}::uuid[]))`);
  if(filters.difficulties!.length)where.push(`q.difficulty=ANY(${p(filters.difficulties)}::text[])`);
  if(filters.highYield)where.push(`(SELECT count(*) FROM question_sittings qs WHERE qs.question_id=q.id)>=${p(highYieldMin(exam.settings))}::int`);
  if(filters.latestSitting)where.push(`EXISTS(SELECT 1 FROM question_sittings qs WHERE qs.question_id=q.id AND qs.sitting_id=${latestSittingSql(examParam)})`);
  if(filters.bookmarked)where.push(`q.id IN (SELECT question_id FROM question_bookmarks WHERE user_id=${user})`);
  // Flagged: still flagged in the most recent session that included the question.
  if(filters.flagged)where.push(`q.id IN (SELECT question_id FROM (SELECT DISTINCT ON (fi.question_id) fi.question_id,fi.flagged FROM practice_items fi JOIN practice_attempts fa ON fa.id=fi.attempt_id WHERE fa.user_id=${user} ORDER BY fi.question_id,fa.started_at DESC) f WHERE f.flagged)`);
  if(trial)where.push(TRIAL_POOL);
  const picked=await tx.query<{id:string;version_id:string}>(`SELECT q.id,q.current_version_id AS version_id FROM questions q WHERE ${where.join(' AND ')} ORDER BY random() LIMIT ${p(count)}::int`,params);
  const filtered=input.pool!=='all'||Object.values(filters).some(v=>Array.isArray(v)?v.length:v);
  if(!picked.length)throw new Error(filtered?'No questions match this selection.':'No published questions are available for this exam yet.');
  const deadline=input.mode==='exam'?new Date(Date.now()+Math.round(picked.length*timing!.msPerQuestion)).toISOString():null;
  const id=await insertAttempt(tx,{userId,examId:input.examId,mode:input.mode,pool:input.pool,requestId:input.requestId,deadline,access:trial?'trial':'full',filters},picked);
  if(trial&&input.mode==='exam')await tx.query('UPDATE trials SET mock_attempt_id=$3 WHERE user_id=$1 AND exam_id=$2',[userId,input.examId,id]);
  return id;
 });
}
// STU-2/STU-4: a published paper runs as Exam Mode in its fixed order with the paper's own time limit.
export async function startPaperAttempt(db:Database,userId:string,input:{paperId:string;requestId:string}) {
 requireId(input.paperId);requireId(input.requestId);
 return db.transaction(async tx=>{
  await requireVerified(tx,userId);
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[userId+input.requestId]);
  const [existing]=await tx.query<{id:string}>('SELECT id FROM practice_attempts WHERE user_id=$1 AND request_id=$2',[userId,input.requestId]);
  if(existing)return existing.id;
  const [paper]=await tx.query<{exam_id:string;minutes:number}>(`SELECT exam_id,time_limit_minutes AS minutes FROM papers WHERE id=$1 AND status='published'`,[input.paperId]);
  if(!paper)throw new Error('Paper not found.');
  if(!(await hasExamAccess(tx,userId,paper.exam_id)))throw new Error('Complete papers are available with full access to this exam.');
  const questions=await tx.query<{id:string;version_id:string}>(`SELECT q.id,q.current_version_id AS version_id FROM paper_questions pq JOIN questions q ON q.id=pq.question_id AND q.status='published' WHERE pq.paper_id=$1 ORDER BY pq.position`,[input.paperId]);
  if(!questions.length)throw new Error('This paper has no available questions.');
  return insertAttempt(tx,{userId,examId:paper.exam_id,mode:'exam',pool:'paper',requestId:input.requestId,deadline:new Date(Date.now()+paper.minutes*60000).toISOString(),paperId:input.paperId,access:'full',filters:{}},questions);
 });
}
type AttemptRow={id:string;mode:PracticeMode;examName:string;examId:string;access:'full'|'trial';paperTitle:string|null;deadlineAt:string|null;submittedAt:string|null;total:number};
async function loadAttempt(db:Database,userId:string,attemptId:string,lock=false):Promise<AttemptRow> {
 requireId(attemptId);
 const [attempt]=await db.query<AttemptRow>(`SELECT a.id,a.mode,e.name AS "examName",a.exam_id AS "examId",a.access,p.title AS "paperTitle",a.deadline_at::text AS "deadlineAt",a.submitted_at::text AS "submittedAt",(SELECT count(*)::int FROM practice_items i WHERE i.attempt_id=a.id) AS total FROM practice_attempts a JOIN exams e ON e.id=a.exam_id LEFT JOIN papers p ON p.id=a.paper_id WHERE a.id=$1 AND a.user_id=$2${lock?' FOR UPDATE OF a':''}`,[attemptId,userId]);
 if(!attempt)throw new Error('Practice session not found.');
 await requireVerified(db,userId);
 // The server deadline is authoritative: an expired exam is submitted at its deadline, after a short network grace.
 if(attempt.mode==='exam'&&!attempt.submittedAt&&Date.parse(attempt.deadlineAt!)+ANSWER_GRACE_MS<=Date.now()) {
  const [done]=await db.query<{submittedAt:string}>('UPDATE practice_attempts SET submitted_at=deadline_at WHERE id=$1 AND submitted_at IS NULL RETURNING submitted_at::text AS "submittedAt"',[attemptId]);
  attempt.submittedAt=done?.submittedAt??attempt.deadlineAt;
 }
 return attempt;
}
export type PracticeView={attempt:AttemptRow&{position:number;serverNow:string};navigator:{position:number;answered:boolean;flagged:boolean}[];
 question:{stem:string;options:string[];selected:number|null;confidence:Confidence|null;flagged:boolean;withdrawn:boolean;bookmarked:boolean;note:string;reported:boolean};
 feedback:{correctAnswer:number;correct:boolean;explanation:string;references:string[];keyNotes:string[];distribution:number[];seenIn:string[];highYield:boolean;newThisSitting:boolean}|null};
// Returns exactly one question body for an attempt the user owns (PROT-1).
export async function getPracticeQuestion(db:Database,userId:string,attemptId:string,position:number):Promise<PracticeView> {
 const attempt=await loadAttempt(db,userId,attemptId);
 if(!Number.isInteger(position)||position<1||position>attempt.total)throw new Error('Question not found in this session.');
 const navigator=await db.query<{position:number;answered:boolean;flagged:boolean}>('SELECT position,selected IS NOT NULL AS answered,flagged FROM practice_items WHERE attempt_id=$1 ORDER BY position',[attemptId]);
 const [item]=await db.query<{questionId:string;stem:string;options:string[];answers:number[];explanation:string;references:string[];keyNotes:string[];selected:number|null;confidence:Confidence|null;flagged:boolean;correct:boolean|null;status:string;versionId:string}>(`SELECT q.id AS "questionId",v.stem,v.options,v.correct_answers AS answers,v.explanation,v.references_json AS references,v.key_notes AS "keyNotes",i.selected,i.confidence,i.flagged,i.correct,q.status,i.version_id AS "versionId" FROM practice_items i JOIN questions q ON q.id=i.question_id JOIN question_versions v ON v.id=i.version_id WHERE i.attempt_id=$1 AND i.position=$2`,[attemptId,position]);
 const view={...attempt,position,serverNow:new Date().toISOString()};
 // Students never read a question that is no longer published (RBAC-2).
 if(item.status!=='published')return {attempt:view,navigator,question:{stem:'',options:[],selected:null,confidence:null,flagged:item.flagged,withdrawn:true,bookmarked:false,note:'',reported:false},feedback:null};
 // PROT-2: each new question body counts against the account's hourly budget.
 await recordQuestionView(db,userId,item.questionId,attemptId);
 const question={stem:item.stem,options:item.options,selected:item.selected,confidence:item.confidence,flagged:item.flagged,withdrawn:false,...await questionTools(db,userId,item.questionId)};
 const reveal=attempt.mode==='revision'?item.selected!==null:attempt.submittedAt!==null;
 if(!reveal)return {attempt:view,navigator,question,feedback:null};
 const counts=await db.query<{selected:number;n:number}>(`SELECT i.selected,count(*)::int AS n FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id WHERE i.version_id=$1 AND i.selected IS NOT NULL AND (a.mode='revision' OR a.submitted_at IS NOT NULL) GROUP BY i.selected`,[item.versionId]);
 const total=counts.reduce((sum,c)=>sum+c.n,0),distribution=item.options.map((_,i)=>total?Math.round(100*(counts.find(c=>c.selected===i)?.n??0)/total):0);
 // "Seen in" chips, newest first; badges derive from sitting links (PRD section 7).
 const seen=await db.query<{id:string;label:string}>('SELECT s.id,s.label FROM question_sittings qs JOIN sittings s ON s.id=qs.sitting_id WHERE qs.question_id=$1 ORDER BY s.year DESC,s.month DESC NULLS LAST',[item.questionId]);
 const [exam]=await db.query<{settings:ExamSettings;latest:string|null}>(`SELECT e.settings,${latestSittingSql('e.id')} AS latest FROM exams e WHERE e.id=$1`,[attempt.examId]);
 return {attempt:view,navigator,question,feedback:{correctAnswer:item.answers[0],correct:item.correct===true,explanation:item.explanation,references:item.references,keyNotes:item.keyNotes,distribution,
  seenIn:seen.map(s=>s.label),highYield:seen.length>=highYieldMin(exam.settings),newThisSitting:seen.length===1&&seen[0].id===exam.latest}};
}
export async function answerQuestion(db:Database,userId:string,attemptId:string,position:number,input:{selected:number;confidence:Confidence|null;timeMs:number}) {
 if(!Number.isInteger(input.selected)||input.selected<0||input.selected>4)throw new Error('Choose an answer.');
 if(input.confidence!==null&&!['sure','unsure','guess'].includes(input.confidence))throw new Error('Choose a valid confidence level.');
 const timeMs=Number.isFinite(input.timeMs)?Math.min(Math.max(Math.round(input.timeMs),0),MAX_TIME_MS):0;
 return db.transaction(async tx=>{
  const attempt=await loadAttempt(tx,userId,attemptId,true);
  if(attempt.submittedAt)throw new Error(attempt.mode==='exam'?'This exam has been submitted.':'This session has finished.');
  const [item]=await tx.query<{selected:number|null;answers:number[];status:string;options:string[]}>('SELECT i.selected,v.correct_answers AS answers,v.options,q.status FROM practice_items i JOIN questions q ON q.id=i.question_id JOIN question_versions v ON v.id=i.version_id WHERE i.attempt_id=$1 AND i.position=$2 FOR UPDATE OF i',[attemptId,position]);
  if(!item||item.status!=='published')throw new Error('This question is no longer available.');
  if(input.selected>=item.options.length)throw new Error('Choose an answer.');
  if(attempt.mode==='revision'&&item.selected!==null)throw new Error('This question has already been answered.');
  // Access is rechecked on every answer so an expired plan or trial cannot keep answering an open session.
  if(attempt.access==='full'&&!(await hasExamAccess(tx,userId,attempt.examId)))throw new Error('Your access to this exam has ended.');
  if(attempt.access==='trial') {
   await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`trial:${userId}:${attempt.examId}`]);
   const trial=await activeTrial(tx,userId,attempt.examId);
   if(!trial)throw new Error('Your free trial has ended.');
   if(item.selected===null&&trial.used>=trial.limit)throw new Error('You have used all the questions in your free trial.');
  }
  // Exam Mode answers stay changeable until submission; time accumulates across visits.
  await tx.query('UPDATE practice_items SET selected=$3,correct=$4,confidence=$5,time_ms=COALESCE(time_ms,0)+$6,answered_at=now() WHERE attempt_id=$1 AND position=$2',[attemptId,position,input.selected,item.answers.includes(input.selected),input.confidence,timeMs]);
 });
}
export async function setFlag(db:Database,userId:string,attemptId:string,position:number,flagged:boolean) {
 return db.transaction(async tx=>{
  const attempt=await loadAttempt(tx,userId,attemptId,true);
  if(attempt.submittedAt)throw new Error('This session has finished.');
  const rows=await tx.query('UPDATE practice_items SET flagged=$3 WHERE attempt_id=$1 AND position=$2 RETURNING position',[attemptId,position,flagged===true]);
  if(!rows.length)throw new Error('Question not found in this session.');
 });
}
export async function submitAttempt(db:Database,userId:string,attemptId:string) {
 return db.transaction(async tx=>{
  const attempt=await loadAttempt(tx,userId,attemptId,true);
  if(!attempt.submittedAt)await tx.query('UPDATE practice_attempts SET submitted_at=now() WHERE id=$1 AND submitted_at IS NULL',[attemptId]);
 });
}
export type PracticeResults={id:string;examId:string;mode:PracticeMode;examName:string;paperTitle:string|null;access:'full'|'trial';scored:number;correct:number;answered:number;percent:number;passMark:number|null;passed:boolean|null;timeMs:number;
 items:{position:number;answered:boolean;correct:boolean;flagged:boolean;confidence:Confidence|null;timeMs:number;withdrawn:boolean;topic:string|null}[];
 topics:{topic:string;correct:number;total:number}[]};
export async function getResults(db:Database,userId:string,attemptId:string):Promise<PracticeResults> {
 const attempt=await loadAttempt(db,userId,attemptId);
 if(!attempt.submittedAt)throw new Error('Finish this session to see results.');
 const [exam]=await db.query<{settings:ExamSettings}>('SELECT settings FROM exams WHERE id=$1',[attempt.examId]);
 const items=await db.query<PracticeResults['items'][number]>(`SELECT i.position,i.selected IS NOT NULL AS answered,COALESCE(i.correct,false) AS correct,i.flagged,i.confidence,COALESCE(i.time_ms,0) AS "timeMs",q.status<>'published' AS withdrawn,COALESCE(p.name,t.name) AS topic FROM practice_items i JOIN questions q ON q.id=i.question_id LEFT JOIN topics t ON t.id=q.topic_id LEFT JOIN topics p ON p.id=t.parent_id WHERE i.attempt_id=$1 ORDER BY i.position`,[attemptId]);
 // Withdrawn questions are excluded from the score; revision scores only what was answered.
 const scoredItems=items.filter(i=>!i.withdrawn&&(attempt.mode==='exam'||i.answered));
 const correct=scoredItems.filter(i=>i.correct).length,percent=scoredItems.length?Math.round(100*correct/scoredItems.length):0;
 const passMark=Number(exam.settings?.passMarkPercent)>0?Number(exam.settings.passMarkPercent):null;
 const byTopic=new Map<string,{topic:string;correct:number;total:number}>();
 for(const i of scoredItems){const key=i.topic??'Untagged';const row=byTopic.get(key)??{topic:key,correct:0,total:0};row.total++;if(i.correct)row.correct++;byTopic.set(key,row);}
 return {id:attempt.id,examId:attempt.examId,mode:attempt.mode,examName:attempt.examName,paperTitle:attempt.paperTitle,access:attempt.access,scored:scoredItems.length,correct,answered:items.filter(i=>i.answered).length,percent,passMark,passed:attempt.mode==='exam'&&passMark!==null?percent>=passMark:null,timeMs:items.reduce((s,i)=>s+i.timeMs,0),items,
  topics:[...byTopic.values()].sort((a,b)=>a.correct/a.total-b.correct/b.total)};
}
export async function listRecentAttempts(db:Database,userId:string,examId?:string) {
 if(examId)requireId(examId);
 return db.query<{id:string;examId:string;examName:string;mode:PracticeMode;paperTitle:string|null;access:'full'|'trial';startedAt:string;submitted:boolean;total:number;answered:number;correct:number}>(`SELECT a.id,a.exam_id AS "examId",e.name AS "examName",a.mode,p.title AS "paperTitle",a.access,a.started_at::text AS "startedAt",(a.submitted_at IS NOT NULL OR (a.mode='exam' AND a.deadline_at<=now())) AS submitted,count(i.*)::int AS total,count(i.selected)::int AS answered,count(*) FILTER (WHERE i.correct)::int AS correct FROM practice_attempts a JOIN exams e ON e.id=a.exam_id LEFT JOIN papers p ON p.id=a.paper_id JOIN practice_items i ON i.attempt_id=a.id WHERE a.user_id=$1 AND ($2::uuid IS NULL OR a.exam_id=$2) GROUP BY a.id,e.name,p.title ORDER BY a.started_at DESC LIMIT 10`,[userId,examId??null]);
}
export type HistoryFilter='all'|'revision'|'exam'|'open';
export type HistoryRow={id:string;examId:string;examName:string;mode:PracticeMode;pool:PracticePool;paperTitle:string|null;access:'full'|'trial';highYield:boolean;latestSitting:boolean;startedAt:string;finishedAt:string|null;total:number;answered:number;scored:number;correct:number;timeMs:number;percent:number|null;passMark:number|null;passed:boolean|null};
export const HISTORY_PAGE=25;
// The full session history, scored exactly as the results report scores it: withdrawn questions never count,
// and in Revision Mode only answered questions do. Counts cover the chosen exam, before the filter.
export async function listAttemptHistory(db:Database,userId:string,options:{examId?:string;filter?:HistoryFilter;page?:number}={}) {
 if(options.examId)requireId(options.examId);
 const filter=options.filter??'all',page=Math.max(1,Math.floor(options.page??1));
 const stats=`WITH s AS (SELECT a.id,a.exam_id AS "examId",e.name AS "examName",e.settings,a.mode,a.pool,p.title AS "paperTitle",a.access,COALESCE(a.filters->>'highYield','false')='true' AS "highYield",COALESCE(a.filters->>'latestSitting','false')='true' AS "latestSitting",a.started_at,COALESCE(a.submitted_at,CASE WHEN a.mode='exam' AND a.deadline_at<=now() THEN a.deadline_at END) AS finished_at,
  count(i.*)::int AS total,count(i.selected)::int AS answered,count(*) FILTER (WHERE q.status='published' AND (a.mode='exam' OR i.selected IS NOT NULL))::int AS scored,count(*) FILTER (WHERE q.status='published' AND i.correct)::int AS correct,COALESCE(sum(i.time_ms),0)::int AS "timeMs"
  FROM practice_attempts a JOIN exams e ON e.id=a.exam_id LEFT JOIN papers p ON p.id=a.paper_id JOIN practice_items i ON i.attempt_id=a.id JOIN questions q ON q.id=i.question_id
  WHERE a.user_id=$1 AND ($2::uuid IS NULL OR a.exam_id=$2) GROUP BY a.id,e.name,e.settings,p.title)`;
 const where={all:'true',revision:`mode='revision'`,exam:`mode='exam'`,open:'finished_at IS NULL'}[filter];
 const [rows,[counts],exams]=await Promise.all([
  db.query<Omit<HistoryRow,'percent'|'passMark'|'passed'>&{settings:ExamSettings|null}>(`${stats} SELECT id,"examId","examName",settings,mode,pool,"paperTitle",access,"highYield","latestSitting",started_at::text AS "startedAt",finished_at::text AS "finishedAt",total,answered,scored,correct,"timeMs" FROM s WHERE ${where} ORDER BY started_at DESC LIMIT ${HISTORY_PAGE} OFFSET ${(page-1)*HISTORY_PAGE}`,[userId,options.examId??null]),
  db.query<{all:number;revision:number;exam:number;open:number;answered:number;scored:number;correct:number}>(`${stats} SELECT count(*)::int AS all,count(*) FILTER (WHERE mode='revision')::int AS revision,count(*) FILTER (WHERE mode='exam')::int AS exam,count(*) FILTER (WHERE finished_at IS NULL)::int AS open,COALESCE(sum(answered),0)::int AS answered,COALESCE(sum(scored) FILTER (WHERE finished_at IS NOT NULL),0)::int AS scored,COALESCE(sum(correct) FILTER (WHERE finished_at IS NOT NULL),0)::int AS correct FROM s`,[userId,options.examId??null]),
  db.query<{id:string;name:string}>(`SELECT DISTINCT e.id,e.name FROM practice_attempts a JOIN exams e ON e.id=a.exam_id WHERE a.user_id=$1 ORDER BY e.name`,[userId]),
 ]);
 return {page,pageSize:HISTORY_PAGE,counts,exams,rows:rows.map(({settings,...r}):HistoryRow=>{
  const passMark=Number(settings?.passMarkPercent)>0?Number(settings!.passMarkPercent):null,percent=r.finishedAt&&r.scored?Math.round(100*r.correct/r.scored):null;
  return {...r,percent,passMark:r.mode==='exam'?passMark:null,passed:r.mode==='exam'&&passMark!==null&&percent!==null?percent>=passMark:null};
 })};
}
export async function grantComplimentaryAccess(db:Database,actorId:string,input:{email:string;examId:string;days:number}) {
 requireId(input.examId);
 if(!Number.isInteger(input.days)||input.days<1||input.days>366)throw new Error('Choose between 1 and 366 days.');
 return db.transaction(async tx=>{
  const [actor]=await tx.query<{id:string}>(`SELECT a.id FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1 AND a.role='super_admin' AND a.status='active' AND u.email_verified=true AND u.two_factor_enabled=true`,[actorId]);
  if(!actor)throw new Error('Only a Super Admin can grant complimentary access.');
  const [user]=await tx.query<{id:string}>(`SELECT a.id FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE lower(u.email)=lower($1) AND u.email_verified=true AND a.status='active'`,[input.email.trim()]);
  if(!user)throw new Error('No verified account uses that email.');
  if(!(await tx.query('SELECT id FROM exams WHERE id=$1',[input.examId])).length)throw new Error('Exam not found.');
  const [entitlement]=await tx.query<{id:string;ends_at:string}>(`INSERT INTO entitlements(user_id,exam_id,source,starts_at,ends_at) VALUES($1,$2,'complimentary',now(),now()+make_interval(days=>$3)) RETURNING id,ends_at::text`,[user.id,input.examId,input.days]);
  await tx.query('INSERT INTO audit_log(actor_id,entity_id,action,after_json) VALUES($1,$2,$3,$4::jsonb)',[actorId,entitlement.id,'entitlement.granted',JSON.stringify({userId:user.id,examId:input.examId,source:'complimentary',days:input.days})]);
  return entitlement.ends_at;
 });
}

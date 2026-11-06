import type {Database} from '../db/client';
import {requireId} from './studio';
import {validTimezone} from './student';
// STU-13: spaced repetition at 1, 3, 7 and 14 days (PRD). A question joins the review deck when it is answered
// wrongly, or correctly but marked "unsure" or "guess". Each correct answer given on or after the due date moves
// it to the next interval; a wrong answer sends it back to 1 day; a correct answer at 14 days takes it out.
// The schedule is worked out from the answers themselves, so it never drifts from what the student did.
export const INTERVAL_DAYS=[1,3,7,14];
const DAY=86400_000;
type Answer={question_id:string;correct:boolean;confidence:string|null;answered_at:string};
export type ReviewItem={questionId:string;step:number;due:number};
export function schedule(answers:Answer[]):Map<string,ReviewItem> {
 const deck=new Map<string,ReviewItem>();
 for(const a of answers){
  const at=Date.parse(a.answered_at),item=deck.get(a.question_id);
  if(!a.correct){deck.set(a.question_id,{questionId:a.question_id,step:0,due:at+INTERVAL_DAYS[0]*DAY});continue;}
  if(!item){if(a.confidence==='unsure'||a.confidence==='guess')deck.set(a.question_id,{questionId:a.question_id,step:0,due:at+INTERVAL_DAYS[0]*DAY});continue;}
  // A correct answer before the due date (cramming) neither advances nor resets the item. The day boundary is generous by an hour.
  if(at<item.due-3600_000)continue;
  const next=item.step+1;
  if(next>=INTERVAL_DAYS.length)deck.delete(a.question_id);
  else deck.set(a.question_id,{questionId:a.question_id,step:next,due:at+INTERVAL_DAYS[next]*DAY});
 }
 return deck;
}
async function answers(db:Database,userId:string,examId:string) {
 return db.query<Answer>(`SELECT i.question_id,i.correct,i.confidence,i.answered_at::text FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id JOIN questions q ON q.id=i.question_id AND q.status='published'
  WHERE a.user_id=$1 AND a.exam_id=$2 AND i.selected IS NOT NULL AND (a.mode='revision' OR a.submitted_at IS NOT NULL) ORDER BY i.answered_at`,[userId,examId]);
}
export async function dueReviewIds(db:Database,userId:string,examId:string,now=Date.now()) {
 return [...schedule(await answers(db,userId,examId)).values()].filter(i=>i.due<=now).sort((a,b)=>a.due-b.due).map(i=>i.questionId);
}
export type ReviewSummary={due:number;inDeck:number;byStep:number[];upcoming:{date:string;count:number}[]};
export async function reviewSummary(db:Database,userId:string,examId:string,now=Date.now(),zone='UTC'):Promise<ReviewSummary> {
 requireId(examId);
 const items=[...schedule(await answers(db,userId,examId)).values()];
 const local=(t:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
 const upcoming:{date:string;count:number}[]=[];
 for(let d=1;d<=7;d++){const date=local(now+d*DAY);upcoming.push({date,count:items.filter(i=>i.due>now&&local(i.due)===date).length});}
 return {due:items.filter(i=>i.due<=now).length,inDeck:items.length,byStep:INTERVAL_DAYS.map((_,s)=>items.filter(i=>i.step===s).length),upcoming};
}

// ---- STU-13: study planner and streak ----
export type PlanDay={date:string;label:string;reviews:number;newQuestions:number;focus:{id:string;name:string}|null;paper:boolean;today:boolean};
export type Planner={examDate:string|null;daysLeft:number|null;dailyTarget:number;targetSource:'profile'|'default';streak:number;bestStreak:number;answeredToday:number;days:PlanDay[];unseen:number;paperReady:boolean};
// When a student has not set a daily target the planner uses 20 questions a day; this is a starting suggestion
// (a technical default), shown as such, and the student can change it in their profile.
export const DEFAULT_DAILY_TARGET=20;
export async function studyPlanner(db:Database,userId:string,examId:string,now=Date.now()):Promise<Planner> {
 requireId(examId);
 const [profile]=await db.query<{examDate:string|null;dailyTarget:number|null;timezone:string}>(`SELECT exam_date::text AS "examDate",daily_target AS "dailyTarget",timezone FROM student_profiles WHERE user_id=$1`,[userId]);
 const zone=profile?.timezone&&validTimezone(profile.timezone)?profile.timezone:'UTC';
 const local=(t:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
 const today=local(now);
 const target=profile?.dailyTarget??DEFAULT_DAILY_TARGET;
 // Streak: consecutive days, ending today or yesterday, with at least one answer in this exam.
 const days=await db.query<{d:string;n:number}>(`SELECT to_char(i.answered_at AT TIME ZONE $3,'YYYY-MM-DD') AS d,count(*)::int AS n FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id WHERE a.user_id=$1 AND a.exam_id=$2 AND i.answered_at IS NOT NULL GROUP BY 1 ORDER BY 1 DESC LIMIT 400`,[userId,examId,zone]);
 const set=new Set(days.map(d=>d.d));
 const back=(n:number)=>local(Date.parse(`${today}T12:00:00Z`)-n*DAY);
 let streak=0;for(let k=set.has(today)?0:1;set.has(back(k));k++)streak++;
 const sorted=[...set].sort();let best=0,run=0,prev='';
 for(const d of sorted){run=prev&&Date.parse(`${d}T12:00:00Z`)-Date.parse(`${prev}T12:00:00Z`)===DAY?run+1:1;best=Math.max(best,run);prev=d;}
 const answeredToday=days.find(d=>d.d===today)?.n??0;
 // Reviews per day for the next week, from the spaced-repetition schedule.
 const items=[...schedule(await answers(db,userId,examId)).values()];
 const [{unseen}]=await db.query<{unseen:number}>(`SELECT count(*)::int AS unseen FROM questions q WHERE q.exam_id=$2 AND q.status='published' AND NOT EXISTS(SELECT 1 FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id WHERE a.user_id=$1 AND i.question_id=q.id AND i.selected IS NOT NULL)`,[userId,examId]);
 // Focus topics rotate through the weakest topics (lowest share correct on the latest answer), then untried ones.
 const topics=await db.query<{id:string;name:string;share:number|null}>(`WITH last AS (SELECT DISTINCT ON (i.question_id) i.question_id,i.correct FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id WHERE a.user_id=$1 AND a.exam_id=$2 AND i.selected IS NOT NULL AND (a.mode='revision' OR a.submitted_at IS NOT NULL) ORDER BY i.question_id,i.answered_at DESC)
  SELECT COALESCE(p.id,t.id) AS id,COALESCE(p.name,t.name) AS name,(count(*) FILTER (WHERE l.correct))::float/NULLIF(count(l.question_id),0) AS share FROM questions q JOIN topics t ON t.id=q.topic_id LEFT JOIN topics p ON p.id=t.parent_id LEFT JOIN last l ON l.question_id=q.id
  WHERE q.exam_id=$2 AND q.status='published' GROUP BY 1,2 HAVING count(*) FILTER (WHERE l.correct IS NOT TRUE)>0 ORDER BY share ASC NULLS LAST,2 LIMIT 7`,[userId,examId]);
 const [exam]=await db.query<{blueprint:{count?:number};settings:{durationMinutes?:number}}>('SELECT blueprint,settings FROM exams WHERE id=$1',[examId]);
 const paperReady=Number(exam?.blueprint?.count)>0&&Number(exam?.settings?.durationMinutes)>0;
 const examDate=profile?.examDate??null;
 const daysLeft=examDate?Math.round((Date.parse(examDate)-Date.parse(today))/DAY):null;
 const plan:PlanDay[]=[];let left=unseen;// each new question is planned once across the week
 for(let d=0;d<7;d++){
  const date=local(now+d*DAY);
  if(daysLeft!==null&&d>daysLeft)break;
  const reviews=d===0?items.filter(i=>local(i.due)<=date).length:items.filter(i=>local(i.due)===date).length;// today includes anything overdue
  const fresh=Math.max(0,Math.min(target-reviews,left));left-=fresh;
  plan.push({date,label:d===0?'Today':d===1?'Tomorrow':new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short',timeZone:'UTC'}),
   reviews,newQuestions:fresh,focus:topics.length?topics[d%topics.length]:null,
   // One timed paper a week, on the 7th day, when Exam Mode is configured; never on the exam day itself.
   paper:paperReady&&d===6&&daysLeft!==6,today:d===0});
 }
 return {examDate,daysLeft,dailyTarget:target,targetSource:profile?.dailyTarget?'profile':'default',streak,bestStreak:best,answeredToday,days:plan,unseen,paperReady};
}
// STU-13: the student's own notes as text, without question content (content is protected, PROT-4).
export async function exportNotes(db:Database,userId:string) {
 const rows=await db.query<{exam:string;topic:string|null;sittings:string|null;note:string;updated:string}>(`SELECT e.name AS exam,COALESCE(p.name,t.name) AS topic,(SELECT string_agg(s.label,', ' ORDER BY s.year,s.month) FROM question_sittings qs JOIN sittings s ON s.id=qs.sitting_id WHERE qs.question_id=q.id) AS sittings,n.body AS note,to_char(n.updated_at,'YYYY-MM-DD') AS updated
  FROM question_notes n JOIN questions q ON q.id=n.question_id JOIN exams e ON e.id=q.exam_id LEFT JOIN topics t ON t.id=q.topic_id LEFT JOIN topics p ON p.id=t.parent_id WHERE n.user_id=$1 ORDER BY e.name,2 NULLS LAST,n.updated_at`,[userId]);
 const lines=['# My Recalls Tutor notes',`Exported ${new Date().toISOString().slice(0,10)}. These are your own notes; question text is not included.`,''];
 let exam='',topic:string|null='';
 for(const r of rows){if(r.exam!==exam){lines.push(`## ${r.exam}`,'');exam=r.exam;topic='';}
  if(r.topic!==topic){lines.push(`### ${r.topic??'No topic'}`,'');topic=r.topic;}
  lines.push(`- ${r.note.replace(/\r?\n/g,'\n  ')}`,`  (${[r.sittings,`updated ${r.updated}`].filter(Boolean).join(' · ')})`,'');}
 if(!rows.length)lines.push('You have no notes yet. Add one from any question with the Note tool.');
 return lines.join('\n');
}

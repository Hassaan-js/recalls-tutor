import type {Database} from '../db/client';
import {requireId} from './studio';
import type {ExamSettings} from './catalogue-admin';
// STU-11: a student's own progress in one exam. Every figure comes from answers the student could already see
// feedback for (Revision answers, and Exam Mode answers once submitted), the same rule as the practice home.
const SEEN=`i.selected IS NOT NULL AND (a.mode='revision' OR a.submitted_at IS NOT NULL)`;
const DEFAULT_HIGH_YIELD=2,RECENT=100,WEEKS=12;
export type Progress={exam:{id:string;name:string};published:number;
 weeks:{start:string;answered:number;correct:number}[];
 topics:{id:string;topic:string;answered:number;correct:number;recentAnswered:number;recentCorrect:number}[];
 highYield:{min:number;hy:{answered:number;correct:number};other:{answered:number;correct:number}};
 pace:{revisionMs:number|null;examMs:number|null;examPaceMs:number|null;answered:number};
 readiness:{tried:number;recentAnswered:number;recentCorrect:number;passMark:number|null}};
export async function getProgress(db:Database,userId:string,examId:string):Promise<Progress|null> {
 requireId(examId);
 const [exam]=await db.query<{id:string;name:string;blueprint:{count?:number};settings:ExamSettings;published:number}>(`SELECT e.id,e.name,e.blueprint,e.settings,(SELECT count(*)::int FROM questions q WHERE q.exam_id=e.id AND q.status='published') AS published FROM exams e WHERE e.id=$1`,[examId]);
 if(!exam)return null;
 const hyMin=Number(exam.settings?.highYieldMin)>=2?Number(exam.settings.highYieldMin):DEFAULT_HIGH_YIELD;
 // Latest visible answer per question, for topic, high-yield and coverage figures.
 const last=`SELECT DISTINCT ON (i.question_id) i.question_id,i.correct,i.answered_at FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id WHERE a.user_id=$1 AND a.exam_id=$2 AND ${SEEN} ORDER BY i.question_id,i.answered_at DESC`;
 const [weeks,topics,hy,pace,recent]=await Promise.all([
  db.query<Progress['weeks'][number]>(`WITH w AS (SELECT generate_series(date_trunc('week',now())-interval '${WEEKS-1} weeks',date_trunc('week',now()),interval '1 week') AS start)
   SELECT w.start::date::text AS start,count(i.*)::int AS answered,count(*) FILTER (WHERE i.correct)::int AS correct FROM w
   LEFT JOIN (practice_items i JOIN practice_attempts a ON a.id=i.attempt_id AND a.user_id=$1 AND a.exam_id=$2) ON ${SEEN} AND date_trunc('week',i.answered_at)=w.start GROUP BY w.start ORDER BY w.start`,[userId,examId]),
  db.query<Progress['topics'][number]>(`WITH l AS (${last}) SELECT COALESCE(p.id,t.id) AS id,COALESCE(p.name,t.name) AS topic,count(*)::int AS answered,count(*) FILTER (WHERE l.correct)::int AS correct,
   count(*) FILTER (WHERE l.answered_at>now()-interval '30 days')::int AS "recentAnswered",count(*) FILTER (WHERE l.correct AND l.answered_at>now()-interval '30 days')::int AS "recentCorrect"
   FROM l JOIN questions q ON q.id=l.question_id AND q.status='published' JOIN topics t ON t.id=q.topic_id LEFT JOIN topics p ON p.id=t.parent_id GROUP BY 1,2 ORDER BY 2`,[userId,examId]),
  db.query<{hy:boolean;answered:number;correct:number}>(`WITH l AS (${last}) SELECT (SELECT count(*) FROM question_sittings qs WHERE qs.question_id=l.question_id)>=$3 AS hy,count(*)::int AS answered,count(*) FILTER (WHERE l.correct)::int AS correct FROM l JOIN questions q ON q.id=l.question_id AND q.status='published' GROUP BY 1`,[userId,examId,hyMin]),
  db.query<{mode:string;ms:number|null;n:number}>(`SELECT a.mode,avg(i.time_ms) FILTER (WHERE i.time_ms>0)::float AS ms,count(*) FILTER (WHERE i.time_ms>0)::int AS n FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id WHERE a.user_id=$1 AND a.exam_id=$2 AND ${SEEN} GROUP BY a.mode`,[userId,examId]),
  db.query<{answered:number;correct:number;tried:number}>(`SELECT (SELECT count(*)::int FROM (SELECT 1 FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id WHERE a.user_id=$1 AND a.exam_id=$2 AND ${SEEN} ORDER BY i.answered_at DESC LIMIT ${RECENT}) r) AS answered,
   (SELECT count(*) FILTER (WHERE c)::int FROM (SELECT i.correct AS c FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id WHERE a.user_id=$1 AND a.exam_id=$2 AND ${SEEN} ORDER BY i.answered_at DESC LIMIT ${RECENT}) r) AS correct,
   (SELECT count(*)::int FROM (${last}) l JOIN questions q ON q.id=l.question_id AND q.status='published') AS tried`,[userId,examId]),
 ]);
 const pick=(flag:boolean)=>{const r=hy.find(h=>h.hy===flag);return {answered:r?.answered??0,correct:r?.correct??0};};
 const count=Number(exam.blueprint?.count),minutes=Number(exam.settings?.durationMinutes);
 const modeMs=(m:string)=>{const r=pace.find(p=>p.mode===m);return r&&r.n?Math.round(r.ms!):null;};
 const passMark=Number(exam.settings?.passMarkPercent)>0?Number(exam.settings.passMarkPercent):null;
 return {exam:{id:exam.id,name:exam.name},published:exam.published,weeks,topics,
  highYield:{min:hyMin,hy:pick(true),other:pick(false)},
  pace:{revisionMs:modeMs('revision'),examMs:modeMs('exam'),examPaceMs:Number.isInteger(count)&&count>0&&minutes>0?Math.round(minutes*60000/count):null,answered:pace.reduce((s,p)=>s+p.n,0)},
  readiness:{tried:recent[0].tried,recentAnswered:recent[0].answered,recentCorrect:recent[0].correct,passMark}};
}

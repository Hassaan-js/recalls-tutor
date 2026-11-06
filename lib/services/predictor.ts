import type {Database} from '../db/client';
import {requireId} from './studio';
import type {ExamSettings} from './catalogue-admin';
// PP-1 to PP-4: the Pass Predictor. Version 1 is a transparent rule-based estimate from practice answers (PP-2).
// Every number below is shown to the student in "How this is worked out", and every prediction carries the
// disclaimer. The weights are a first version: PP-3 compares them with real results once outcomes exist.
export const DISCLAIMER='This is an estimate from your practice performance, not a guarantee of your exam result.';
export const UNLOCK={papers:1,answered:300};// PRD: one complete Exam Mode paper and at least 300 answered questions
export const WEIGHTS={papers:0.5,firstAttempt:0.2,highYield:0.15,latestSitting:0.15};
const PAPER_DECAY=0.5,RECENT_PAPERS=5,FIRST_ATTEMPT_WINDOW=300,DEFAULT_SECONDS=60,DEFAULT_HY=2;
export type Band='low'|'borderline'|'likely'|'very_likely';
export const BAND_LABEL:Record<Band,string>={low:'Low',borderline:'Borderline',likely:'Likely',very_likely:'Very likely'};
type Inputs={papers:{score:number;at:string}[];firstAttempt:{answered:number;correct:number};highYield:{answered:number;correct:number};latest:{label:string|null;answered:number;correct:number};
 coverage:{tried:number;published:number};pace:{studentMs:number|null;examMs:number|null};confidence:{sure:number;sureWrong:number};answered:number};
export type Estimate={score:number;low:number;high:number;band:Band|null;parts:{label:string;value:number|null;weight:number}[];adjustments:{label:string;points:number}[];spreadReasons:string[]};
export type Prediction={exam:{id:string;name:string};unlocked:boolean;trial:boolean;progress:{papers:number;answered:number};passMark:number|null;
 estimate:Estimate|null;trend:{weekOf:string;score:number|null}[];topics:{id:string;name:string;accuracy:number|null;remaining:number;pointsAvailable:number;hours:number;gainPerHour:number}[];
 daily:{toLikely:number;questionsPerDay:number|null;days:number;examDate:string|null}|null;inputs:Inputs|null};
const pct=(c:number,n:number)=>n?100*c/n:null;
const round1=(v:number)=>Math.round(v*10)/10;
const SEEN=`i.selected IS NOT NULL AND (a.mode='revision' OR a.submitted_at IS NOT NULL)`;
async function gather(db:Database,userId:string,examId:string,cutoff:string,blueprintCount:number|null,hyMin:number,examPaceMs:number|null):Promise<Inputs> {
 const p=[userId,examId,cutoff];
 // Complete Exam Mode papers: a published paper, or a timed set as long as the real exam.
 const papers=await db.query<{score:number;at:string}>(`SELECT 100.0*count(*) FILTER (WHERE i.correct)/NULLIF(count(*),0) AS score,a.submitted_at::text AS at FROM practice_attempts a JOIN practice_items i ON i.attempt_id=a.id
  WHERE a.user_id=$1 AND a.exam_id=$2 AND a.mode='exam' AND a.access='full' AND a.submitted_at IS NOT NULL AND a.submitted_at<=$3::timestamptz
  GROUP BY a.id HAVING a.paper_id IS NOT NULL OR ($4::int IS NOT NULL AND count(*)>=$4::int) ORDER BY a.submitted_at DESC LIMIT ${RECENT_PAPERS}`,[...p,blueprintCount]);
 // First attempt at each question only (PP-2), from answers whose feedback the student has seen.
 const first=`SELECT DISTINCT ON (i.question_id) i.question_id,i.correct,i.confidence,i.answered_at FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id
  WHERE a.user_id=$1 AND a.exam_id=$2 AND ${SEEN} AND i.answered_at<=$3::timestamptz ORDER BY i.question_id,i.answered_at`;
 const [fa]=await db.query<{answered:number;correct:number}>(`SELECT count(*)::int AS answered,count(*) FILTER (WHERE f.correct)::int AS correct FROM (SELECT * FROM (${first}) x ORDER BY answered_at DESC LIMIT ${FIRST_ATTEMPT_WINDOW}) f`,p);
 const [hy]=await db.query<{answered:number;correct:number}>(`SELECT count(*)::int AS answered,count(*) FILTER (WHERE f.correct)::int AS correct FROM (${first}) f WHERE (SELECT count(*) FROM question_sittings qs WHERE qs.question_id=f.question_id)>=$4`,[...p,hyMin]);
 const [latest]=await db.query<{id:string;label:string}>(`SELECT id,label FROM sittings WHERE exam_id=$1 AND published ORDER BY year DESC,month DESC NULLS LAST,starts_on DESC NULLS LAST LIMIT 1`,[examId]);
 const [ls]=latest?await db.query<{answered:number;correct:number}>(`SELECT count(*)::int AS answered,count(*) FILTER (WHERE f.correct)::int AS correct FROM (${first}) f JOIN question_sittings qs ON qs.question_id=f.question_id AND qs.sitting_id=$4`,[...p,latest.id]):[{answered:0,correct:0}];
 const [cov]=await db.query<{tried:number;published:number}>(`SELECT (SELECT count(*)::int FROM (${first}) f JOIN questions q ON q.id=f.question_id AND q.status='published') AS tried,(SELECT count(*)::int FROM questions WHERE exam_id=$2 AND status='published') AS published`,p);
 const [pace]=await db.query<{ms:number|null}>(`SELECT avg(i.time_ms) FILTER (WHERE i.time_ms>0)::float AS ms FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id WHERE a.user_id=$1 AND a.exam_id=$2 AND a.mode='exam' AND a.submitted_at IS NOT NULL AND i.answered_at<=$3::timestamptz`,p);
 const [conf]=await db.query<{sure:number;sure_wrong:number}>(`SELECT count(*) FILTER (WHERE f.confidence='sure')::int AS sure,count(*) FILTER (WHERE f.confidence='sure' AND NOT f.correct)::int AS sure_wrong FROM (${first}) f`,p);
 const [all]=await db.query<{n:number}>(`SELECT count(*)::int AS n FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id WHERE a.user_id=$1 AND a.exam_id=$2 AND ${SEEN} AND i.answered_at<=$3::timestamptz`,p);
 return {papers:papers.map(r=>({score:Number(r.score),at:r.at})),firstAttempt:fa,highYield:hy,latest:{label:latest?.label??null,...ls},coverage:cov,pace:{studentMs:pace?.ms??null,examMs:examPaceMs},confidence:{sure:conf.sure,sureWrong:conf.sure_wrong},answered:all.n};
}
// The rule-based score (PP-2). Missing parts drop out and the remaining weights are scaled up.
export function estimate(i:Inputs,passMark:number|null):Estimate|null {
 if(!i.papers.length)return null;
 let wsum=0,psum=0;i.papers.forEach((p,k)=>{const w=PAPER_DECAY**k;wsum+=w;psum+=w*p.score;});
 const parts=[
  {label:i.papers.length===1?'Your complete paper':`Your last ${i.papers.length} complete papers (most recent counts most)`,value:psum/wsum,weight:WEIGHTS.papers},
  {label:'First-attempt accuracy (your last 300 new questions)',value:pct(i.firstAttempt.correct,i.firstAttempt.answered),weight:WEIGHTS.firstAttempt},
  {label:'High-yield questions, first attempt',value:i.highYield.answered>=10?pct(i.highYield.correct,i.highYield.answered):null,weight:WEIGHTS.highYield},
  {label:i.latest.label?`Latest sitting (${i.latest.label}), first attempt`:'Latest sitting, first attempt',value:i.latest.answered>=10?pct(i.latest.correct,i.latest.answered):null,weight:WEIGHTS.latestSitting},
 ];
 const used=parts.filter(p=>p.value!==null),total=used.reduce((s,p)=>s+p.weight,0);
 let score=used.reduce((s,p)=>s+p.value!*p.weight,0)/total;
 const adjustments:{label:string;points:number}[]=[];
 // Slower than the real exam's pace costs marks on the day: up to 5 points.
 if(i.pace.studentMs&&i.pace.examMs&&i.pace.studentMs>i.pace.examMs*1.1){const pts=-Math.min(5,(i.pace.studentMs/i.pace.examMs-1)*20);adjustments.push({label:'Slower than exam pace in timed practice',points:round1(pts)});score+=pts;}
 score=Math.max(0,Math.min(100,score));
 // The range widens when less of the bank has been tried, with few papers, or with confident wrong answers.
 const coverage=i.coverage.published?i.coverage.tried/i.coverage.published:0,reasons:string[]=[];
 let spread=4;
 if(coverage<0.5){spread+=(0.5-coverage)*12;reasons.push(`you have tried ${Math.round(coverage*100)}% of the questions`);}
 if(i.papers.length<3){spread+=(3-i.papers.length)*1.5;reasons.push(i.papers.length===1?'one complete paper so far':'two complete papers so far');}
 const overconfident=i.confidence.sure>=20?i.confidence.sureWrong/i.confidence.sure:0;
 if(overconfident>0.15){spread+=Math.min(4,(overconfident-0.15)*20);reasons.push(`${Math.round(overconfident*100)}% of answers you were sure about were wrong`);}
 spread=Math.min(15,spread);
 const low=Math.max(0,score-spread),high=Math.min(100,score+spread);
 // Bands only exist against a published pass mark; without one the score range is shown on its own.
 const band:Band|null=passMark===null?null:low>=passMark+5?'very_likely':low>=passMark?'likely':high>=passMark?'borderline':'low';
 return {score:round1(score),low:round1(low),high:round1(high),band,parts,adjustments,spreadReasons:reasons};
}
export async function getPrediction(db:Database,userId:string,examId:string,now=new Date()):Promise<Prediction|null> {
 requireId(examId);
 const [exam]=await db.query<{id:string;name:string;blueprint:{count?:number};settings:ExamSettings}>('SELECT id,name,blueprint,settings FROM exams WHERE id=$1',[examId]);
 if(!exam)return null;
 const count=Number(exam.blueprint?.count)>0?Number(exam.blueprint.count):null,minutes=Number(exam.settings?.durationMinutes);
 const paceMs=count&&minutes>0?minutes*60000/count:null;
 const passMark=Number(exam.settings?.passMarkPercent)>0?Number(exam.settings.passMarkPercent):null;
 const hyMin=Number(exam.settings?.highYieldMin)>=2?Number(exam.settings.highYieldMin):DEFAULT_HY;
 const [access]=await db.query<{full:boolean;trial:boolean}>(`SELECT bool_or(source IN ('subscription','partner','complimentary')) AS full,bool_or(source='trial') AS trial FROM entitlements WHERE user_id=$1 AND exam_id=$2 AND revoked_at IS NULL AND ends_at>now()`,[userId,examId]);
 const inputs=await gather(db,userId,examId,now.toISOString(),count,hyMin,paceMs);
 const unlocked=Boolean(access?.full)&&inputs.papers.length>=UNLOCK.papers&&inputs.answered>=UNLOCK.answered;
 const base={exam:{id:exam.id,name:exam.name},unlocked,trial:!access?.full&&Boolean(access?.trial),progress:{papers:inputs.papers.length,answered:inputs.answered},passMark};
 // TRIAL-1: trial students see a teaser only, and nothing unlocks before the PRD thresholds.
 if(!unlocked)return {...base,estimate:null,trend:[],topics:[],daily:null,inputs:null};
 const est=estimate(inputs,passMark);
 // 4-week trend: the same rule applied to what was known at the end of each of the last four weeks.
 const trend:{weekOf:string;score:number|null}[]=[];
 for(const back of [21,14,7]){const cut=new Date(now.getTime()-back*86400_000);const e=estimate(await gather(db,userId,examId,cut.toISOString(),count,hyMin,paceMs),passMark);trend.push({weekOf:cut.toISOString().slice(0,10),score:e?.score??null});}
 trend.push({weekOf:now.toISOString().slice(0,10),score:est?.score??null});
 // Top topics by gain per study hour: share of the bank × marks still to win, over the time to work through
 // the questions not yet answered correctly at the student's own pace.
 const secondsPerQ=(inputs.pace.studentMs??paceMs??DEFAULT_SECONDS*1000)/1000;
 const rows=await db.query<{id:string;name:string;published:number;answered:number;correct:number;remaining:number}>(`WITH last AS (SELECT DISTINCT ON (i.question_id) i.question_id,i.correct FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id WHERE a.user_id=$1 AND a.exam_id=$2 AND ${SEEN} ORDER BY i.question_id,i.answered_at DESC)
  SELECT COALESCE(p.id,t.id) AS id,COALESCE(p.name,t.name) AS name,count(q.id)::int AS published,count(l.question_id)::int AS answered,count(*) FILTER (WHERE l.correct)::int AS correct,count(*) FILTER (WHERE l.correct IS NOT TRUE)::int AS remaining
  FROM questions q JOIN topics t ON t.id=q.topic_id LEFT JOIN topics p ON p.id=t.parent_id LEFT JOIN last l ON l.question_id=q.id WHERE q.exam_id=$2 AND q.status='published' GROUP BY 1,2`,[userId,examId]);
 const bank=rows.reduce((s,r)=>s+r.published,0)||1;
 const topics=rows.filter(r=>r.remaining>0).map(r=>{const acc=pct(r.correct,r.answered);const points=(r.published/bank)*(100-(acc??0));const hours=r.remaining*secondsPerQ/3600;
  return {id:r.id,name:r.name,accuracy:acc===null?null:Math.round(acc),remaining:r.remaining,pointsAvailable:round1(points),hours:round1(hours),gainPerHour:round1(points/Math.max(hours,0.1))};})
  .sort((a,b)=>b.gainPerHour-a.gainPerHour).slice(0,3);
 // Daily target to reach "Likely": the points still needed, and the questions in the top topics spread over
 // the days to the exam (or four weeks when no exam date is set).
 const [profile]=await db.query<{date:string|null}>('SELECT exam_date::text AS date FROM student_profiles WHERE user_id=$1',[userId]);
 const examDate=profile?.date&&Date.parse(profile.date)>now.getTime()?profile.date:null;
 const days=examDate?Math.max(1,Math.ceil((Date.parse(examDate)-now.getTime())/86400_000)):28;
 let daily:Prediction['daily']=null;
 if(est&&passMark!==null){const toLikely=Math.max(0,round1(passMark+(est.score-est.low)-est.score));
  const questions=topics.reduce((s,t)=>s+t.remaining,0);
  daily={toLikely,questionsPerDay:toLikely>0&&questions?Math.ceil(questions/days):null,days,examDate};}
 return {...base,estimate:est,trend,topics,daily,inputs};
}
// ---- PP-3: "Did you pass?" ----
export async function recordOutcome(db:Database,userId:string,examId:string,input:{passed:boolean|null;satOn:string|null}) {
 requireId(examId);
 if(input.satOn&&(!/^\d{4}-\d{2}-\d{2}$/.test(input.satOn)||Date.parse(input.satOn)>Date.now()))throw new Error('Enter the date you sat the exam.');
 const prediction=await getPrediction(db,userId,examId).catch(()=>null);
 const e=prediction?.estimate??null;
 await db.query(`INSERT INTO pass_outcomes(user_id,exam_id,sat_on,passed,band,predicted_low,predicted_high) VALUES($1,$2,$3,$4,$5,$6,$7)
  ON CONFLICT(user_id,exam_id) DO UPDATE SET sat_on=EXCLUDED.sat_on,passed=EXCLUDED.passed,answered_at=now()`,[userId,examId,input.satOn,input.passed,e?.band??null,e?.low??null,e?.high??null]);
}
export async function outcomePrompt(db:Database,userId:string,examId:string) {
 const [row]=await db.query<{date:string|null;answered:boolean}>(`SELECT p.exam_date::text AS date,EXISTS(SELECT 1 FROM pass_outcomes o WHERE o.user_id=$1 AND o.exam_id=$2) AS answered FROM student_profiles p WHERE p.user_id=$1 AND $2=ANY(p.exam_ids)`,[userId,examId]);
 return Boolean(row?.date&&!row.answered&&Date.parse(row.date)<=Date.now());
}
// Admin calibration: how often each band's students passed, once enough outcomes exist.
export const CALIBRATION_MIN=200;
export async function predictorCalibration(db:Database) {
 return db.query<{examId:string;exam:string;outcomes:number;band:string|null;students:number;passed:number}>(`SELECT e.id AS "examId",e.name AS exam,(SELECT count(*)::int FROM pass_outcomes x WHERE x.exam_id=e.id AND x.passed IS NOT NULL) AS outcomes,o.band,count(o.*)::int AS students,count(*) FILTER (WHERE o.passed)::int AS passed
  FROM exams e LEFT JOIN pass_outcomes o ON o.exam_id=e.id AND o.passed IS NOT NULL GROUP BY e.id,e.name,o.band ORDER BY e.name,o.band`);
}

import type {Database} from '../db/client';
import {requireId} from './studio';
// STU-12: where a score on a published paper sits among other students who sat the same paper. Shown only once
// 30 or more other students have a completed attempt (PRD), so a handful of attempts never mislead anyone.
// Each student counts once, by their first completed attempt; withdrawn questions are not scored.
export const PEERS_MIN=30;
export async function paperPercentile(db:Database,userId:string,attemptId:string) {
 requireId(attemptId);
 const [a]=await db.query<{paper_id:string|null;submitted:boolean;user_id:string}>('SELECT paper_id,submitted_at IS NOT NULL AS submitted,user_id FROM practice_attempts WHERE id=$1',[attemptId]);
 if(!a||a.user_id!==userId||!a.paper_id||!a.submitted)return null;
 const score=`(SELECT 100.0*count(*) FILTER (WHERE i.correct)/NULLIF(count(*),0) FROM practice_items i JOIN questions q ON q.id=i.question_id WHERE i.attempt_id=x.id AND q.status<>'retired')`;
 const [mine]=await db.query<{score:number|null}>(`SELECT ${score}::float AS score FROM practice_attempts x WHERE x.id=$1`,[attemptId]);
 const peers=await db.query<{score:number}>(`SELECT DISTINCT ON (x.user_id) ${score}::float AS score FROM practice_attempts x WHERE x.paper_id=$1 AND x.submitted_at IS NOT NULL AND x.access='full' AND x.user_id<>$2 ORDER BY x.user_id,x.submitted_at`,[a.paper_id,userId]);
 const scores=peers.map(p=>p.score).filter((s):s is number=>s!==null);
 if(scores.length<PEERS_MIN||mine?.score===null||mine?.score===undefined)return {available:false as const,peers:scores.length,needed:PEERS_MIN};
 const below=scores.filter(s=>s<mine.score!).length,equal=scores.filter(s=>s===mine.score).length;
 // Mid-rank percentile: ties count half, so equal scores land on the same percentile.
 const percentile=Math.round(100*(below+equal/2)/scores.length);
 const sorted=[...scores].sort((x,y)=>x-y),median=sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;
 return {available:true as const,peers:scores.length,percentile,median:Math.round(median)};
}

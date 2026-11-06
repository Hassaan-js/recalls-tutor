import type { Database } from '../db/client';
import { requirePermission, type Role, type ContentAction } from '../auth/permissions';
const transitions: Record<ContentAction,{from:string[];to:string}> = {
 submit_review:{from:['raw','ai_refined'],to:'in_review'},
 approve:{from:['in_review'],to:'approved'},
 publish:{from:['approved'],to:'published'},
 retire:{from:['published'],to:'retired'},
};
// Internal service only. Actor ID must come from a verified server session, never request JSON.
// No public/admin write endpoint is exposed until authentication is integrated.
export async function transitionQuestion(db: Database, actorId: string, questionId: string, action: ContentAction) {
 return db.transaction(async tx => {
   const [actor] = await tx.query<{role:Role}>("SELECT role FROM app_users WHERE id=$1 AND status='active' FOR SHARE",[actorId]);
   if (!actor) throw new Error('UNAUTHENTICATED');
   requirePermission(actor.role,action);
   const [question] = await tx.query<{status:string;current_version_id:string|null}>('SELECT status,current_version_id FROM questions WHERE id=$1 FOR UPDATE',[questionId]);
   if (!question) throw new Error('NOT_FOUND');
   const transition = transitions[action];
   if (!transition.from.includes(question.status)) throw new Error('INVALID_TRANSITION');
   if (!question.current_version_id) throw new Error('VERSION_REQUIRED');
   await tx.query('UPDATE questions SET status=$1 WHERE id=$2',[transition.to,questionId]);
   await tx.query('INSERT INTO audit_log(actor_id,action,entity_id,before_json,after_json) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',[actorId,action,questionId,JSON.stringify({status:question.status}),JSON.stringify({status:transition.to})]);
   return {status:transition.to};
 });
}

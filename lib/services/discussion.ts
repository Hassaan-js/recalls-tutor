import type {Database} from '../db/client';
import {requireId,requireStaff} from './studio';
// STU-15: moderated discussion under each question. Students can post once they have seen the answer; a comment
// is public to other students only after staff approve it. Authors are never named, only "A student".
const DAILY_LIMIT=10;// technical safety value against spam
async function visibleItem(db:Database,userId:string,attemptId:string,position:number) {
 requireId(attemptId);
 const [item]=await db.query<{question_id:string;visible:boolean;status:string}>(`SELECT i.question_id,(a.mode='revision' AND i.selected IS NOT NULL) OR a.submitted_at IS NOT NULL AS visible,q.status
  FROM practice_items i JOIN practice_attempts a ON a.id=i.attempt_id JOIN questions q ON q.id=i.question_id WHERE a.id=$1 AND a.user_id=$2 AND i.position=$3`,[attemptId,userId,position]);
 if(!item)throw new Error('Question not found in this session.');
 if(!item.visible)throw new Error('Discussion opens once you have seen the answer.');
 if(item.status!=='published')throw new Error('This question is no longer available.');
 return item.question_id;
}
export type Comment={id:string;body:string;createdAt:string;mine:boolean;status:string};
export async function listComments(db:Database,userId:string,attemptId:string,position:number):Promise<Comment[]> {
 const questionId=await visibleItem(db,userId,attemptId,position);
 return db.query<Comment>(`SELECT id,body,created_at::text AS "createdAt",user_id=$2 AS mine,status FROM question_comments WHERE question_id=$1 AND (status='approved' OR (user_id=$2 AND status='pending')) ORDER BY created_at LIMIT 100`,[questionId,userId]);
}
export async function postComment(db:Database,userId:string,attemptId:string,position:number,raw:string) {
 const body=raw.trim();
 if(!body||body.length>1500)throw new Error('Write up to 1,500 characters.');
 // Sharing contact details or asking for content off the platform is not allowed (PROT, terms).
 if(/\b[\w.+-]+@[\w-]+\.[\w.]+\b|(?:\+?\d[\s-]?){9,}|whatsapp|telegram|t\.me\//i.test(body))throw new Error('Please don’t share contact details or group links in comments.');
 const questionId=await visibleItem(db,userId,attemptId,position);
 const [{n}]=await db.query<{n:number}>(`SELECT count(*)::int AS n FROM question_comments WHERE user_id=$1 AND created_at>now()-interval '1 day'`,[userId]);
 if(n>=DAILY_LIMIT)throw new Error('You have posted the most comments allowed today.');
 const [row]=await db.query<{id:string}>('INSERT INTO question_comments(question_id,user_id,body) VALUES($1,$2,$3) RETURNING id',[questionId,userId,body]);
 return row.id;
}
export async function listPendingComments(db:Database,actorId:string) {
 await requireStaff(db,actorId);
 return db.query<{id:string;questionId:string;examName:string;stem:string;body:string;createdAt:string}>(`SELECT c.id,c.question_id AS "questionId",e.name AS "examName",left(v.stem,140) AS stem,c.body,c.created_at::text AS "createdAt"
  FROM question_comments c JOIN questions q ON q.id=c.question_id JOIN exams e ON e.id=q.exam_id JOIN question_versions v ON v.id=q.current_version_id WHERE c.status='pending' ORDER BY c.created_at LIMIT 100`);
}
export async function moderateComment(db:Database,actorId:string,commentId:string,approve:boolean) {
 requireId(commentId);await requireStaff(db,actorId);
 const rows=await db.query<{id:string}>(`UPDATE question_comments SET status=$2,moderated_by=$3,moderated_at=now() WHERE id=$1 AND status='pending' RETURNING id`,[commentId,approve?'approved':'rejected',actorId]);
 if(!rows.length)throw new Error('This comment has already been moderated.');
 await db.query('INSERT INTO audit_log(actor_id,entity_id,action,after_json) VALUES($1,$2,$3,$4::jsonb)',[actorId,commentId,approve?'comment.approved':'comment.rejected','{}']);
}

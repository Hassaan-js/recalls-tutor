'use client';
import {useState,useTransition} from 'react';
import {addComment,loadComments} from '@/app/practice/actions';
type Comment={id:string;body:string;createdAt:string;mine:boolean;status:string};
// STU-15: comments other students left on this question, approved by a moderator; authors stay anonymous.
export function Discussion({attemptId,position}:{attemptId:string;position:number}){
 const[busy,start]=useTransition();const[comments,setComments]=useState<Comment[]|null>(null);const[text,setText]=useState('');const[note,setNote]=useState<{error?:string;success?:string}>({});
 const load=()=>start(async()=>{const r=await loadComments(attemptId,position);if(r.error)setNote({error:r.error});else setComments(r.comments??[]);});
 return <details className="tutor discussion" onToggle={e=>{if((e.target as HTMLDetailsElement).open&&comments===null)load();}}><summary>Discussion{comments?` (${comments.filter(c=>c.status==='approved').length})`:''}</summary>
  {comments===null?<p className="practice-help">Loading…</p>:comments.length?<ul className="discussion-list">{comments.map(c=><li key={c.id}><p className="discussion-meta">{c.mine?'You':'A student'} · {new Date(c.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}{c.status==='pending'?' · waiting for a moderator':''}</p><p className="tutor-a">{c.body}</p></li>)}</ul>
   :<p className="practice-help">No comments yet. Share a tip or a way you remember this.</p>}
  <form className="discussion-form" onSubmit={e=>{e.preventDefault();const body=text.trim();if(!body)return;start(async()=>{const r=await addComment(attemptId,position,body);setNote(r);if(!r.error){setText('');const l=await loadComments(attemptId,position);if(l.comments)setComments(l.comments);}});}}>
   <label className="studio-sr-only" htmlFor={`comment-${position}`}>Your comment</label>
   <textarea id={`comment-${position}`} rows={3} maxLength={1500} value={text} onChange={e=>setText(e.target.value)} placeholder="Comments are checked by a moderator before others see them." disabled={busy}/>
   <button className="practice-button" disabled={busy||!text.trim()}>Post</button></form>
  {note.error&&<p className="practice-error" role="alert">{note.error}</p>}{note.success&&<p className="practice-help" role="status">{note.success}</p>}
 </details>;
}

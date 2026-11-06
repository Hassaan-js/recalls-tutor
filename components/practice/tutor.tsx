'use client';
import {useState,useTransition} from 'react';
import {askQuestionTutor} from '@/app/practice/actions';
const PRESETS=['Explain this more simply','Why are the other options wrong?','Give me a way to remember this'];
// STU-14: ask about this question's explanation. Answers come only from the approved text.
export function TutorPanel({attemptId,position}:{attemptId:string;position:number}){
 const[busy,start]=useTransition();const[text,setText]=useState('');const[thread,setThread]=useState<{q:string;a:string;outside:boolean}[]>([]);const[error,setError]=useState('');
 const ask=(q:string)=>{const prompt=q.trim();if(!prompt)return;start(async()=>{const r=await askQuestionTutor(attemptId,position,prompt);
  if(r.error)setError(r.error);else{setError('');setThread(t=>[...t,{q:prompt,a:r.answer!,outside:r.outsideScope===true}]);setText('');}});};
 return <details className="tutor"><summary>Ask the tutor about this question</summary>
  <p className="practice-help">The tutor only uses this question’s approved explanation and key notes. It is not medical advice.</p>
  {thread.length>0&&<ol className="tutor-thread" aria-live="polite">{thread.map((t,i)=><li key={i}><p className="tutor-q">{t.q}</p><p className={`tutor-a${t.outside?' is-outside':''}`}>{t.a}</p></li>)}</ol>}
  <div className="tutor-presets">{PRESETS.map(p=><button key={p} type="button" className="practice-ghost" disabled={busy} onClick={()=>ask(p)}>{p}</button>)}</div>
  <form className="tutor-form" onSubmit={e=>{e.preventDefault();ask(text);}}><label className="studio-sr-only" htmlFor={`tutor-${position}`}>Your question</label>
   <input id={`tutor-${position}`} value={text} onChange={e=>setText(e.target.value)} maxLength={300} placeholder="Ask something about this explanation" disabled={busy}/>
   <button className="practice-button" disabled={busy||!text.trim()}>{busy?'Thinking…':'Ask'}</button></form>
  {error&&<p className="practice-error" role="alert">{error}</p>}
 </details>;
}

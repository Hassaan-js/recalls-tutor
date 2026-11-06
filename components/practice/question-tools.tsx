'use client';
import {useActionState,useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {reportError,saveQuestionNote} from '@/app/practice/actions';
const REASONS:[string,string][]=[['wrong_answer','The marked answer is wrong'],['unclear','The question or options are unclear'],['typo','Spelling or formatting'],['outdated','Out of date with current guidance'],['other','Something else']];
// STU-5: a personal note that follows the question into every later session, and "Report an error" for staff.
export function QuestionTools({attemptId,position,note,reported}:{attemptId:string;position:number;note:string;reported:boolean}){
 const router=useRouter();
 const[noteState,noteAction,saving]=useActionState(saveQuestionNote,{});const[reportState,reportAction,sending]=useActionState(reportError,{});
 const[draft,setDraft]=useState(note);const[open,setOpen]=useState(false);const sent=reported||Boolean(reportState.success);
 useEffect(()=>{if(noteState.success)router.refresh();},[noteState,router]);
 useEffect(()=>{if(reportState.success)setOpen(false);},[reportState]);
 return <section className="practice-tools" aria-label="Your tools for this question">
  <form action={noteAction} className="practice-note"><input type="hidden" name="attemptId" value={attemptId}/><input type="hidden" name="position" value={position}/>
   <label htmlFor={`note-${position}`}><strong>Your note</strong> <span>Only you see it. It comes back whenever this question does.</span></label>
   <textarea id={`note-${position}`} name="note" rows={3} maxLength={2000} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="A mnemonic, a guideline to look up, why you picked what you did…"/>
   <span className="practice-note-actions"><button className="practice-ghost" disabled={saving||draft.trim()===note.trim()}>{saving?'Saving…':note&&!draft.trim()?'Remove note':'Save note'}</button>
    {noteState.error?<span className="practice-feedback practice-error" role="alert">{noteState.error}</span>:noteState.success&&draft.trim()===note.trim()?<span className="practice-help" role="status">{noteState.success}</span>:null}</span>
  </form>
  <div className="practice-report">
   {sent?<p className="practice-help" role="status">{reportState.success??'You have reported this question. The content team will review it.'}</p>
    :open?<form action={reportAction}><input type="hidden" name="attemptId" value={attemptId}/><input type="hidden" name="position" value={position}/>
     <fieldset><legend>What is wrong with this question?</legend><div className="practice-checks">{REASONS.map(([value,label],i)=><label key={value}><input type="radio" name="reason" value={value} required defaultChecked={i===0}/>{label}</label>)}</div></fieldset>
     <label className="practice-field">Details <small>optional</small><textarea name="details" rows={3} maxLength={2000} placeholder="What should it say, and where did you check?"/></label>
     {reportState.error&&<p className="practice-feedback practice-error" role="alert">{reportState.error}</p>}
     <span className="practice-note-actions"><button type="button" className="practice-ghost" onClick={()=>setOpen(false)}>Cancel</button><button className="practice-button" disabled={sending}>{sending?'Sending…':'Send report'}</button></span></form>
    :<button type="button" className="practice-link-button" onClick={()=>setOpen(true)}>Report an error in this question</button>}
  </div>
 </section>;
}

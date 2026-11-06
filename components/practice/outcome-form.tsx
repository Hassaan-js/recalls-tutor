'use client';
import {useActionState} from 'react';
import {saveOutcome} from '@/app/practice/actions';
// PP-3: one question after the exam date. Answers are used to check the predictor against real results.
export function OutcomeForm({examId,examName,examDate}:{examId:string;examName:string;examDate:string}) {
 const[state,action,pending]=useActionState(saveOutcome,{});
 if(state.success)return <p className="practice-help" role="status">{state.success}</p>;
 return <form action={action} className="outcome-form"><input type="hidden" name="examId" value={examId}/><input type="hidden" name="satOn" value={examDate}/>
  <fieldset><legend>Did you pass {examName}?</legend>
   <div className="outcome-options">{[['yes','Yes, I passed'],['no','Not this time'],['skip','I didn’t sit it']].map(([v,l])=><label key={v}><input type="radio" name="passed" value={v} required/>{l}</label>)}</div>
  </fieldset>
  {state.error&&<p className="practice-error" role="alert">{state.error}</p>}
  <button className="practice-button" disabled={pending}>{pending?'Saving…':'Send'}</button>
 </form>;
}

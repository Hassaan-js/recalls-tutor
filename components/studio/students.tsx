'use client';
import {useActionState,useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {grantStudentAccess,reinstateStudent,revokeStudentAccess,sendStudentReset,suspendStudent,type AdminResult} from '@/app/studio/admin-actions';
function Result({state}:{state:AdminResult}) {
 return state.error?<p className="studio-feedback studio-error" role="alert">{state.error}</p>:state.success?<p className="studio-feedback" role="status">{state.success}</p>:null;
}
// ADM-3: extra days start from the end of the student's current access, never overlapping it.
export function GrantForm({userId,exams}:{userId:string;exams:{id:string;name:string}[]}) {
 const[state,action,pending]=useActionState(grantStudentAccess,{});
 return <form action={action} className="students-form"><input type="hidden" name="userId" value={userId}/>
  <div className="catalogue-inline students-inline">
   <label className="studio-field">Exam<select name="examId" required>{exams.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
   <label className="studio-field">Days<input name="days" type="number" min={1} max={366} defaultValue={30} required inputMode="numeric"/></label>
  </div>
  <label className="studio-field">Reason <span className="studio-help">kept in the audit log</span><input name="note" required maxLength={300} placeholder="For example: exam postponed, support goodwill"/></label>
  <Result state={state}/>
  <button className="studio-button" disabled={pending}>{pending?'Granting…':'Grant complimentary access'}</button>
 </form>;
}
export function RevokeButton({entitlementId}:{entitlementId:string}) {
 const router=useRouter();const[busy,start]=useTransition();const[open,setOpen]=useState(false);const[note,setNote]=useState('');const[state,setState]=useState<AdminResult>({});
 if(!open)return <button type="button" className="studio-link-button studio-danger-link" onClick={()=>setOpen(true)}>Revoke</button>;
 return <span className="students-revoke"><input aria-label="Reason for revoking" value={note} onChange={e=>setNote(e.target.value)} maxLength={300} placeholder="Reason"/>
  <button type="button" className="studio-button studio-button-secondary studio-button-small" disabled={busy||!note.trim()} onClick={()=>start(async()=>{const r=await revokeStudentAccess(entitlementId,note);setState(r);if(!r.error){setOpen(false);router.refresh();}})}>Revoke</button>
  <button type="button" className="studio-link-button" onClick={()=>setOpen(false)}>Cancel</button><Result state={state}/></span>;
}
export function AccountActions({userId,suspended,verified}:{userId:string;suspended:boolean;verified:boolean}) {
 const router=useRouter();const[busy,start]=useTransition();const[message,setMessage]=useState<AdminResult>({});const[suspending,setSuspending]=useState(false);
 const[state,action,pending]=useActionState(async(prev:AdminResult,form:FormData)=>{const r=await suspendStudent(prev,form);if(!r.error){setSuspending(false);router.refresh();}return r;},{});
 return <div className="students-actions">
  <div className="students-buttons">
   <button type="button" className="studio-button studio-button-secondary" disabled={busy||!verified||suspended} onClick={()=>start(async()=>setMessage(await sendStudentReset(userId)))}>Send password reset</button>
   {suspended?<button type="button" className="studio-button studio-button-secondary" disabled={busy} onClick={()=>start(async()=>{const r=await reinstateStudent(userId);setMessage(r);if(!r.error)router.refresh();})}>Reinstate account</button>
    :!suspending&&<button type="button" className="studio-button studio-button-secondary studio-danger-link" onClick={()=>setSuspending(true)}>Suspend account</button>}
  </div>
  {!verified&&!suspended&&<p className="studio-help">A reset link can be sent once the student has verified their email.</p>}
  {suspending&&<form action={action} className="students-form students-suspend"><input type="hidden" name="userId" value={userId}/>
   <label className="studio-field">Reason for suspending <span className="studio-help">kept in the audit log; the student is signed out everywhere</span><input name="reason" required maxLength={500}/></label>
   <Result state={state}/>
   <span className="students-buttons"><button type="button" className="studio-button studio-button-secondary" onClick={()=>setSuspending(false)}>Cancel</button><button className="studio-button security-danger" disabled={pending}>{pending?'Suspending…':'Suspend account'}</button></span></form>}
  <Result state={message}/>
 </div>;
}

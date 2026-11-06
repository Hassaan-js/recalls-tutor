'use client';
import {useActionState,useEffect,useState} from 'react';
import {authClient} from '@/lib/auth/client';
import {removeAccount,updateProfile} from '@/app/account/actions';
import type {Profile} from '@/lib/services/student';
function Status({error,success}:{error?:string;success?:string}) {
 return error?<p className="practice-feedback practice-error" role="alert">{error}</p>:success?<p className="practice-feedback" role="status">{success}</p>:null;
}
// AUTH-2: name, country, exams of interest, exam date and timezone, plus the daily target the home screen tracks.
export function ProfileForm({profile,exams,zones}:{profile:Profile;exams:{id:string;name:string}[];zones:string[]}) {
 const[state,action,pending]=useActionState(updateProfile,{});const[zone,setZone]=useState(profile.timezone);
 // An empty timezone starts on the browser's own, so the student only has to confirm it.
 useEffect(()=>{if(!profile.timezone)setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);},[profile.timezone]);
 return <form action={action} className="account-form">
  <div className="account-row"><label className="practice-field">Full name<input name="name" defaultValue={profile.name} required maxLength={80} autoComplete="name"/></label>
   <label className="practice-field">Country<input name="country" defaultValue={profile.country} maxLength={80} autoComplete="country-name"/></label></div>
  <fieldset className="account-set"><legend>Exams you are preparing for</legend><div className="practice-checks">{exams.map(e=><label key={e.id}><input type="checkbox" name="examIds" value={e.id} defaultChecked={profile.examIds.includes(e.id)}/>{e.name}</label>)}</div></fieldset>
  <div className="account-row"><label className="practice-field">Exam date <small>optional, shows a countdown</small><input type="date" name="examDate" defaultValue={profile.examDate??''}/></label>
   <label className="practice-field">Daily target <small>questions per day, optional</small><input type="number" name="dailyTarget" min={1} max={500} inputMode="numeric" defaultValue={profile.dailyTarget??''}/></label></div>
  <label className="practice-field">Timezone <small>used for your daily target</small><select name="timezone" value={zone} onChange={e=>setZone(e.target.value)}><option value="">Not set (UTC)</option>{zones.map(z=><option key={z} value={z}>{z.replaceAll('_',' ')}</option>)}</select></label>
  <Status {...state}/>
  <button className="practice-button" disabled={pending}>{pending?'Saving…':'Save profile'}</button>
 </form>;
}
// AUTH-3: the new address takes over only after the student opens the link sent to it.
export function EmailForm({email}:{email:string}) {
 const[busy,setBusy]=useState(false);const[result,setResult]=useState<{error?:string;success?:string}>({});
 return <form className="account-form" onSubmit={async event=>{event.preventDefault();const next=String(new FormData(event.currentTarget).get('newEmail')||'').trim();setBusy(true);setResult({});
  try{const r=await authClient.changeEmail({newEmail:next,callbackURL:'/account/profile'});setResult(r.error?{error:r.error.message||'We could not change your email. Please try again.'}:{success:`Check ${next} for a link. Your email changes once you open it.`});}
  catch{setResult({error:'Unable to connect. Please try again.'});}finally{setBusy(false);}}}>
  <p className="account-note">Signed in as <strong>{email}</strong>.</p>
  <label className="practice-field">New email address<input type="email" name="newEmail" required maxLength={254} autoComplete="email"/></label>
  <Status {...result}/>
  <button className="practice-ghost" disabled={busy}>{busy?'Sending…':'Send confirmation link'}</button>
 </form>;
}
export function DeleteAccountForm({email}:{email:string}) {
 const[state,action,pending]=useActionState(removeAccount,{});const[open,setOpen]=useState(false);
 useEffect(()=>{if(state.deleted)window.location.assign('/?account=deleted');},[state]);
 if(!open)return <button type="button" className="practice-ghost account-danger" onClick={()=>setOpen(true)}>Delete my account</button>;
 return <form action={action} className="account-form account-confirm" role="alertdialog" aria-labelledby="delete-title">
  <p id="delete-title"><strong>This cannot be undone.</strong> Your name, email, profile, notes and bookmarks are erased and you are signed out everywhere. Payment records are kept, without your name, for accounting. A plan that still renews must be turned off in My plans first.</p>
  <label className="practice-field">Type {email} to confirm<input name="confirmEmail" type="email" required autoComplete="off"/></label>
  <Status error={state.error}/>
  <span className="account-actions"><button type="button" className="practice-ghost" onClick={()=>setOpen(false)} autoFocus>Keep my account</button><button className="practice-button account-danger-solid" disabled={pending}>{pending?'Deleting…':'Delete my account'}</button></span>
 </form>;
}

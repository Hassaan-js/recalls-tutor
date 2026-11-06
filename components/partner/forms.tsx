'use client';
import {useActionState,useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {assignSeats,claimLink,closeAlert,createLink,disableWebhook,extendSeat,newApiKey,newWebhook,retryWebhook,revokeKey,revokeSeat,rotateKey,rotateWebhook,saveKeyIps,setSharing,turnOffLink,type PartnerResult} from '@/app/partner/actions';
export type ProductOption={value:string;label:string};
function Result({state}:{state:PartnerResult}) {
 return state.error?<p className="studio-feedback studio-error" role="alert">{state.error}</p>:state.success?<p className="studio-feedback" role="status">{state.success}</p>:null;
}
// A secret or link shown once, with a copy button.
function Secret({value,label}:{value?:string;label:string}) {
 const[copied,setCopied]=useState(false);
 if(!value)return null;
 return <div className="partner-secret"><code aria-label={label}>{value}</code><button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(value);setCopied(true);}catch{/* select the text instead */}}}>{copied?'Copied':'Copy'}</button></div>;
}
// PART-3: assign by email (one per line) or a CSV file whose first column is the email.
export function AssignForm({orgId,products,disabled}:{orgId:string;products:ProductOption[];disabled:boolean}) {
 const[state,action,pending]=useActionState(assignSeats,{});
 return <form action={action} className="students-form"><input type="hidden" name="orgId" value={orgId}/>
  <label className="studio-field">Product<select name="product" required disabled={disabled}>{products.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
  <label className="studio-field">Student emails <span className="studio-help">one per line, up to 500</span><textarea name="emails" rows={5} disabled={disabled} placeholder={'aisha@example.com\nrohan@example.com'}/></label>
  <label className="studio-field">Or upload a CSV <span className="studio-help">the first column is the email; a header row is skipped</span><input type="file" name="file" accept=".csv,.txt,text/csv,text/plain" disabled={disabled}/></label>
  <Result state={state}/>
  {state.results&&state.results.some(r=>!r.ok)&&<ul className="partner-results" aria-label="Rows that were skipped">{state.results.filter(r=>!r.ok).map((r,i)=><li key={i}><span>{r.email}</span><span className="bad">{r.message}</span></li>)}</ul>}
  <button className="studio-button" disabled={pending||disabled}>{pending?'Assigning…':'Assign seats'}</button>
 </form>;
}
export function SeatActions({orgId,id,status,products}:{orgId:string;id:string;status:string;products:number[]}) {
 const router=useRouter();const[busy,start]=useTransition();const[state,setState]=useState<PartnerResult>({});const[confirm,setConfirm]=useState(false);const[months,setMonths]=useState(products[0]??6);
 const run=(fn:()=>Promise<PartnerResult>)=>start(async()=>{const r=await fn();setState(r);setConfirm(false);if(!r.error)router.refresh();});
 return <div className="partner-row-actions">
  {(status==='active'||status==='expired')&&products.length>0&&<><label className="studio-sr-only" htmlFor={`extend-${id}`}>Extend by</label><select id={`extend-${id}`} value={months} onChange={e=>setMonths(Number(e.target.value))}>{products.map(m=><option key={m} value={m}>+{m} months</option>)}</select>
   <button type="button" className="studio-link-button" disabled={busy} onClick={()=>run(()=>extendSeat(orgId,id,months))}>Extend</button></>}
  {status!=='revoked'&&(confirm?<><button type="button" className="studio-link-button studio-danger-link" disabled={busy} onClick={()=>run(()=>revokeSeat(orgId,id))}>{status==='invited'?'Yes, return the seat':'Yes, revoke access'}</button><button type="button" className="studio-link-button" onClick={()=>setConfirm(false)}>Cancel</button></>
   :<button type="button" className="studio-link-button studio-danger-link" onClick={()=>setConfirm(true)}>Revoke</button>)}
  {state.error&&<Result state={state}/>}
 </div>;
}
export function LinkForm({orgId,products,disabled}:{orgId:string;products:ProductOption[];disabled:boolean}) {
 const[state,action,pending]=useActionState(createLink,{});
 return <form action={action} className="students-form"><input type="hidden" name="orgId" value={orgId}/>
  <label className="studio-field">Name <span className="studio-help">for your records, for example the cohort</span><input name="label" maxLength={120} placeholder="September cohort" disabled={disabled}/></label>
  <label className="studio-field">Product<select name="product" required disabled={disabled}>{products.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
  <div className="catalogue-inline students-inline">
   <label className="studio-field">Seat cap<input name="cap" type="number" min={1} max={1000} defaultValue={25} required inputMode="numeric" disabled={disabled}/></label>
   <label className="studio-field">Works for (days)<input name="days" type="number" min={1} max={365} defaultValue={30} required inputMode="numeric" disabled={disabled}/></label>
  </div>
  <Result state={state}/><Secret value={state.url} label="Invite link"/>
  <button className="studio-button" disabled={pending||disabled}>{pending?'Creating…':'Create invite link'}</button>
 </form>;
}
function ActionButton({label,run,danger,confirmLabel}:{label:string;run:()=>Promise<PartnerResult>;danger?:boolean;confirmLabel?:string}) {
 const router=useRouter();const[busy,start]=useTransition();const[state,setState]=useState<PartnerResult>({});const[confirm,setConfirm]=useState(false);
 const go=()=>start(async()=>{const r=await run();setState(r);setConfirm(false);if(!r.error&&!r.secret)router.refresh();});
 return <span className="partner-row-actions">
  {confirmLabel&&confirm?<><button type="button" className="studio-link-button studio-danger-link" disabled={busy} onClick={go}>{confirmLabel}</button><button type="button" className="studio-link-button" onClick={()=>setConfirm(false)}>Cancel</button></>
   :<button type="button" className={`studio-link-button${danger?' studio-danger-link':''}`} disabled={busy} onClick={()=>confirmLabel?setConfirm(true):go()}>{busy?'Working…':label}</button>}
  <Result state={state}/><Secret value={state.secret} label="New secret"/>
 </span>;
}
export const TurnOffLink=({orgId,id}:{orgId:string;id:string})=><ActionButton label="Turn off" danger confirmLabel="Yes, turn it off" run={()=>turnOffLink(orgId,id)}/>;
export const RotateKey=({orgId,id}:{orgId:string;id:string})=><ActionButton label="Rotate" confirmLabel="Yes, make a new key" run={()=>rotateKey(orgId,id)}/>;
export const RevokeKey=({orgId,id}:{orgId:string;id:string})=><ActionButton label="Revoke" danger confirmLabel="Yes, revoke now" run={()=>revokeKey(orgId,id)}/>;
export const RotateWebhook=({orgId,id}:{orgId:string;id:string})=><ActionButton label="New signing secret" confirmLabel="Yes, replace the secret" run={()=>rotateWebhook(orgId,id)}/>;
export const DisableWebhook=({orgId,id}:{orgId:string;id:string})=><ActionButton label="Turn off" danger confirmLabel="Yes, turn it off" run={()=>disableWebhook(orgId,id)}/>;
export const RetryWebhook=({orgId,id}:{orgId:string;id:string})=><ActionButton label="Send again" run={()=>retryWebhook(orgId,id)}/>;
export const DismissAlert=({orgId,id}:{orgId:string;id:string})=><ActionButton label="Dismiss" run={()=>closeAlert(orgId,id)}/>;
export function KeyForm({orgId,liveAllowed,mfa}:{orgId:string;liveAllowed:boolean;mfa:boolean}) {
 const[state,action,pending]=useActionState(newApiKey,{});
 return <form action={action} className="students-form"><input type="hidden" name="orgId" value={orgId}/>
  <div className="catalogue-inline students-inline">
   <label className="studio-field">Kind<select name="mode" defaultValue={liveAllowed?'live':'test'} disabled={!mfa}><option value="test">Sandbox (test seats)</option><option value="live" disabled={!liveAllowed}>Live{liveAllowed?'':' (after approval)'}</option></select></label>
   <label className="studio-field">Name<input name="label" maxLength={80} placeholder="Course checkout" disabled={!mfa}/></label>
  </div>
  <label className="studio-field">IP allow-list <span className="studio-help">optional: addresses or IPv4 ranges, separated by commas</span><input name="ipAllow" placeholder="203.0.113.10, 198.51.100.0/24" disabled={!mfa}/></label>
  <Result state={state}/><Secret value={state.secret} label="New API key"/>
  <button className="studio-button" disabled={pending||!mfa}>{pending?'Creating…':'Create key'}</button>
 </form>;
}
export function KeyIpForm({orgId,keyId,current}:{orgId:string;keyId:string;current:string[]}) {
 const[state,action,pending]=useActionState(saveKeyIps,{});const[open,setOpen]=useState(false);
 if(!open)return <button type="button" className="studio-link-button" onClick={()=>setOpen(true)}>{current.length?`${current.length} allowed ${current.length===1?'address':'addresses'}`:'Any IP address'} · Edit</button>;
 return <form action={action} className="partner-row-actions"><input type="hidden" name="orgId" value={orgId}/><input type="hidden" name="keyId" value={keyId}/>
  <label className="studio-sr-only" htmlFor={`ips-${keyId}`}>IP allow-list</label><input id={`ips-${keyId}`} name="ipAllow" defaultValue={current.join(', ')} placeholder="Empty means any address"/>
  <button className="studio-link-button" disabled={pending}>Save</button><button type="button" className="studio-link-button" onClick={()=>setOpen(false)}>Close</button><Result state={state}/></form>;
}
const EVENTS:[string,string][]=[['enrollment.activated','A student activates a seat'],['enrollment.expiring','Access ends in 7 days'],['enrollment.expired','Access has ended'],['seats.low_balance','Seats are running low']];
export function WebhookForm({orgId,mfa}:{orgId:string;mfa:boolean}) {
 const[state,action,pending]=useActionState(newWebhook,{});
 return <form action={action} className="students-form"><input type="hidden" name="orgId" value={orgId}/>
  <div className="catalogue-inline students-inline">
   <label className="studio-field">Events from<select name="mode" disabled={!mfa}><option value="live">Live keys</option><option value="test">Sandbox keys</option></select></label>
   <label className="studio-field">Endpoint URL<input name="url" type="url" required placeholder="https://your-site.com/hooks/recalls" disabled={!mfa}/></label>
  </div>
  <fieldset className="partner-checks"><legend>Send these events</legend>{EVENTS.map(([v,l])=><label key={v}><input type="checkbox" name="events" value={v} defaultChecked disabled={!mfa}/>{l}</label>)}</fieldset>
  <Result state={state}/><Secret value={state.secret} label="Signing secret"/>
  <button className="studio-button" disabled={pending||!mfa}>{pending?'Adding…':'Add endpoint'}</button>
 </form>;
}
export function ClaimButton({token}:{token:string}) {
 const router=useRouter();const[busy,start]=useTransition();const[state,setState]=useState<PartnerResult>({});
 if(state.success)return <><Result state={state}/><a className="studio-button" href="/practice">Start practising</a></>;
 return <><Result state={state}/><button type="button" className="studio-button" disabled={busy} onClick={()=>start(async()=>{const r=await claimLink(token);setState(r);if(!r.error)router.refresh();})}>{busy?'Claiming…':'Claim my seat'}</button></>;
}
// Student profile: share progress with a partner (PART-3 consent), off by default.
export function SharingToggle({orgId,name,sharing}:{orgId:string;name:string;sharing:boolean}) {
 const router=useRouter();const[busy,start]=useTransition();const[state,setState]=useState<PartnerResult>({});
 return <span className="way-actions"><label className="partner-share"><input type="checkbox" checked={sharing} disabled={busy} onChange={e=>{const on=e.target.checked;start(async()=>{const r=await setSharing(orgId,on);setState(r);if(!r.error)router.refresh();});}}/> Share my progress with {name}</label>
  {state.error&&<span className="practice-error" role="alert">{state.error}</span>}</span>;
}

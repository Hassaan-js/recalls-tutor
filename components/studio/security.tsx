'use client';
import {useActionState,useEffect} from 'react';
import {useRouter} from 'next/navigation';
import {reinstate,resolveAlert,saveProtection,suspend} from '@/app/studio/security/actions';
import type {ProtectionSettings,SecurityAlert,TracedAccount} from '@/lib/services/protection';
function Result({state}:{state:{error?:string;success?:string}}){return <>{state.error&&<p className="studio-feedback studio-error" role="alert">{state.error}</p>}{state.success&&<p className="studio-feedback" role="status">{state.success}</p>}</>;}
function useRefresh(state:{success?:string}){const router=useRouter();useEffect(()=>{if(state.success)router.refresh();},[state,router]);}
const when=(value:string)=>new Date(value).toLocaleString('en-GB',{timeZone:'UTC',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+' UTC';
export function ProtectionForm({settings}:{settings:ProtectionSettings}){
 const[state,action,pending]=useActionState(saveProtection,{});useRefresh(state);
 return <form action={action}><div className="catalogue-grid">
  <label className="studio-field">New questions per hour<input name="hourlyQuestionBudget" type="number" min={10} max={5000} defaultValue={settings.hourlyQuestionBudget} required/><span className="studio-help">Students who reach this are paused until the hour rolls over. Re-opening a question already seen is free.</span></label>
  <label className="studio-field">Alert above (questions)<input name="burstQuestions" type="number" min={5} max={1000} defaultValue={settings.burstQuestions} required/></label>
  <label className="studio-field">…within (minutes)<input name="burstMinutes" type="number" min={1} max={60} defaultValue={settings.burstMinutes} required/><span className="studio-help">Far faster than anyone can read; raises a scraping alert without blocking.</span></label>
 </div><Result state={state}/><button className="studio-button" disabled={pending}>{pending?'Saving…':'Save limits'}</button></form>;
}
function SuspendForm({userId,label}:{userId:string;label:string}){
 const[state,action,pending]=useActionState(suspend,{});useRefresh(state);
 return <form action={action} className="security-inline"><input type="hidden" name="userId" value={userId}/><label className="studio-field">Reason for suspending {label}<input name="reason" required maxLength={500} placeholder="e.g. Watermark found on a shared screenshot"/></label><button className="studio-button security-danger" disabled={pending}>{pending?'Suspending…':'Suspend account'}</button><Result state={state}/></form>;
}
function ReinstateForm({userId}:{userId:string}){
 const[state,action,pending]=useActionState(reinstate,{});useRefresh(state);
 return <form action={action}><input type="hidden" name="userId" value={userId}/><button className="studio-button studio-button-secondary" disabled={pending}>{pending?'Reinstating…':'Reinstate account'}</button><Result state={state}/></form>;
}
function ResolveForm({alertId}:{alertId:string}){
 const[state,action,pending]=useActionState(resolveAlert,{});useRefresh(state);
 return <form action={action} className="security-inline"><input type="hidden" name="alertId" value={alertId}/><label className="studio-field">Decision<input name="resolution" required maxLength={500} placeholder="e.g. Normal revision before the exam"/></label><button className="studio-button studio-button-secondary" disabled={pending}>{pending?'Saving…':'Resolve'}</button><Result state={state}/></form>;
}
export function AlertList({alerts}:{alerts:SecurityAlert[]}){
 if(!alerts.length)return <p className="studio-help">No open alerts.</p>;
 return <ul className="security-list">{alerts.map(a=><li key={a.id}><div className="security-row"><strong>{a.kind==='hourly_limit'?'Hit the hourly limit':'Unusually fast reading'}</strong><span>{when(a.createdAt)}</span></div>
  <p>{a.name} · {a.email} · ID {a.userId.slice(0,8)}{a.status==='suspended'?' · suspended':''}</p>
  <p className="studio-help">{a.kind==='hourly_limit'?`${a.details.questionsLastHour} new questions in the last hour (limit ${a.details.limit}).`:`${a.details.questions} new questions in ${a.details.minutes} minutes (alert above ${a.details.threshold}).`}</p>
  <ResolveForm alertId={a.id}/>{a.status!=='suspended'&&<SuspendForm userId={a.userId} label="this account"/>}</li>)}</ul>;
}
export function TraceResults({accounts,query}:{accounts:TracedAccount[];query:string}){
 if(!query)return null;
 if(!accounts.length)return <p className="studio-help">No account matches “{query}”.</p>;
 return <ul className="security-list">{accounts.map(a=><li key={a.id}><div className="security-row"><strong>{a.name} · {a.email}</strong><span>{a.role.replaceAll('_',' ')} · {a.status}</span></div>
  <p className="studio-help">Account ID {a.id} · joined {when(a.createdAt)}</p>
  <p>{a.viewsLast24h} question views in 24 hours · {a.viewsLast7d} in 7 days · {a.attempts} sessions · {a.openAlerts} open alert{a.openAlerts===1?'':'s'}{a.lastViewAt?` · last view ${when(a.lastViewAt)}`:''}</p>
  {a.status==='suspended'?<><p className="studio-help">Suspended: {a.suspendedReason}</p><ReinstateForm userId={a.id}/></>:a.role!=='super_admin'&&<SuspendForm userId={a.id} label={a.email}/>}</li>)}</ul>;
}

'use client';
import {useActionState,useEffect,useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {reconcile,refund,resolveAlert,retryEvent,savePrice,syncPrices} from '@/app/studio/billing/actions';
type Result={error?:string;success?:string};
function Notice({state}:{state:Result}){return <>{state.error&&<p className="studio-feedback studio-error" role="alert">{state.error}</p>}{state.success&&<p className="studio-feedback" role="status">{state.success}</p>}</>;}
function useRefresh(state:Result){const router=useRouter();useEffect(()=>{if(state.success)router.refresh();},[state,router]);}
const usd=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const when=(v:string)=>new Date(v).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
type Plan={id:string;examId:string;months:number;priceCents:number;active:boolean;stripePriceId:string|null;createdAt:string;subscribers:number};
function PriceRow({examId,months,current}:{examId:string;months:number;current:Plan|undefined}){
 const[state,action,pending]=useActionState(savePrice,{});useRefresh(state);
 return <form action={action} className="billing-price"><input type="hidden" name="examId" value={examId}/><input type="hidden" name="months" value={months}/>
  <label className="studio-field">{months===1?'1 month · optional':`${months} months`}{months===6?' · highlighted as best value':''}<span className="billing-money">$<input name="price" inputMode="decimal" defaultValue={current?(current.priceCents/100).toFixed(2):''} placeholder="Not on sale"/></span>
   <span className="studio-help">{current?`${usd(Math.round(current.priceCents/months))}/month · ${current.stripePriceId?'in Stripe':'not in Stripe yet'} · ${current.subscribers} active subscriber${current.subscribers===1?'':'s'}`:'Leave blank to keep this duration off sale.'}</span></label>
  <button className="studio-button studio-button-secondary" disabled={pending}>{pending?'Saving…':'Save'}</button><Notice state={state}/></form>;
}
export function PlansEditor({exams,plans}:{exams:{id:string;name:string}[];plans:Plan[]}){
 return <>{exams.map(e=><div key={e.id} className="billing-exam"><h3>{e.name}</h3>{[1,3,6,12].map(m=><PriceRow key={m} examId={e.id} months={m} current={plans.find(p=>p.examId===e.id&&p.months===m&&p.active)}/>)}
  {plans.some(p=>p.examId===e.id&&!p.active)&&<details className="studio-history"><summary>Earlier prices</summary><ol>{plans.filter(p=>p.examId===e.id&&!p.active).map(p=><li key={p.id}><strong>{p.months} months · {usd(p.priceCents)}</strong><time>set {when(p.createdAt)} · {p.subscribers} still subscribed</time></li>)}</ol></details>}</div>)}
  <p className="studio-help">Changing a price creates a new Stripe Price. Existing subscribers keep the price they signed up on.</p></>;
}
export function BillingActions({configured}:{configured:boolean}){
 const router=useRouter();const[busy,start]=useTransition();const[state,setState]=useState<Result>({});
 const run=(fn:()=>Promise<Result>)=>start(async()=>{const r=await fn();setState(r);if(!r.error)router.refresh();});
 return <div className="paper-actions"><button type="button" className="studio-button studio-button-secondary" disabled={busy||!configured} onClick={()=>run(syncPrices)}>Sync prices to Stripe</button><button type="button" className="studio-button studio-button-secondary" disabled={busy||!configured} onClick={()=>run(reconcile)}>Reconcile with Stripe now</button><Notice state={state}/></div>;
}
function RefundForm({subscriptionId}:{subscriptionId:string}){
 const[state,action,pending]=useActionState(refund,{});useRefresh(state);const[open,setOpen]=useState(false);
 if(!open)return <button type="button" className="studio-link-button" onClick={()=>setOpen(true)}>Refund…</button>;
 return <form action={action} className="security-inline" onSubmit={e=>{if(!confirm('Refund the latest payment in full? Access ends and the plan is cancelled.'))e.preventDefault();}}><input type="hidden" name="subscriptionId" value={subscriptionId}/><label className="studio-field">Reason<input name="reason" required maxLength={450} placeholder="e.g. Within 48 hours, under 50 questions"/></label><button className="studio-button security-danger" disabled={pending}>{pending?'Refunding…':'Refund in full'}</button><Notice state={state}/></form>;
}
export function SubscriptionTable({rows,canRefund}:{rows:{id:string;email:string;examName:string;months:number;status:string;periodEnd:string|null;autoRenew:boolean;hold:string|null;accessUntil:string|null}[];canRefund:boolean}){
 if(!rows.length)return <p className="studio-help">No subscriptions found.</p>;
 return <ul className="security-list">{rows.map(r=><li key={r.id}><div className="security-row"><strong>{r.email}</strong><span>{r.examName} · {r.months} months</span></div>
  <p>{r.hold?`On hold: ${r.hold}`:r.status.replace('_',' ')}{r.periodEnd?` · period ends ${when(r.periodEnd)}`:''} · auto-renew {r.autoRenew?'on':'off'} · {r.accessUntil?`access until ${when(r.accessUntil)}`:'no access'}</p>
  {canRefund&&!r.hold&&<RefundForm subscriptionId={r.id}/>}</li>)}</ul>;
}
function ResolveForm({id,dispute}:{id:string;dispute:boolean}){
 const[state,action,pending]=useActionState(resolveAlert,{});useRefresh(state);
 return <form action={action} className="security-inline"><input type="hidden" name="alertId" value={id}/><label className="studio-field">Decision<input name="resolution" required maxLength={500}/></label>
  {dispute&&<label className="studio-check"><input type="checkbox" name="restore" value="true"/>Dispute won: restore access</label>}<button className="studio-button studio-button-secondary" disabled={pending}>{pending?'Saving…':'Resolve'}</button><Notice state={state}/></form>;
}
export function BillingAlerts({alerts}:{alerts:{id:string;kind:string;details:Record<string,unknown>;createdAt:string;email:string|null}[]}){
 if(!alerts.length)return <p className="studio-help">No open billing alerts.</p>;
 const label={dispute:'Payment dispute: access suspended',reconciliation:'Reconciliation difference',webhook_failure:'Stripe event keeps failing'} as Record<string,string>;
 return <ul className="security-list">{alerts.map(a=><li key={a.id}><div className="security-row"><strong>{label[a.kind]??a.kind}</strong><span>{when(a.createdAt)}</span></div><p className="studio-help">{a.email?`${a.email} · `:''}{Object.entries(a.details).map(([k,v])=>`${k}: ${String(v)}`).join(' · ')}</p><ResolveForm id={a.id} dispute={a.kind==='dispute'}/></li>)}</ul>;
}
export function FailedEvents({events}:{events:{id:string;type:string;error:string|null;attempts:number;receivedAt:string}[]}){
 const router=useRouter();const[busy,start]=useTransition();const[state,setState]=useState<Result>({});
 if(!events.length)return <p className="studio-help">All Stripe events have been processed.</p>;
 return <><ul className="security-list">{events.map(e=><li key={e.id}><div className="security-row"><strong>{e.type}</strong><span>{e.attempts} attempt{e.attempts===1?'':'s'}</span></div><p className="studio-help">{e.id} · {e.error??'Not processed yet'}</p>
  <button type="button" className="studio-link-button" disabled={busy} onClick={()=>start(async()=>{const r=await retryEvent(e.id);setState(r);if(!r.error)router.refresh();})}>Retry now</button></li>)}</ul><Notice state={state}/></>;
}

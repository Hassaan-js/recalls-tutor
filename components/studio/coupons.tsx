'use client';
import {useActionState,useEffect,useRef,useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {newCoupon,saveOffers,syncCoupons,turnOffCoupon} from '@/app/studio/billing/actions';
type Result={error?:string;success?:string};
function Notice({state}:{state:Result}){return <>{state.error&&<p className="studio-feedback studio-error" role="alert">{state.error}</p>}{state.success&&<p className="studio-feedback" role="status">{state.success}</p>}</>;}
// BILL-6: a coupon is one code with one discount; the form shows what students will see before it is saved.
export function CouponForm({exams}:{exams:{id:string;name:string}[]}) {
 const[state,action,pending]=useActionState(newCoupon,{});const router=useRouter();const form=useRef<HTMLFormElement>(null);
 const[kind,setKind]=useState<'percent'|'amount'>('percent');const[duration,setDuration]=useState('once');
 useEffect(()=>{if(state.success){form.current?.reset();setKind('percent');setDuration('once');router.refresh();}},[state,router]);
 return <form ref={form} action={action} className="students-form">
  <div className="catalogue-inline students-inline">
   <label className="studio-field">Code <span className="studio-help">what students type, e.g. SPRING25</span><input name="code" required maxLength={40} pattern="[A-Za-z0-9\-]{3,40}" autoCapitalize="characters" spellCheck={false} className="coupon-code-input"/></label>
   <label className="studio-field">Name <span className="studio-help">for your records</span><input name="name" required maxLength={80} placeholder="Spring 2027 campaign"/></label>
  </div>
  <div className="catalogue-inline students-inline">
   <label className="studio-field">Discount<select name="kind" value={kind} onChange={e=>setKind(e.target.value as 'percent'|'amount')}><option value="percent">Percentage off</option><option value="amount">Fixed amount off (USD)</option></select></label>
   <label className="studio-field">{kind==='percent'?'Percent off':'Amount off ($)'}<input name="value" required inputMode="decimal" placeholder={kind==='percent'?'20':'15'}/></label>
  </div>
  <div className="catalogue-inline students-inline">
   <label className="studio-field">Applies to<select name="duration" value={duration} onChange={e=>setDuration(e.target.value)}><option value="once">The first payment only</option><option value="repeating">Every payment for some months</option><option value="forever">Every payment, including renewals</option></select></label>
   {duration==='repeating'&&<label className="studio-field">Months<input name="durationMonths" type="number" min={1} max={36} required inputMode="numeric"/></label>}
  </div>
  <fieldset className="partner-checks"><legend>Exams <span className="studio-help">none ticked means every exam</span></legend>{exams.map(e=><label key={e.id}><input type="checkbox" name="examIds" value={e.id}/>{e.name}</label>)}</fieldset>
  <div className="catalogue-inline students-inline">
   <label className="studio-field">Use limit <span className="studio-help">optional, total across all students</span><input name="maxRedemptions" type="number" min={1} max={100000} inputMode="numeric" placeholder="No limit"/></label>
   <label className="studio-field">Last day it works <span className="studio-help">optional, UTC</span><input name="expiresAt" type="date"/></label>
  </div>
  <label className="studio-check"><input type="checkbox" name="firstTimeOnly" value="true"/>First purchase only (not for students who have paid before)</label>
  <Notice state={state}/>
  <button className="studio-button" disabled={pending}>{pending?'Saving…':'Create coupon'}</button>
 </form>;
}
export function SyncCoupons({disabled}:{disabled:boolean}) {
 const router=useRouter();const[busy,start]=useTransition();const[state,setState]=useState<Result>({});
 return <div className="paper-actions"><button type="button" className="studio-button studio-button-secondary" disabled={busy||disabled} onClick={()=>start(async()=>{const r=await syncCoupons();setState(r);router.refresh();})}>{busy?'Sending…':'Send to Stripe'}</button><Notice state={state}/></div>;
}
export function TurnOffCoupon({id,code}:{id:string;code:string}) {
 const router=useRouter();const[busy,start]=useTransition();const[state,setState]=useState<Result>({});const[confirm,setConfirm]=useState(false);
 return <span className="partner-row-actions">
  {confirm?<><button type="button" className="studio-link-button studio-danger-link" disabled={busy} onClick={()=>start(async()=>{const r=await turnOffCoupon(id);setState(r);setConfirm(false);if(!r.error)router.refresh();})}>Yes, turn off {code}</button><button type="button" className="studio-link-button" onClick={()=>setConfirm(false)}>Cancel</button></>
   :<button type="button" className="studio-link-button studio-danger-link" onClick={()=>setConfirm(true)}>Turn off</button>}
  {state.error&&<Notice state={state}/>}
 </span>;
}
export function OfferSettingsForm({winBackPercent,winBackValidDays,trialOfferPercent,referralPercent}:{winBackPercent:number|null;winBackValidDays:number;trialOfferPercent:number|null;referralPercent:number|null}) {
 const[state,action,pending]=useActionState(saveOffers,{});
 return <form action={action} className="students-form">
  <div className="catalogue-inline students-inline">
   <label className="studio-field">Win-back discount (%) <span className="studio-help">sent 14 days after a plan ends; the PRD sets 20</span><input name="winBackPercent" type="number" min={1} max={90} inputMode="numeric" defaultValue={winBackPercent??''} placeholder="Off"/></label>
   <label className="studio-field">Win-back code lasts (days)<input name="winBackValidDays" type="number" min={1} max={60} required inputMode="numeric" defaultValue={winBackValidDays}/></label>
  </div>
  <label className="studio-field">Trial offer discount (%) <span className="studio-help">sent in the last 48 hours of a trial, valid until 48 hours after it ends; blank sends no offer</span><input name="trialOfferPercent" type="number" min={1} max={90} inputMode="numeric" defaultValue={trialOfferPercent??''} placeholder="Not set"/></label>
  <label className="studio-field">Referral reward (%) <span className="studio-help">a single-use code for the student whose friend makes a first payment; blank sends none</span><input name="referralPercent" type="number" min={1} max={90} inputMode="numeric" defaultValue={referralPercent??''} placeholder="Not set"/></label>
  <Notice state={state}/>
  <button className="studio-button studio-button-secondary" disabled={pending}>{pending?'Saving…':'Save offers'}</button>
 </form>;
}

'use client';
import {useActionState,useEffect,useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {addMember,changePartnerStatus,newPartner,newSeatPack,removeMember,savePartner,saveProducts,suspendKey,type PartnerAdminResult,saveBranding} from '@/app/studio/partner-actions';
function Result({state}:{state:PartnerAdminResult}) {
 return state.error?<p className="studio-feedback studio-error" role="alert">{state.error}</p>:state.success?<p className="studio-feedback" role="status">{state.success}</p>:null;
}
function BillingFields({billing:initial,credit,low}:{billing?:string;credit?:number|null;low?:number}) {
 const[billing,setBilling]=useState(initial??'prepaid');
 return <div className="catalogue-inline students-inline">
  <label className="studio-field">Billing<select name="billing" value={billing} onChange={e=>setBilling(e.target.value)}><option value="prepaid">Prepaid seat packs</option><option value="postpaid">Postpaid, invoiced monthly</option></select></label>
  {billing==='postpaid'?<label className="studio-field">Monthly seat limit <span className="studio-help">empty for none</span><input name="creditLimit" type="number" min={1} max={100000} inputMode="numeric" defaultValue={credit??''}/></label>:<input type="hidden" name="creditLimit" value=""/>}
  {low!==undefined&&<label className="studio-field">Low-balance alert at<input name="lowBalanceAt" type="number" min={0} max={10000} inputMode="numeric" defaultValue={low}/></label>}
 </div>;
}
export function NewPartnerForm() {
 const router=useRouter();const[state,action,pending]=useActionState(newPartner,{});
 useEffect(()=>{if(state.id)router.push(`/studio/partners/${state.id}`);},[state.id,router]);
 return <form action={action} className="students-form">
  <label className="studio-field">Organisation name<input name="name" required minLength={2} maxLength={120} placeholder="For example, a course provider or hospital"/></label>
  <label className="studio-field">Contact email <span className="studio-help">receives seat alerts</span><input name="contactEmail" type="email" maxLength={254}/></label>
  <BillingFields/>
  <label className="studio-field">Notes <span className="studio-help">internal</span><textarea name="notes" rows={2} maxLength={1000}/></label>
  <Result state={state}/><button className="studio-button" disabled={pending}>{pending?'Creating…':'Create partner'}</button>
 </form>;
}
export function EditPartnerForm({org}:{org:{id:string;name:string;contact_email:string|null;billing:string;credit_limit_seats:number|null;low_balance_at:number;notes:string}}) {
 const[state,action,pending]=useActionState(savePartner,{});
 return <form action={action} className="students-form"><input type="hidden" name="orgId" value={org.id}/>
  <label className="studio-field">Organisation name<input name="name" required minLength={2} maxLength={120} defaultValue={org.name}/></label>
  <label className="studio-field">Contact email<input name="contactEmail" type="email" maxLength={254} defaultValue={org.contact_email??''}/></label>
  <BillingFields billing={org.billing} credit={org.credit_limit_seats} low={org.low_balance_at}/>
  <label className="studio-field">Notes<textarea name="notes" rows={2} maxLength={1000} defaultValue={org.notes}/></label>
  <Result state={state}/><button className="studio-button studio-button-secondary" disabled={pending}>{pending?'Saving…':'Save details'}</button>
 </form>;
}
export function StatusForm({orgId,status}:{orgId:string;status:string}) {
 const router=useRouter();
 const[state,action,pending]=useActionState(async(p:PartnerAdminResult,f:FormData)=>{const r=await changePartnerStatus(p,f);if(!r.error)router.refresh();return r;},{});
 const[suspending,setSuspending]=useState(false);
 return <form action={action} className="students-form"><input type="hidden" name="orgId" value={orgId}/>
  {status==='pending'&&<button className="studio-button" name="action" value="approve" disabled={pending}>Approve partner</button>}
  {status==='suspended'&&<button className="studio-button" name="action" value="reinstate" disabled={pending}>Reinstate partner</button>}
  {status!=='suspended'&&(suspending?<><label className="studio-field">Reason <span className="studio-help">kept in the audit log</span><input name="note" required maxLength={300}/></label>
   <span className="partner-row-actions"><button className="studio-button security-danger" name="action" value="suspend" disabled={pending}>Suspend now</button><button type="button" className="studio-link-button" onClick={()=>setSuspending(false)}>Cancel</button></span></>
   :<button type="button" className="studio-link-button studio-danger-link" onClick={()=>setSuspending(true)}>Suspend partner</button>)}
  <Result state={state}/>
 </form>;
}
export function ProductsForm({orgId,exams,products}:{orgId:string;exams:{id:string;name:string;live:boolean}[];products:{examId:string;months:number;priceCents:number|null}[]}) {
 const[state,action,pending]=useActionState(saveProducts,{});
 const has=(e:string,m:number)=>products.find(p=>p.examId===e&&p.months===m);
 return <form action={action}><input type="hidden" name="orgId" value={orgId}/>
  <div className="partner-scroll"><table className="catalogue-table"><thead><tr><th scope="col">Exam</th>{[3,6,12].map(m=><th key={m} scope="col">{m} months · seat price (USD)</th>)}</tr></thead><tbody>
   {exams.map(e=><tr key={e.id}><th scope="row">{e.name}{!e.live&&<span className="studio-help team-email">not live yet</span>}</th>
    {[3,6,12].map(m=>{const p=has(e.id,m),v=`${e.id}:${m}`;return <td key={m}><span className="partner-row-actions"><label><input type="checkbox" name="product" value={v} defaultChecked={!!p}/> <span className="studio-sr-only">Allow {e.name} {m} months</span></label>
     <input name={`price:${v}`} inputMode="decimal" aria-label={`Seat price for ${e.name}, ${m} months`} defaultValue={p?.priceCents!=null?(p.priceCents/100).toFixed(2):''} placeholder="—" size={7}/></span></td>;})}</tr>)}</tbody></table></div>
  <p className="studio-help">Tick what the partner may assign. Seat prices are the agreed price per seat; they are used for monthly statements and partner revenue. Leave a price empty until it is agreed.</p>
  <Result state={state}/><button className="studio-button studio-button-secondary" disabled={pending}>{pending?'Saving…':'Save products'}</button>
 </form>;
}
export function SeatPackForm({orgId,products}:{orgId:string;products:{value:string;label:string}[]}) {
 const[state,action,pending]=useActionState(newSeatPack,{});
 const inYear=new Date(Date.now()+365*86400000).toISOString().slice(0,10);
 return <form action={action} className="students-form"><input type="hidden" name="orgId" value={orgId}/>
  <label className="studio-field">Product<select name="product" required>{products.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
  <div className="catalogue-inline students-inline">
   <label className="studio-field">Seats<input name="seats" type="number" min={1} max={100000} required inputMode="numeric"/></label>
   <label className="studio-field">Amount paid (USD)<input name="price" inputMode="decimal" placeholder="Optional"/></label>
   <label className="studio-field">Unused seats expire<input name="expiresOn" type="date" required defaultValue={inYear}/></label>
  </div>
  <label className="studio-field">Reference <span className="studio-help">invoice or Stripe payment id</span><input name="reference" maxLength={200}/></label>
  <Result state={state}/><button className="studio-button studio-button-secondary" disabled={pending||!products.length}>{pending?'Recording…':'Record seat pack'}</button>
 </form>;
}
export function MemberForm({orgId}:{orgId:string}) {
 const[state,action,pending]=useActionState(addMember,{});
 return <form action={action} className="students-form"><input type="hidden" name="orgId" value={orgId}/>
  <span className="catalogue-inline team-inline"><label className="studio-field">Email of an existing account<input name="email" type="email" required maxLength={254} placeholder="They create a Recalls Tutor account first"/></label>
   <button className="studio-button studio-button-secondary" disabled={pending}>Add admin</button></span><Result state={state}/></form>;
}
function Act({label,run,danger}:{label:string;run:()=>Promise<PartnerAdminResult>;danger?:boolean}) {
 const router=useRouter();const[busy,start]=useTransition();const[state,setState]=useState<PartnerAdminResult>({});
 return <span className="partner-row-actions"><button type="button" className={`studio-link-button${danger?' studio-danger-link':''}`} disabled={busy} onClick={()=>start(async()=>{const r=await run();setState(r);if(!r.error)router.refresh();})}>{label}</button>{state.error&&<Result state={state}/>}</span>;
}
export const RemoveMember=({orgId,userId}:{orgId:string;userId:string})=><Act label="Remove" danger run={()=>removeMember(orgId,userId)}/>;
export const KeySuspend=({orgId,keyId,suspended}:{orgId:string;keyId:string;suspended:boolean})=><Act label={suspended?'Restore key':'Suspend key'} danger={!suspended} run={()=>suspendKey(orgId,keyId,!suspended)}/>;
// PART-2 white-label (R3): name, logo and colour shown on this partner's invite pages and portal.
export function BrandingForm({org}:{org:{id:string;brand_name:string|null;brand_logo_url:string|null;brand_color:string|null}}) {
 const[state,action,pending]=useActionState(saveBranding,{});
 return <form action={action} className="students-form"><input type="hidden" name="orgId" value={org.id}/>
  <label className="studio-field">Display name <span className="studio-help">optional, shown instead of the organisation name</span><input name="brandName" maxLength={80} defaultValue={org.brand_name??''}/></label>
  <label className="studio-field">Logo address <span className="studio-help">https link to a PNG, SVG, JPG or WebP</span><input name="logoUrl" type="url" maxLength={500} defaultValue={org.brand_logo_url??''} placeholder="https://"/></label>
  <label className="studio-field">Brand colour <span className="studio-help">dark enough for white text</span><input name="color" maxLength={7} defaultValue={org.brand_color??''} placeholder="#1f4e79" pattern="#[0-9a-fA-F]{6}"/></label>
  <Result state={state}/><button className="studio-button studio-button-secondary" disabled={pending}>{pending?'Saving…':'Save branding'}</button>
 </form>;
}

import {getDatabase} from '@/lib/db/client';
import {partnerBilling} from '@/lib/services/partners';
import {NotPartner,PartnerShell,partnerContext} from '@/components/partner/shell';
import {day,money} from '@/components/partner/format';
export const metadata={title:'Purchases and invoices',robots:{index:false}};
export const dynamic='force-dynamic';
const monthName=(m:string)=>new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
export default async function PartnerBilling(props:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const ctx=await partnerContext('/partner/billing',await props.searchParams);
 if(!ctx)return <NotPartner/>;
 const {packs,usage}=await partnerBilling(getDatabase(),ctx.org.id);
 const months=[...new Set(usage.map(u=>u.month))];
 return <PartnerShell ctx={ctx} current="billing" title="Purchases and invoices" sub="The seat packs you have bought and, for monthly billing, the seats activated each month. Recalls Tutor sends invoices by email.">
  <section className="catalogue-panel" aria-labelledby="packs-title"><h2 id="packs-title">Seat packs</h2>
   {packs.length?<div className="partner-scroll"><table className="catalogue-table"><thead><tr><th scope="col">Bought</th><th scope="col">Product</th><th scope="col">Seats</th><th scope="col">Left</th><th scope="col">Expires</th><th scope="col">Amount</th></tr></thead><tbody>
    {packs.map(p=><tr key={p.id}><td>{day(p.purchased_at)}{p.reference&&<span className="studio-help team-email">{p.reference}</span>}</td><td>{p.exam}, {p.months} months</td><td>{p.seats}</td><td>{p.expired?'Expired':p.remaining}</td><td>{day(p.expires_at)}</td><td>{money(p.price_cents)}</td></tr>)}</tbody></table></div>
    :<p className="studio-empty">No seat packs yet.</p>}</section>
  {(ctx.org.billing==='postpaid'||usage.length>0)&&<section className="catalogue-panel" aria-labelledby="usage-title"><h2 id="usage-title">Monthly statements</h2>
   {months.length?months.map(m=>{const lines=usage.filter(u=>u.month===m),total=lines.reduce((s,l)=>s+(l.price??0)*l.seats,0),unpriced=lines.some(l=>l.price===null);
    return <div key={m}><h3 className="security-sub">{monthName(m)}</h3><div className="partner-scroll"><table className="catalogue-table"><thead><tr><th scope="col">Product</th><th scope="col">Seats activated</th><th scope="col">Seat price</th><th scope="col">Amount</th></tr></thead><tbody>
     {lines.map(l=><tr key={`${l.exam}-${l.months}`}><td>{l.exam}, {l.months} months</td><td>{l.seats}</td><td>{money(l.price)}</td><td>{l.price===null?'To be confirmed':money(l.price*l.seats)}</td></tr>)}
     <tr><th scope="row">Total</th><td/><td/><td><strong>{money(total)}</strong>{unpriced&&<span className="studio-help team-email">plus seats awaiting a price</span>}</td></tr></tbody></table></div></div>;})
    :<p className="studio-empty">No seats activated yet.</p>}</section>}
 </PartnerShell>;
}

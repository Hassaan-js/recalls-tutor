import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {listPartners,partnerRevenue} from '@/lib/services/partner-admin';
import {StudioShell} from '@/components/studio/nav';
import {NewPartnerForm} from '@/components/studio/partners';
import {money} from '@/components/partner/format';
import '../studio.css';
import '@/app/partner/partner.css';
export const metadata={title:'Partners'};
export const dynamic='force-dynamic';
const STATUS:Record<string,string>={pending:'Waiting for approval',active:'Active',suspended:'Suspended'};
// PART-6: partners, their seats and partner revenue, reported apart from direct sales.
export default async function PartnersPage() {
 const actor=await getCurrentActor();const access=staffAccess(actor);
 if(access==='unauthenticated')redirect('/sign-in');if(access==='unverified')redirect('/verify-email');if(access==='mfa_required')redirect('/account/security');
 if(access!=='allowed'||!actor||actor.role!=='super_admin')return <StudioShell current="partners" actor={actor} title="Super Admin access required." sub="Partners and their seats are managed by a Super Admin."/>;
 const db=getDatabase();const [partners,revenue]=await Promise.all([listPartners(db,actor.id),partnerRevenue(db,actor.id)]);
 const pending=partners.filter(p=>p.status==='pending').length;
 const months=[...new Set(revenue.map(r=>r.month))].slice(0,6);
 const monthName=(m:string)=>new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB',{month:'short',year:'numeric',timeZone:'UTC'});
 return <StudioShell current="partners" actor={actor} title="Partners" sub={`${partners.length} ${partners.length===1?'partner':'partners'}${pending?` · ${pending} waiting for approval`:''}. Course providers, academies and hospitals that buy seats for their students.`}>
  <div className="students-columns">
   <section className="catalogue-panel" aria-labelledby="list-title"><h2 id="list-title">All partners</h2>
    {partners.length?<div className="partner-scroll"><table className="catalogue-table"><thead><tr><th scope="col">Partner</th><th scope="col">Status</th><th scope="col">Seats</th><th scope="col">Live keys</th></tr></thead><tbody>
     {partners.map(p=><tr key={p.id}><th scope="row"><Link href={`/studio/partners/${p.id}`}><strong>{p.name}</strong></Link><span className="studio-help team-email">{p.billing==='postpaid'?'Postpaid':'Prepaid'} · {p.members} {p.members===1?'admin':'admins'}</span></th>
      <td><span className={`partner-state partner-state-${p.status==='active'?'active':p.status==='pending'?'invited':'revoked'}`}>{STATUS[p.status]}</span></td>
      <td>{p.activated} of {p.assigned} activated{p.available!==null&&<span className="studio-help team-email">{p.available} available</span>}</td><td>{p.liveKeys}</td></tr>)}</tbody></table></div>
     :<p className="studio-empty">No partners yet.</p>}</section>
   <section className="catalogue-panel" aria-labelledby="new-title"><h2 id="new-title">New partner</h2><NewPartnerForm/></section>
  </div>
  <section className="catalogue-panel" aria-labelledby="revenue-title"><h2 id="revenue-title">Partner revenue <small className="studio-help">separate from direct sales</small></h2>
   <p className="studio-help">Seat packs count in the month they were bought; postpaid seats in the month they were activated, at the agreed seat price. These are the amounts recorded here; invoices are issued in Stripe.</p>
   {months.length?<div className="partner-scroll"><table className="catalogue-table"><thead><tr><th scope="col">Month</th><th scope="col">Partner</th><th scope="col">Kind</th><th scope="col">Seats</th><th scope="col">Amount</th></tr></thead><tbody>
    {revenue.filter(r=>months.includes(r.month)).map(r=><tr key={`${r.month}-${r.partner}-${r.kind}`}><td>{monthName(r.month)}</td><td>{r.partner}</td><td>{r.kind==='pack'?'Seat packs':'Postpaid seats'}</td><td>{r.seats}</td><td>{money(r.cents)}{r.unpriced>0&&<span className="studio-help team-email">{r.unpriced} without a price</span>}</td></tr>)}
    {months.map(m=>{const t=revenue.filter(r=>r.month===m).reduce((s,r)=>s+r.cents,0);return <tr key={`t-${m}`}><th scope="row">{monthName(m)} total</th><td/><td/><td/><td><strong>{money(t)}</strong></td></tr>;})}</tbody></table></div>
    :<p className="studio-empty">No partner sales yet.</p>}
  </section>
 </StudioShell>;
}

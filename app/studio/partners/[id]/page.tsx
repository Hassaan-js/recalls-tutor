import Link from 'next/link';
import {notFound,redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {getPartnerDetail} from '@/lib/services/partner-admin';
import {StudioShell} from '@/components/studio/nav';
import {EditPartnerForm,KeySuspend,MemberForm,ProductsForm,RemoveMember,SeatPackForm,StatusForm,BrandingForm} from '@/components/studio/partners';
import {day,money,when} from '@/components/partner/format';
import '../../studio.css';
import '@/app/partner/partner.css';
export const metadata={title:'Partner'};
export const dynamic='force-dynamic';
const STATUS:Record<string,string>={pending:'Waiting for approval',active:'Active',suspended:'Suspended'};
export default async function PartnerDetailPage(props:{params:Promise<{id:string}>}) {
 const actor=await getCurrentActor();const access=staffAccess(actor);
 if(access==='unauthenticated')redirect('/sign-in');if(access==='unverified')redirect('/verify-email');if(access==='mfa_required')redirect('/account/security');
 if(access!=='allowed'||!actor||actor.role!=='super_admin')return <StudioShell current="partners" actor={actor} title="Super Admin access required." sub="Partners and their seats are managed by a Super Admin."/>;
 const {id}=await props.params;
 if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
 const d=await getPartnerDetail(getDatabase(),actor.id,id);
 if(!d)notFound();
 const examName=new Map(d.exams.map(e=>[e.id,e.name]));
 const productOptions=d.products.map(p=>({value:`${p.examId}:${p.months}`,label:`${examName.get(p.examId)}, ${p.months} months`}));
 const keys=d.keys.filter(k=>!k.revokedAt&&(!k.expiresAt||new Date(k.expiresAt)>new Date()));
 return <StudioShell current="partners" actor={actor} title={d.org.name}
  sub={<>{STATUS[d.org.status]} · {d.org.billing==='postpaid'?`postpaid${d.org.credit_limit_seats?`, up to ${d.org.credit_limit_seats} seats a month`:''}`:'prepaid seat packs'} · created {day(d.org.created_at)}{d.org.approved_at?`, approved ${day(d.org.approved_at)}`:''} · <Link href="/studio/partners">All partners</Link></>}>
  <div className="partner-figures">
   <div className="partner-figure"><strong>{d.counts.assigned}</strong><span>seats assigned</span></div>
   <div className="partner-figure"><strong>{d.counts.activated}</strong><span>activated</span></div>
   <div className="partner-figure"><strong>{d.counts.invited}</strong><span>waiting for sign-up</span></div>
   <div className="partner-figure"><strong>{d.requests24h.n}</strong><span>API requests in 24 h{d.requests24h.errors?` · ${d.requests24h.errors} errors`:''}</span></div>
  </div>
  <div className="students-columns">
   <section className="catalogue-panel" aria-labelledby="status-title"><h2 id="status-title">Approval</h2>
    <p className="studio-help">{d.org.status==='pending'?'Set the products and add an admin, then approve. Until then the partner can only use sandbox keys.':d.org.status==='suspended'?`Suspended ${day(d.org.suspended_at)}. Students keep the access they have; new seats and live API requests are refused.`:'Suspending stops live API keys at once and makes the portal read-only.'}</p>
    <StatusForm orgId={d.org.id} status={d.org.status}/>
    <h3 className="security-sub">Partner admins</h3>
    {d.members.length?<ul className="security-list">{d.members.map(m=><li key={m.id} className="security-row"><span><strong>{m.name}</strong> <span className="studio-help">{m.email}{m.twoFactor?'':' · no two-step sign-in (needed for API keys)'}</span></span><RemoveMember orgId={d.org.id} userId={m.id}/></li>)}</ul>:<p className="studio-help">No admin yet.</p>}
    <MemberForm orgId={d.org.id}/></section>
   <section className="catalogue-panel" aria-labelledby="details-title"><h2 id="details-title">Details</h2><EditPartnerForm org={d.org}/></section>
   <section className="catalogue-panel" aria-labelledby="brand-title"><h2 id="brand-title">White-label</h2><BrandingForm org={d.org}/></section>
  </div>
  <section className="catalogue-panel" aria-labelledby="products-title"><h2 id="products-title">Products and seat prices</h2><ProductsForm orgId={d.org.id} exams={d.exams} products={d.products}/></section>
  <div className="students-columns">
   <section className="catalogue-panel" aria-labelledby="packs-title"><h2 id="packs-title">Seat packs</h2>
    {d.billing.packs.length?<div className="partner-scroll"><table className="catalogue-table"><thead><tr><th scope="col">Bought</th><th scope="col">Product</th><th scope="col">Left</th><th scope="col">Expires</th><th scope="col">Amount</th></tr></thead><tbody>
     {d.billing.packs.map(p=><tr key={p.id}><td>{day(p.purchased_at)}{p.reference&&<span className="studio-help team-email">{p.reference}</span>}</td><td>{p.exam}, {p.months} months</td><td>{p.expired?'Expired':`${p.remaining} of ${p.seats}`}</td><td>{day(p.expires_at)}</td><td>{money(p.price_cents)}</td></tr>)}</tbody></table></div>
     :<p className="studio-empty">No seat packs yet.</p>}
    {d.org.billing==='prepaid'&&<><h3 className="security-sub">Record a purchase</h3>{productOptions.length?<SeatPackForm orgId={d.org.id} products={productOptions}/>:<p className="studio-help">Allow a product first.</p>}</>}</section>
   <section className="catalogue-panel" aria-labelledby="keys-title"><h2 id="keys-title">API keys</h2>
    {keys.length?<ul className="security-list">{keys.map(k=><li key={k.id} className="security-row"><span><code>{k.prefix}…</code> <span className="studio-help">{k.mode==='live'?'Live':'Sandbox'}{k.label?` · ${k.label}`:''} · last used {when(k.lastUsedAt)}{k.suspendedAt?' · suspended':''}</span></span><KeySuspend orgId={d.org.id} keyId={k.id} suspended={!!k.suspendedAt}/></li>)}</ul>
     :<p className="studio-empty">No active keys.</p>}
    <p className="studio-help">Suspending a key refuses its requests at once. The partner manages its own keys in the Partner Portal.</p></section>
  </div>
 </StudioShell>;
}

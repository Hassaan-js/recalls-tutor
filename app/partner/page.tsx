import Link from 'next/link';
import {getDatabase} from '@/lib/db/client';
import {cohortReport,partnerAlerts,seatBalances} from '@/lib/services/partners';
import {NotPartner,PartnerShell,partnerContext} from '@/components/partner/shell';
import {DismissAlert} from '@/components/partner/forms';
import {day,when} from '@/components/partner/format';
export const metadata={title:'Partner Portal',robots:{index:false}};
export const dynamic='force-dynamic';
// PART-3 overview: seat balance per product, alerts, and the cohort report (progress only for students who agreed).
export default async function PartnerHome(props:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const ctx=await partnerContext('/partner',await props.searchParams);
 if(!ctx)return <NotPartner/>;
 const db=getDatabase();
 const [seats,alerts,cohort]=await Promise.all([seatBalances(db,ctx.org.id,false),partnerAlerts(db,ctx.org.id),cohortReport(db,ctx.org.id)]);
 const available=seats.balances.reduce((s,b)=>s+(b.available??0),0);
 return <PartnerShell ctx={ctx} current="overview" title={ctx.org.name} sub={seats.billing==='postpaid'?`Billed monthly for the seats you activate${seats.credit?.limit?`, up to ${seats.credit.limit} a month`:''}.`:'Prepaid seat packs. Unused seats roll over until their pack expires.'}
  action={ctx.org.status==='active'?<Link className="studio-button" href={`/partner/students${ctx.q}`}>Assign seats</Link>:undefined}>
  {alerts.length>0&&<ul className="partner-alerts" aria-label="Alerts">{alerts.map(a=><li key={a.id}><span>{a.message}</span><DismissAlert orgId={ctx.org.id} id={a.id}/></li>)}</ul>}
  <div className="partner-figures">
   <div className="partner-figure"><strong>{seats.billing==='postpaid'?(seats.credit?.usedThisMonth??0):available}</strong><span>{seats.billing==='postpaid'?'seats used this month':'seats available'}</span></div>
   <div className="partner-figure"><strong>{cohort.assigned}</strong><span>seats assigned</span></div>
   <div className="partner-figure"><strong>{cohort.activationRate===null?'—':`${cohort.activationRate}%`}</strong><span>activated ({cohort.activated} of {cohort.assigned})</span></div>
   <div className="partner-figure"><strong>{cohort.consented}</strong><span>sharing progress with you</span></div>
  </div>
  <section className="catalogue-panel" aria-labelledby="seats-title"><h2 id="seats-title">Seats by product</h2>
   {seats.balances.length?<div className="partner-scroll"><table className="catalogue-table"><thead><tr><th scope="col">Product</th><th scope="col">Available</th><th scope="col">Assigned</th><th scope="col">Activated</th><th scope="col">Packs</th></tr></thead><tbody>
    {seats.balances.map(b=><tr key={b.product}><th scope="row">{b.exam}, {b.months} months<span className="studio-help team-email"><code>{b.product}</code></span></th><td>{b.available===null?'Postpaid':b.available}</td><td>{b.assigned}</td><td>{b.activated}</td>
     <td>{b.packs.length?b.packs.map(p=><span key={p.id} className="studio-help team-email">{p.remaining} of {p.seats} left · expires {day(p.expiresAt)}</span>):seats.billing==='postpaid'?'—':<span className="studio-help">No live pack</span>}</td></tr>)}</tbody></table></div>
    :<p className="studio-help">Recalls Tutor has not set up your products yet.</p>}
   {seats.billing==='prepaid'&&<p className="studio-help">You are alerted when a product drops to {seats.lowBalanceAt} seats. To buy more seats, contact Recalls Tutor.</p>}
  </section>
  <section className="catalogue-panel" aria-labelledby="cohort-title"><h2 id="cohort-title">Cohort progress</h2>
   <p className="studio-help">Only students who chose to share their progress with {ctx.org.name} appear here. They can stop sharing at any time from their profile.</p>
   {cohort.students.length?<>
    <p className="studio-help">{cohort.answered.toLocaleString('en-GB')} questions answered{cohort.averageMockScore!==null?` · average mock score ${cohort.averageMockScore}%`:''}.</p>
    <div className="partner-scroll"><table className="catalogue-table"><thead><tr><th scope="col">Student</th><th scope="col">Answered</th><th scope="col">Accuracy</th><th scope="col">Mocks</th><th scope="col">Last active</th><th scope="col">Access ends</th></tr></thead><tbody>
     {cohort.students.map(s=><tr key={s.id}><th scope="row">{s.email}<span className="studio-help team-email">{s.exam}</span></th><td>{s.answered}</td><td>{s.accuracy===null?'—':`${s.accuracy}%`}</td><td>{s.mocks?`${s.mocks} · ${s.average_mock_score}%`:'—'}</td><td>{when(s.last_active_at)}</td><td>{day(s.accessEndsAt)}</td></tr>)}</tbody></table></div></>
    :<p className="studio-empty">No student is sharing progress yet.</p>}
  </section>
 </PartnerShell>;
}

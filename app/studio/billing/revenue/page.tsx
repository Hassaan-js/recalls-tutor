import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {CouponError,revenueReport,type RevenueGroup} from '@/lib/services/coupons';
import {StudioShell} from '@/components/studio/nav';
import {BillingTabs} from '@/components/studio/billing-tabs';
import {money} from '@/components/partner/format';
import '../../studio.css';
import '@/app/partner/partner.css';
export const metadata={title:'Revenue'};
export const dynamic='force-dynamic';
const iso=(d:Date)=>d.toISOString().slice(0,10);
const DATE=/^\d{4}-\d{2}-\d{2}$/;
function Breakdown({title,rows,empty}:{title:string;rows:RevenueGroup[];empty:string}) {
 return <section className="catalogue-panel" aria-label={title}><h2>{title}</h2>
  {rows.length?<div className="partner-scroll"><table className="catalogue-table revenue-table"><thead><tr><th scope="col">{title.replace(/^By /,'').replace(/^./,c=>c.toUpperCase())}</th><th scope="col">Payments</th><th scope="col">Paid</th><th scope="col">Discounts</th><th scope="col">Refunds</th><th scope="col">Disputes</th></tr></thead><tbody>
   {rows.map(r=><tr key={r.key??r.label}><th scope="row">{r.label}</th><td>{r.payments}</td><td>{money(r.paidCents)}</td><td>{money(r.discountCents)}</td><td>{money(r.refundCents)}</td><td>{money(r.disputeCents)}</td></tr>)}</tbody></table></div>
   :<p className="studio-empty">{empty}</p>}</section>;
}
// BILL-6: revenue by period, exam, sitting page, new vs renewal and coupon, with refunds and disputes, in UTC.
export default async function RevenuePage(props:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const actor=await getCurrentActor();const access=staffAccess(actor);
 if(access==='unauthenticated')redirect('/sign-in');if(access==='unverified')redirect('/verify-email');if(access==='mfa_required')redirect('/account/security');
 if(access!=='allowed'||!actor||actor.role!=='super_admin')return <StudioShell current="billing" actor={actor} title="Super Admin access required." sub="Revenue reports are for a Super Admin."/>;
 const q=await props.searchParams;const now=new Date();
 const from=typeof q.from==='string'&&DATE.test(q.from)?q.from:iso(new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-5,1)));
 const to=typeof q.to==='string'&&DATE.test(q.to)?q.to:iso(now);
 const group=q.group==='day'?'day':'month';
 let report:Awaited<ReturnType<typeof revenueReport>>|null=null,error='';
 try{report=await revenueReport(getDatabase(),actor.id,{from,to,group});}catch(e){if(e instanceof CouponError)error=e.message;else throw e;}
 const t=report?.totals;
 return <StudioShell current="billing" actor={actor} title="Billing" sub="Direct sales from Stripe payments. Partner seat sales are reported on the Partners page.">
  <BillingTabs current="revenue"/>
  <form method="get" className="catalogue-inline revenue-filter">
   <label className="studio-field">From<input type="date" name="from" defaultValue={from} required/></label>
   <label className="studio-field">To<input type="date" name="to" defaultValue={to} required/></label>
   <label className="studio-field">Group by<select name="group" defaultValue={group}><option value="month">Month</option><option value="day">Day</option></select></label>
   <button className="studio-button studio-button-secondary">Show</button>
   <a className="studio-button" href={`/studio/billing/revenue/export?from=${from}&to=${to}`} download>Download CSV</a>
  </form>
  {error&&<p className="studio-feedback studio-error" role="alert">{error}</p>}
  {report&&t&&<>
   <div className="partner-figures">
    <div className="partner-figure"><strong>{money(t.netCents)}</strong><span>Net after refunds and disputes</span></div>
    <div className="partner-figure"><strong>{money(t.paidCents)}</strong><span>Paid · {t.payments} payment{t.payments===1?'':'s'}</span></div>
    <div className="partner-figure"><strong>{money(t.newCents)}</strong><span>New subscriptions · {money(t.renewalCents)} renewals</span></div>
    <div className="partner-figure"><strong>{money(t.refundCents+t.disputeCents)}</strong><span>Refunds {money(t.refundCents)} · disputes {money(t.disputeCents)}</span></div>
   </div>
   <p className="studio-help revenue-note">Dates are in UTC. Payments count on the day Stripe marked them paid; refunds and disputes count on the day they happened. A dispute the business won is not counted. Discounts are the amount coupons took off.</p>
   <section className="catalogue-panel" aria-labelledby="period-title"><h2 id="period-title">By {group}</h2>
    {report.periods.length?<div className="partner-scroll"><table className="catalogue-table revenue-table"><thead><tr><th scope="col">{group==='day'?'Day':'Month'}</th><th scope="col">Payments</th><th scope="col">New</th><th scope="col">Renewals</th><th scope="col">Discounts</th><th scope="col">Refunds</th><th scope="col">Disputes</th><th scope="col">Net</th></tr></thead><tbody>
     {report.periods.map(p=><tr key={p.key}><th scope="row">{group==='day'?new Date(`${p.key}T00:00:00Z`).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):new Date(`${p.key}-01T00:00:00Z`).toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'})}</th>
      <td>{p.payments}</td><td>{money(p.newCents)}</td><td>{money(p.renewalCents)}</td><td>{money(p.discountCents)}</td><td>{money(p.refundCents)}</td><td>{money(p.disputeCents)}</td><td><strong>{money(p.paidCents-p.refundCents-p.disputeCents)}</strong></td></tr>)}</tbody></table></div>
     :<p className="studio-empty">No payments in these dates.</p>}</section>
   <div className="students-columns">
    <Breakdown title="By exam" rows={report.exams} empty="No payments in these dates."/>
    <Breakdown title="By type" rows={report.kinds} empty="No payments in these dates."/>
   </div>
   <div className="students-columns">
    <Breakdown title="By sitting page" rows={report.sittings} empty="No payments in these dates."/>
    <Breakdown title="By coupon" rows={report.coupons} empty="No payments in these dates."/>
   </div>
   <p className="studio-help revenue-note">“By sitting page” is the sitting page a student was on when they chose a plan. Plans are sold per exam, so purchases from the exam or pricing page show as “Not from a sitting page”.</p>
  </>}
 </StudioShell>;
}

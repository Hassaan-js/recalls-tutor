import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {describeDiscount,listCoupons,personalOfferStats} from '@/lib/services/coupons';
import {StudioShell} from '@/components/studio/nav';
import {BillingTabs} from '@/components/studio/billing-tabs';
import {CouponForm,OfferSettingsForm,SyncCoupons,TurnOffCoupon} from '@/components/studio/coupons';
import {lifecycleSummary,offerSettings} from '@/lib/services/lifecycle';
import {money} from '@/components/partner/format';
import '../../studio.css';
import '@/app/partner/partner.css';
export const metadata={title:'Coupons'};
export const dynamic='force-dynamic';
const STATE:Record<string,[string,string]>={live:['Live','active'],not_synced:['Not in Stripe yet','invited'],expired:['Expired','expired'],used_up:['Used up','expired'],off:['Turned off','revoked']};
const PURPOSE:Record<string,string>={win_back:'Win-back codes',trial_offer:'Trial offer codes',referral:'Referral reward codes'};
const EMAIL:Record<string,string>={renewal_reminder:'Renewal reminders (7 days before)',receipt:'Receipts',payment_failed:'Payment failed',trial_day2:'Trial day 2',trial_day3:'Trial day 3',win_back:'Win-back offers',trial_offer:'Trial offers',referral_reward:'Referral rewards'};
const day=(v:string)=>new Date(v).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
export default async function CouponsPage() {
 const actor=await getCurrentActor();const access=staffAccess(actor);
 if(access==='unauthenticated')redirect('/sign-in');if(access==='unverified')redirect('/verify-email');if(access==='mfa_required')redirect('/account/security');
 if(access!=='allowed'||!actor||actor.role!=='super_admin')return <StudioShell current="billing" actor={actor} title="Super Admin access required." sub="Coupons are managed by a Super Admin."/>;
 const db=getDatabase();
 const [coupons,personal,exams,offers,emails]=await Promise.all([listCoupons(db,actor.id),personalOfferStats(db,actor.id),db.query<{id:string;name:string}>('SELECT id,name FROM exams ORDER BY name'),offerSettings(db),lifecycleSummary(db)]);
 const configured=Boolean(process.env.STRIPE_SECRET_KEY),unsynced=coupons.filter(c=>c.state==='not_synced').length;
 return <StudioShell current="billing" actor={actor} title="Billing" sub="Coupons and promotion codes. Each code is created in Stripe, and students can enter it on the Stripe checkout page or follow a link that applies it.">
  <BillingTabs current="coupons"/>
  {!configured&&<p className="studio-feedback catalogue-warn">Stripe is not connected. Coupons can be prepared now and sent to Stripe once STRIPE_SECRET_KEY is added.</p>}
  <div className="students-columns">
   <section className="catalogue-panel" aria-labelledby="codes-title"><h2 id="codes-title">Codes</h2>
    {unsynced>0&&<SyncCoupons disabled={!configured}/>}
    {coupons.length?<div className="partner-scroll"><table className="catalogue-table"><thead><tr><th scope="col">Code</th><th scope="col">Discount</th><th scope="col">Used</th><th scope="col">Revenue</th><th scope="col">Status</th></tr></thead><tbody>
     {coupons.map(c=><tr key={c.id}><th scope="row"><strong className="coupon-code">{c.code}</strong><span className="studio-help team-email">{c.name}</span></th>
      <td>{describeDiscount(c)}<span className="studio-help team-email">{c.exams.length?c.exams.join(', '):'All exams'}{c.firstTimeOnly?' · first purchase only':''}{c.expiresAt?` · until ${day(c.expiresAt)}`:''}</span></td>
      <td>{c.uses}{c.maxRedemptions!==null?` of ${c.maxRedemptions}`:''}<span className="studio-help team-email">{money(c.discountCents)} given</span></td>
      <td>{money(c.paidCents)}</td>
      <td><span className={`partner-state partner-state-${STATE[c.state][1]}`}>{STATE[c.state][0]}</span>{c.active&&<TurnOffCoupon id={c.id} code={c.code}/>}</td></tr>)}</tbody></table></div>
     :<p className="studio-empty">No coupons yet.</p>}
    <h3 className="coupon-subhead">Sharing a code</h3>
    <p className="studio-help">Students can type any live code on the Stripe checkout page. To apply one for them, link to an exam page with the code added, for example <code>/mrcog/part-1-recalls?code=SPRING25</code>.</p>
    <h3 className="coupon-subhead">Personal offers sent by email</h3>
    {personal.length?<ul className="security-list">{personal.map(p=><li key={p.purpose}><div className="security-row"><strong>{PURPOSE[p.purpose]??p.purpose}</strong><span>{p.used} of {p.issued} used</span></div><p className="studio-help">{money(p.paidCents)} paid with these codes</p></li>)}</ul>
     :<p className="studio-help">None sent yet. Single-use codes are created for one student at a time by the win-back and trial emails.</p>}
   </section>
   <div><section className="catalogue-panel" aria-labelledby="new-title"><h2 id="new-title">New coupon</h2><CouponForm exams={exams}/></section>
    <section className="catalogue-panel" aria-labelledby="offers-title"><h2 id="offers-title">Personal offers</h2>
     <p className="studio-help">Each offer is a single-use code for one student and one exam. It is sent only to students who have not turned offers off, and never after a refund or dispute.</p>
     <OfferSettingsForm winBackPercent={offers.winBackPercent} winBackValidDays={offers.winBackValidDays} trialOfferPercent={offers.trialOfferPercent} referralPercent={offers.referralPercent}/>
     <h3 className="coupon-subhead">Emails in the last 30 days</h3>
     {emails.length?<ul className="security-list">{emails.map(e=><li key={e.kind}><div className="security-row"><strong>{EMAIL[e.kind]??e.kind}</strong><span>{e.sent} sent</span></div><p className="studio-help">{e.waiting} waiting · {e.skipped} skipped because they no longer applied{e.failing?` · ${e.failing} failed five times`:''}</p></li>)}</ul>:<p className="studio-help">None yet. Emails are sent by the hourly job once the site is deployed.</p>}
    </section></div>
  </div>
 </StudioShell>;
}

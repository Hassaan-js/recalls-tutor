import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {SuspendedNotice} from '@/components/auth/suspended';
import {getDatabase} from '@/lib/db/client';
import {examOptions,getProfile} from '@/lib/services/student';
import {StudentShell} from '@/components/practice/shell';
import {DeleteAccountForm,EmailForm,ProfileForm} from '@/components/account/profile-forms';
import {partnerMemberships,studentPartners} from '@/lib/services/partners';
import {SharingToggle} from '@/components/partner/forms';
import {OffersToggle} from '@/components/account/offers-toggle';
import {marketingEmails} from '@/lib/services/lifecycle';
import {referralSummary} from '@/lib/services/referrals';
import {ReferralLink} from '@/components/account/referral-link';
import {siteUrl} from '@/lib/seo';
export const metadata={title:'Profile',robots:{index:false}};
export const dynamic='force-dynamic';
export default async function ProfilePage() {
 const actor=await getCurrentActor();
 if(!actor)redirect('/sign-in?next=/account/profile');
 if(actor.suspended)return <SuspendedNotice/>;
 const db=getDatabase();
 const [profile,exams,partners,adminOf,offers]=await Promise.all([getProfile(db,actor.id),examOptions(db),studentPartners(db,actor.id),partnerMemberships(db,actor.id),marketingEmails(db,actor.id)]);
 const referral=actor.role==='student'?await referralSummary(db,actor.id):null;
 return <StudentShell active="profile" title="Profile" actor={actor}><div className="app-column">
  <div className="app-title"><div><h1>Profile</h1><p className="app-sub">{profile.examDate?`Exam on ${new Date(profile.examDate).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'})}`:'Add your exam date to see a countdown on your practice home.'}</p></div></div>
  <section className="sheet account-sheet" aria-labelledby="about-title"><h2 id="about-title">About you</h2><ProfileForm profile={profile} exams={exams} zones={Intl.supportedValuesOf('timeZone')}/></section>
  <div className="grid12">
   <section className="panel span6" aria-labelledby="email-title"><div className="panel-head"><h2 id="email-title">Email address</h2></div><EmailForm email={profile.email}/></section>
   <section className="panel span6" aria-labelledby="security-title"><div className="panel-head"><h2 id="security-title">Password and two-step sign-in</h2></div><p className="account-note">Turn on two-step sign-in, or reset your password from the sign-in screen.</p><Link className="practice-ghost" href="/account/security">Account security</Link></section>
  </div>
  {partners.length>0&&<section className="panel" aria-labelledby="partners-title"><div className="panel-head"><h2 id="partners-title">Course providers</h2></div>
   <p className="account-note">These organisations gave you a seat. They see your progress (questions answered, accuracy and mock scores) only if you choose to share it, and you can stop at any time.</p>
   <ul className="ways">{partners.map(p=><li key={p.id}><span className="way-main"><strong>{p.name}</strong><span>{p.sharing?'Sees your progress for the exams they gave you.':'Sees only that you activated your seat.'}</span></span><SharingToggle orgId={p.id} name={p.name} sharing={p.sharing}/></li>)}</ul></section>}
  {adminOf.length>0&&<section className="panel" aria-labelledby="portal-title"><div className="panel-head"><h2 id="portal-title">Partner Portal</h2></div><p className="account-note">You manage seats for {adminOf.map(o=>o.name).join(', ')}.</p><Link className="practice-ghost" href="/partner">Open the Partner Portal</Link></section>}
  {referral&&<section className="panel" aria-labelledby="invite-title"><div className="panel-head"><h2 id="invite-title">Invite a friend</h2></div>
   <ul className="ways"><li><span className="way-main"><strong>Your link</strong><span>{referral.joined?`${referral.joined} ${referral.joined===1?'friend has':'friends have'} joined, ${referral.paid} started a plan.`:'Share it with someone preparing for the same exam.'}{referral.rewardPercent?` When a friend starts a plan, you get ${referral.rewardPercent}% off your next payment.`:''}</span></span><ReferralLink url={`${siteUrl()}/r/${referral.code}`}/></li></ul></section>}
  <section className="panel" aria-labelledby="emails-title"><div className="panel-head"><h2 id="emails-title">Emails</h2></div>
   <ul className="ways"><li><span className="way-main"><strong>Offers</strong><span>Occasional discounts, such as when a trial or plan ends. Receipts, renewal reminders and trial notices always arrive.</span></span><OffersToggle on={offers}/></li></ul></section>
  <section className="panel" aria-labelledby="data-title"><div className="panel-head"><h2 id="data-title">Your data</h2></div>
   <ul className="ways"><li><span className="way-main"><strong>Download your data</strong><span>Your account, profile, plans, sessions, answers, notes and bookmarks as a JSON file.</span></span><a className="practice-ghost" href="/account/export" download>Download</a></li>
    {actor.role==='student'?<li><span className="way-main"><strong>Delete your account</strong><span>Erases your personal details and signs you out everywhere.</span></span><DeleteAccountForm email={profile.email}/></li>
     :<li><span className="way-main"><strong>Delete your account</strong><span>Staff accounts are removed by a Super Admin.</span></span></li>}</ul></section>
 </div></StudentShell>;
}

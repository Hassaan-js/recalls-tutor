import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {getBillingAdmin} from '@/lib/services/billing';
import {BillingActions,BillingAlerts,FailedEvents,PlansEditor,SubscriptionTable} from '@/components/studio/billing';
import {StudioShell} from '@/components/studio/nav';
import {BillingTabs} from '@/components/studio/billing-tabs';
import '../studio.css';
export const metadata={title:'Billing'};
export const dynamic='force-dynamic';
export default async function BillingPage(props:PageProps<'/studio/billing'>) {
 const actor=await getCurrentActor();const access=staffAccess(actor);
 if(access==='unauthenticated')redirect('/sign-in');if(access==='unverified')redirect('/verify-email');if(access==='mfa_required')redirect('/account/security');
 if(access!=='allowed'||!actor||actor.role!=='super_admin')return <StudioShell current="billing" actor={actor} title="Super Admin access required." sub="Plans, prices and refunds are managed by a Super Admin."/>;
 const query=await props.searchParams;const search=typeof query.q==='string'?query.q.slice(0,100):'';
 const data=await getBillingAdmin(getDatabase(),actor.id,search);
 const key=process.env.STRIPE_SECRET_KEY??'',configured=Boolean(key),webhook=Boolean(process.env.STRIPE_WEBHOOK_SECRET);
 return <StudioShell current="billing" actor={actor} title="Billing" sub="Plans and prices, subscriptions, refunds and disputes. Stripe webhooks decide who has paid access.">
  <BillingTabs current="plans"/>
  <p className={`studio-feedback${configured&&webhook?'':' catalogue-warn'}`}>{configured?`Stripe connected in ${key.startsWith('sk_live_')?'live':'test'} mode.`:'Stripe is not connected: prices can be set, but checkout stays closed until STRIPE_SECRET_KEY is added.'}{configured&&!webhook?' The webhook secret (STRIPE_WEBHOOK_SECRET) is missing, so payments cannot grant access yet.':''}</p>
  <BillingActions configured={configured}/>
  <div className="catalogue-columns"><div><section className="catalogue-panel"><h2>Plans and prices (USD)</h2><PlansEditor exams={data.exams} plans={data.plans}/></section></div>
   <div><section className="catalogue-panel"><h2>Alerts</h2><BillingAlerts alerts={data.alerts}/></section>
    <section className="catalogue-panel"><h2>Subscriptions</h2><form method="get" className="catalogue-inline"><label className="studio-field">Find by email<input name="q" defaultValue={search} maxLength={100}/></label><button className="studio-button studio-button-secondary">Search</button></form><SubscriptionTable rows={data.subscriptions} canRefund={configured}/></section>
    <section className="catalogue-panel"><h2>Unprocessed Stripe events</h2><FailedEvents events={data.failedEvents}/></section></div></div>
 </StudioShell>;
}

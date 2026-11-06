import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {SuspendedNotice} from '@/components/auth/suspended';
import {getDatabase} from '@/lib/db/client';
import {listMyPlans} from '@/lib/services/billing';
import {AutoRenewToggle} from '@/components/billing/my-plans';
import {openBillingPortal} from '@/app/billing/actions';
import {StudentShell} from '@/components/practice/shell';
import {usd} from '@/lib/seo';
export const metadata={title:'My plans',robots:{index:false}};
export const dynamic='force-dynamic';
const date=(value:string)=>new Date(value).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
function describe(p:Awaited<ReturnType<typeof listMyPlans>>[number]) {
 if(p.hold==='refunded')return 'Refunded. Access has ended.';
 if(p.hold==='disputed')return 'Access is paused while a payment dispute is reviewed.';
 if(p.status==='past_due')return `Your last payment didn’t go through. Access continues until ${p.graceUntil?date(p.graceUntil):'the grace period ends'} while it is retried. Update your card in Manage billing.`;
 if(['active','trialing'].includes(p.status))return p.autoRenew?`Renews on ${p.periodEnd?date(p.periodEnd):'the next billing date'}.`:`Auto-renew is off. Access ends on ${p.periodEnd?date(p.periodEnd):'the end of the period'}.`;
 if(p.status==='unpaid'||p.status==='paused')return 'Access is paused until the outstanding payment is made.';
 return 'This plan has ended. Your progress is saved if you subscribe again.';
}
// "Is my plan renewing, and until when do I have access?"
export default async function MyPlansPage(props:PageProps<'/account/plans'>) {
 const actor=await getCurrentActor();if(!actor)redirect('/sign-in?next=/account/plans');if(actor.suspended)return <SuspendedNotice/>;
 const [plans,query]=await Promise.all([listMyPlans(getDatabase(),actor.id),props.searchParams]);
 const notice=typeof query.notice==='string'?query.notice.slice(0,300):'';
 const live=plans.filter(p=>p.accessUntil);
 return <StudentShell active="plans" title="My plans" actor={actor}><div className="app-column">
  <div className="app-title"><div><h1>My plans</h1><p className="app-sub">{live.length?`${live.length} active plan${live.length===1?'':'s'}. Plans renew automatically until you turn auto-renew off.`:'You don’t have an active paid plan.'}</p></div>
   {plans.length>0?<form action={openBillingPortal}><button className="practice-button">Manage billing and invoices</button></form>:<Link className="practice-button" href="/pricing">See plans</Link>}</div>
  {notice&&<p className="practice-feedback practice-error" role="alert">{notice}</p>}
  <div className="grid12 tiles"><section className="panel span12" aria-labelledby="plans-title"><div className="panel-head"><h2 id="plans-title">Plans<span className="count">{plans.length}</span></h2><span className="state">Payment details and invoices are handled securely by Stripe</span></div>
   {plans.length?<ul className="rows">{plans.map(p=><li key={p.id} className="rowcard plan-row"><span className="main"><strong>{p.examName} · {p.months===1?'1 month':`${p.months} months`} · {usd(p.priceCents)}</strong><span>{describe(p)}</span>{p.accessUntil&&<span>Access until {date(p.accessUntil)}</span>}</span>
    <AutoRenewToggle subscriptionId={p.id} autoRenew={p.autoRenew} disabled={!!p.hold||!['active','trialing','past_due'].includes(p.status)}/></li>)}</ul>
    :<p className="empty">When you buy a plan it appears here, with its renewal date and an auto-renew switch. <Link className="practice-link" href="/pricing">See plans</Link></p>}</section></div>
 </div></StudentShell>;
}

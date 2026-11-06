import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {getOverview} from '@/lib/services/admin';
import {StudioShell} from '@/components/studio/nav';
import {aiUsage} from '@/lib/services/proposals';
import {AiBudgetForm} from '@/components/studio/proposals';
import {BAND_LABEL,CALIBRATION_MIN,predictorCalibration,type Band} from '@/lib/services/predictor';
import '../studio.css';
export const metadata={title:'Overview'};
export const dynamic='force-dynamic';
const money=(cents:number)=>`$${(cents/100).toLocaleString('en-US',{minimumFractionDigits:cents%100?2:0,maximumFractionDigits:2})}`;
const plural=(n:number,one:string,many=`${one}s`)=>`${n} ${n===1?one:many}`;
const usd=(v:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:v<10?2:0}).format(v);
function Figure({label,value,note,href}:{label:string;value:React.ReactNode;note?:React.ReactNode;href?:string}) {
 const body=<><span className="overview-label">{label}</span><strong className="overview-value">{value}</strong>{note&&<span className="overview-note">{note}</span>}</>;
 return <li className="overview-figure">{href?<Link href={href}>{body}</Link>:body}</li>;
}
// ADM-1: what needs a person today first, then students, access, money (Super Admin) and content.
export default async function OverviewPage() {
 const actor=await getCurrentActor();const access=staffAccess(actor);
 if(access==='unauthenticated')redirect('/sign-in');if(access==='unverified')redirect('/verify-email');if(access==='mfa_required')redirect('/account/security');
 if(access!=='allowed'||!actor)return <StudioShell current="overview" actor={actor} title="Staff access required." sub="Your account cannot open the admin overview."/>;
 const o=await getOverview(getDatabase(),actor.id);const superAdmin=actor.role==='super_admin';
 const ai=actor.role==='reviewer'?null:await aiUsage(getDatabase(),actor.id);
 const todo=[
  o.content.inReview&&{text:`${plural(o.content.inReview,'question')} waiting for review`,href:'/studio?status=review'},
  o.content.approved&&{text:`${plural(o.content.approved,'approved question')} not yet published`,href:'/studio?status=approved'},
  o.attention.reports&&{text:`${plural(o.attention.reports,'student report')} on questions`,href:'/studio'},
  superAdmin&&o.attention.securityAlerts&&{text:`${plural(o.attention.securityAlerts,'scraping alert')}`,href:'/studio/security'},
  superAdmin&&(o.attention.billingAlerts+o.attention.failedWebhooks)&&{text:`${plural(o.attention.billingAlerts+o.attention.failedWebhooks,'billing issue')} (alerts and failed webhooks)`,href:'/studio/billing'},
  ai?.overBudget&&{text:`AI spend this month (${usd(ai.total)}) is over the ${usd(ai.budget!)} budget`,href:'/studio/overview#ai-title'},
  ai&&!ai.overBudget&&ai.nearBudget&&{text:`AI spend this month has reached 80% of the ${usd(ai.budget!)} budget`,href:'/studio/overview#ai-title'},
  o.content.jobsFailed7d&&{text:`${plural(o.content.jobsFailed7d,'AI job')} failed this week`,href:'/studio'},
 ].filter((t):t is {text:string;href:string}=>Boolean(t));
 const peak=Math.max(1,...o.signups.map(d=>d.n));
 return <StudioShell current="overview" actor={actor} title="Overview" sub={todo.length?`${plural(todo.length,'thing needs','things need')} a person today.`:'Nothing needs attention right now.'}>
  <section className="catalogue-panel overview-todo" aria-labelledby="todo-title"><h2 id="todo-title">Needs attention</h2>
   {todo.length?<ul>{todo.map(t=><li key={t.href+t.text}><Link href={t.href}>{t.text}</Link></li>)}</ul>:<p className="studio-help">The review queue, student reports{superAdmin?', alerts and billing':''} are all clear.</p>}</section>
  <section className="catalogue-panel" aria-labelledby="students-title"><h2 id="students-title">Students</h2>
   <ul className="overview-grid">
    <Figure label="Accounts" value={o.students.total} note={`${o.students.verified} verified`} href={superAdmin?'/studio/students':undefined}/>
    <Figure label="New in 7 days" value={o.students.new7d} note={`${o.students.new30d} in 30 days`}/>
    <Figure label="Active in 7 days" value={o.students.active7d} note="answered at least one question"/>
   </ul>
   <div className="overview-chart" role="img" aria-label={`New student accounts per day for the last 14 days: ${o.signups.map(d=>d.n).join(', ')}`}>
    {o.signups.map(d=><span key={d.day} className="overview-bar" title={`${new Date(d.day).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'})}: ${d.n}`}><i style={{height:`${Math.round(100*d.n/peak)}%`}}/></span>)}
   </div><p className="studio-help">New accounts per day, last 14 days.</p></section>
  <div className="catalogue-columns">
   <section className="catalogue-panel" aria-labelledby="access-title"><h2 id="access-title">Access</h2>
    <ul className="overview-grid overview-grid-2">
     <Figure label="Paying students" value={o.access.paying} href={superAdmin?'/studio/students?filter=paying':undefined}/>
     <Figure label="Free trials running" value={o.access.trials} href={superAdmin?'/studio/students?filter=trial':undefined}/>
     <Figure label="Complimentary access" value={o.access.complimentary} href={superAdmin?'/studio/students?filter=complimentary':undefined}/>
     <Figure label="Renewals in 14 days" value={o.access.renewalsDue14d} note={o.access.pastDue?`${o.access.pastDue} past due, in grace`:'none past due'}/>
    </ul>
    {o.money?<><h3 className="security-sub">Money <small className="studio-help">from plan prices; Stripe has the collected totals</small></h3><ul className="overview-grid overview-grid-2">
     <Figure label="Monthly recurring" value={money(o.money.mrrCents)} note="plans that will renew, per month"/>
     <Figure label="New plans, 30 days" value={money(o.money.newValue30dCents)} note={o.money.refunds30d?`${plural(o.money.refunds30d,'refund')} in 30 days`:'no refunds in 30 days'}/>
    </ul></>:<p className="studio-help">Revenue and recurring income are visible to a Super Admin.</p>}</section>
   <section className="catalogue-panel" aria-labelledby="content-title"><h2 id="content-title">Content</h2>
    <ul className="overview-grid overview-grid-2">
     <Figure label="Published" value={o.content.published} note="live for students"/>
     <Figure label="Waiting for review" value={o.content.inReview} href="/studio?status=review"/>
     <Figure label="Approved, not published" value={o.content.approved} href="/studio?status=approved"/>
     <Figure label="AI jobs running" value={o.content.jobsRunning} note={o.content.jobsFailed7d?`${o.content.jobsFailed7d} failed this week`:'none failed this week'}/>
    </ul></section>
  </div>
  {ai&&<section className="catalogue-panel" aria-labelledby="ai-title"><h2 id="ai-title">AI usage this month</h2>
   <ul className="overview-grid"><Figure label="Spend" value={usd(ai.total)} note={ai.budget!==null?`of ${usd(ai.budget)} budget`:'no budget set'}/><Figure label="Drafts created" value={ai.drafts} note={ai.perDraft!==null?`${usd(ai.perDraft)} each on average`:`${ai.jobs} jobs`}/><Figure label="Refinements" value={ai.refines} note={`${usd(ai.refineCost)}`}/><Figure label="Scanned-file reading" value={usd(ai.ocr)} note={`${ai.failed} failed jobs`}/></ul>
   <p className="studio-help">Estimated from Claude list prices for each request. Each draft’s share of its job’s cost is stored with that version.</p>
   {superAdmin&&<AiBudgetForm budget={ai.budget}/>}</section>}
  <PredictorAccuracy/>
 </StudioShell>;
}

// PP-3: how often students in each predicted band said they passed. Shown once an exam has enough answers.
async function PredictorAccuracy() {
 const rows=await predictorCalibration(getDatabase());
 const exams=[...new Map(rows.map(r=>[r.examId,{exam:r.exam,outcomes:r.outcomes}])).entries()];
 return <section className="catalogue-panel" aria-labelledby="pp-title"><h2 id="pp-title">Pass Predictor accuracy</h2>
  <p className="studio-help">After their exam date, students are asked whether they passed. Accuracy is shown once an exam has {CALIBRATION_MIN} answers.</p>
  <ul className="security-list">{exams.map(([id,e])=>{const bands=rows.filter(r=>r.examId===id&&r.band);
   return <li key={id}><div className="security-row"><strong>{e.exam}</strong><span>{e.outcomes} {e.outcomes===1?'answer':'answers'}</span></div>
    <p className="studio-help">{e.outcomes<CALIBRATION_MIN?`${CALIBRATION_MIN-e.outcomes} more needed before accuracy is meaningful.`:bands.map(b=>`${BAND_LABEL[b.band as Band]}: ${Math.round(100*b.passed/Math.max(1,b.students))}% passed (${b.students})`).join(' · ')}</p></li>;})}</ul></section>;
}

import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {SuspendedNotice} from '@/components/auth/suspended';
import {getDatabase} from '@/lib/db/client';
import {listPracticeExams} from '@/lib/services/practice';
import {INTERVAL_DAYS,reviewSummary,studyPlanner} from '@/lib/services/review';
import {StudentShell} from '@/components/practice/shell';
import {QuickStart} from '@/components/practice/start-form';
export const metadata={title:'Study plan',robots:{index:false}};
export const dynamic='force-dynamic';
const plural=(n:number,one:string,many=`${one}s`)=>`${n} ${n===1?one:many}`;
// STU-13: this week's plan from the student's own data: reviews due each day, new questions to reach the
// daily target, a focus topic that rotates through the weakest, and one timed paper a week.
export default async function PlanPage(props:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const actor=await getCurrentActor();
 if(!actor)redirect('/sign-in?next=/practice/plan');if(!actor.emailVerified)redirect('/verify-email');
 if(actor.suspended)return <SuspendedNotice/>;
 const db=getDatabase();const query=await props.searchParams;
 const exams=await listPracticeExams(db,actor.id);
 const exam=exams.find(e=>e.id===query.exam)??exams[0];
 if(!exam)return <StudentShell active="plan" title="Study plan" actor={actor}><div className="app-column"><div className="app-title"><div><h1>Study plan</h1><p className="app-sub">Your plan appears once you have access to an exam.</p></div></div><Link className="practice-button" href="/practice">Go to practice</Link></div></StudentShell>;
 const [plan,review]=await Promise.all([studyPlanner(db,actor.id,exam.id),reviewSummary(db,actor.id,exam.id)]);
 const shellExams=exams.map(e=>({id:e.id,name:e.name,access:e.access}));
 const sub=plan.daysLeft===null?'Add your exam date in your profile to plan up to exam day.':plan.daysLeft>0?`${plural(plan.daysLeft,'day')} to your exam.`:plan.daysLeft===0?'Exam day. Light revision only.':'Your exam date has passed. Update it in your profile.';
 return <StudentShell active="plan" title="Study plan" actor={actor} exams={shellExams} examId={exam.id}><div className="app-column">
  <div className="app-title"><div><h1>Study plan for {exam.name}</h1><p className="app-sub">{sub}</p></div></div>
  <section className="panel plan-strip" aria-label="This week at a glance">
   <div className="plan-cell"><p className="plan-label">Streak</p><p className="plan-figure">{plural(plan.streak,'day')}</p><p className="plan-note">{plan.bestStreak>plan.streak?`Best so far: ${plural(plan.bestStreak,'day')}.`:plan.streak?'Your best yet.':'Answer a question today to start one.'}</p></div>
   <div className="plan-cell"><p className="plan-label">Daily target</p><p className="plan-figure">{plan.answeredToday} <small>of {plan.dailyTarget} today</small></p>
    <span className="track" role="img" aria-label={`${plan.answeredToday} of ${plan.dailyTarget} answered today`}><span className="fill" style={{width:`${Math.min(100,Math.round(100*plan.answeredToday/plan.dailyTarget))}%`}}/></span>
    <p className="plan-note">{plan.targetSource==='default'?<>A starting suggestion. <Link className="practice-link" href="/account/profile">Set your own</Link></>:<Link className="practice-link" href="/account/profile">Change it in your profile</Link>}</p></div>
   <div className="plan-cell"><p className="plan-label">Review deck</p><p className="plan-figure">{review.due} <small>due now</small></p><p className="plan-note">{plural(review.inDeck,'question')} in the deck · {review.byStep.map((n,i)=>`${n} at ${INTERVAL_DAYS[i]}d`).join(', ')}</p></div>
  </section>
  <section className="panel" aria-labelledby="week-title"><div className="panel-head"><h2 id="week-title">This week</h2><span className="state">Reviews first, then new questions</span></div>
   <ol className="week-plan">{plan.days.map(d=><li key={d.date} className={d.today?'today':''}>
    <div className="week-day"><strong>{d.label}</strong>{d.paper&&<span className="app-tag">Timed paper</span>}</div>
    <div className="week-work"><span>{d.reviews?plural(d.reviews,'review'):'No reviews due'}</span><span>{d.newQuestions?`${plural(d.newQuestions,'new question')}`:d.reviews>=plan.dailyTarget?'Target met by reviews':'No new questions left'}</span>{d.focus&&<span>Focus: <strong>{d.focus.name}</strong></span>}{d.paper&&<span>One complete timed paper</span>}</div>
    {d.today&&<div className="week-go">{review.due>0&&<QuickStart examId={exam.id} pool="review" label="Start reviews" primary/>}{d.focus&&<QuickStart examId={exam.id} topicId={d.focus.id} label={`Practise ${d.focus.name}`} primary={review.due===0}/>}{!d.focus&&review.due===0&&plan.unseen>0&&<QuickStart examId={exam.id} pool="unanswered" label="New questions" primary/>}</div>}
   </li>)}</ol>
   {!plan.paperReady&&<p className="practice-help">Timed papers join the plan once Exam Mode timing is set for {exam.name}.</p>}</section>
  <section className="panel" aria-labelledby="how-title"><div className="panel-head"><h2 id="how-title">How reviews work</h2></div>
   <p className="practice-help">A question joins your review deck when you get it wrong, or get it right but mark it unsure or a guess. It comes back after {INTERVAL_DAYS.join(', ').replace(/, (\d+)$/,' and $1')} days. Each correct answer on or after the due day moves it on; a wrong answer starts it again at 1 day. Getting it right at 14 days takes it out of the deck.</p>
   <p className="practice-help"><a className="practice-link" href="/practice/plan/notes" download>Download your notes</a> (your own notes only, as a text file).</p></section>
 </div></StudentShell>;
}

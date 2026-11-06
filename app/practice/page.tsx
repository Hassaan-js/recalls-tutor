import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {SuspendedNotice} from '@/components/auth/suspended';
import {getDatabase} from '@/lib/db/client';
import {listPracticeExams,listRecentAttempts,listTrialOffers} from '@/lib/services/practice';
import {PracticeWays,QuickStart,TrialOffers} from '@/components/practice/start-form';
import {StudentShell} from '@/components/practice/shell';
import {studyPlan} from '@/lib/services/student';
import {reviewSummary} from '@/lib/services/review';
export const metadata={title:'Practice',robots:{index:false}};
export const dynamic='force-dynamic';
const date=(value:string)=>new Date(value).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
const plural=(n:number,one:string,many=`${one}s`)=>`${n} ${n===1?one:many}`;
// The student home answers one question first: "What should I practise next?"
export default async function PracticePage(props:PageProps<'/practice'>) {
 const actor=await getCurrentActor();
 if(!actor)redirect('/sign-in?next=/practice');if(!actor.emailVerified)redirect('/verify-email');
 if(actor.suspended)return <SuspendedNotice/>;
 const db=getDatabase();const query=await props.searchParams;
 const [exams,offers]=await Promise.all([listPracticeExams(db,actor.id),listTrialOffers(db,actor.id)]);
 const exam=exams.find(e=>e.id===query.exam)??exams[0];
 const [recent,plan,review]=exam?await Promise.all([listRecentAttempts(db,actor.id,exam.id),studyPlan(db,actor.id,exam.id),reviewSummary(db,actor.id,exam.id)]):[[],null,null];
 const shellExams=exams.map(e=>({id:e.id,name:e.name,access:e.access}));
 if(!exam)return <StudentShell active="practice" title="Practice" actor={actor}><div className="app-column">
  <h1>Choose an exam to start.</h1><p className="app-sub">{offers.length?'Try one free, with no card, or choose a plan.':'You don’t have access to an exam yet. Paid plans open soon.'}</p>
  {offers.length?<TrialOffers offers={offers}/>:<section className="sheet next"><div><h2>No exams are open to you yet.</h2><p>Plans include every reviewed question, complete papers and Exam Mode.</p></div><div className="next-action"><Link className="practice-button" href="/pricing">See plans</Link></div></section>}</div></StudentShell>;
 // The one next step, built from this student's own data, leads the screen as its only sheet.
 const live=recent.find(a=>!a.submitted&&a.mode==='exam'),open=recent.find(a=>!a.submitted&&a.mode!=='exam'),unanswered=Math.max(0,exam.published-exam.answered),trialLeft=exam.trial?exam.trial.limit-exam.trial.used:null;
 const accuracy=exam.answered?Math.round(100*exam.correct/exam.answered):null;
 const next=live?{title:'Your timed paper is still running.',text:`${live.paperTitle??'Timed exam'}: ${live.answered} of ${live.total} answered. The timer keeps running while you are away.`,action:<Link className="practice-button" href={`/practice/${live.id}`}>Return to your paper</Link>}
  :open?{title:'Pick up where you left off.',text:`Revision started ${date(open.startedAt)}: ${open.answered} of ${open.total} answered.`,action:<Link className="practice-button" href={`/practice/${open.id}`}>Continue revision</Link>}
  :review&&review.due>0?{title:`${plural(review.due,'question is','questions are')} due for review today.`,text:'Spaced repetition: each one comes back after 1, 3, 7 and 14 days until you know it.',action:<QuickStart examId={exam.id} pool="review" label="Start today’s review" primary/>}
  :exam.mistakes>0?{title:`${plural(exam.mistakes,'question is','questions are')} waiting in your mistakes deck.`,text:'Each one leaves the deck after you answer it correctly twice.',action:<QuickStart examId={exam.id} pool="mistakes" label="Practise your mistakes" primary/>}
  :exam.published===0?{title:`No questions are published in ${exam.name} yet.`,text:'Questions appear here as soon as the team has reviewed them.',action:null}
  :exam.answered===0?{title:`${plural(exam.published,'reviewed question')} ${exam.published===1?'is':'are'} ready for you.`,text:'Start with 20 in Revision Mode. You see the answer and the explanation after each one.',action:<QuickStart examId={exam.id} label="Start revision" primary/>}
  :unanswered>0?{title:`${plural(unanswered,'question')} ${unanswered===1?'is':'are'} still new to you.`,text:`You have tried ${exam.answered} of ${exam.published}. The next 20 come from the ones you have not seen.`,action:<QuickStart examId={exam.id} pool="unanswered" label="Practise new questions" primary/>}
  :{title:`You have answered every question in ${exam.name}.`,text:'Go round again: a second pass is where recall sticks.',action:<QuickStart examId={exam.id} label="Revise them all again" primary/>};
 const record=[exam.access==='trial'&&trialLeft!==null?`${plural(trialLeft,'trial question')} left until ${date(exam.endsAt)}`:`Access until ${date(exam.endsAt)}`,`${exam.answered} of ${exam.published} answered`,accuracy===null?null:`${accuracy}% correct`].filter(Boolean).join(' · ');
 return <StudentShell active="practice" title={exam.name} actor={actor} exams={shellExams} examId={exam.id}><div className="app-column">
  <div className="app-title"><div><h1>{exam.name}</h1><p className="app-sub">{record}</p></div></div>

  <section className="sheet next" aria-labelledby="next-title"><div><h2 id="next-title">{next.title}</h2><p>{next.text}</p></div>{next.action&&<div className="next-action">{next.action}</div>}</section>

  {plan&&<section className="panel plan-strip" aria-labelledby="plan-title"><h2 id="plan-title" className="sr-only">Your study plan</h2>
   <div className="plan-cell"><p className="plan-label">Exam date</p>{plan.daysLeft===null?<><p className="plan-figure plan-figure-quiet">Not set</p><Link className="practice-link" href="/account/profile">Add your exam date</Link></>
    :plan.daysLeft>0?<><p className="plan-figure">{plural(plan.daysLeft,'day')} <small>to go</small></p><p className="plan-note">{new Date(plan.examDate!).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'})}</p></>
    :plan.daysLeft===0?<><p className="plan-figure">Exam day</p><p className="plan-note">Good luck. Light revision only.</p></>
    :<><p className="plan-figure plan-figure-quiet">Date passed</p><Link className="practice-link" href="/account/profile">Update your exam date</Link></>}</div>
   <div className="plan-cell"><p className="plan-label">Today</p><p className="plan-figure">{plan.answeredToday}{plan.dailyTarget?<small> of {plan.dailyTarget}</small>:null} <small>answered</small></p>
    {plan.dailyTarget?<span className="track" role="img" aria-label={`${plan.answeredToday} of ${plan.dailyTarget} answered today`}><span className="fill" style={{width:`${Math.min(100,Math.round(100*plan.answeredToday/plan.dailyTarget))}%`}}/></span>:<Link className="practice-link" href="/account/profile">Set a daily target</Link>}
    {plan.dailyTarget&&plan.answeredToday>=plan.dailyTarget?<p className="plan-note">Target reached for today.</p>:null}<Link className="practice-link" href={`/practice/plan?exam=${exam.id}`}>See your week</Link></div>
   <div className="plan-cell plan-weak"><p className="plan-label">Weakest topics</p>{plan.weakest.length?<ul>{plan.weakest.map(w=><li key={w.id}><span><strong>{w.topic}</strong> <small>{w.correct} of {w.total} correct</small></span><QuickStart examId={exam.id} topicId={w.id} label="Practise"/></li>)}</ul>
    :<p className="plan-note">Your three weakest topics show here once you have missed a tagged question.</p>}</div>
  </section>}

  <section className="panel" aria-labelledby="ways-title"><div className="panel-head"><h2 id="ways-title">Other ways to practise</h2></div><PracticeWays exam={exam} exams={[exam,...exams.filter(e=>e.id!==exam.id)]}/></section>

  <div className="grid12">
   <section className="panel span6" aria-labelledby="coverage-title"><div className="panel-head"><h2 id="coverage-title">Sittings covered<span className="count">{exam.coverage.length}</span></h2><span className="state">Answered of published</span></div>
    {exam.coverage.length?<ul className="coverage">{exam.coverage.map(c=><li key={c.id}><span>{c.label}</span><span className="track" role="img" aria-label={`${c.answered} of ${c.total} answered`}><span className="fill" style={{width:`${c.total?Math.round(100*c.answered/c.total):0}%`}}/></span><span className="n"><b>{c.answered}</b> / {c.total}</span></li>)}</ul>
     :<p className="empty">Sittings appear here once questions are tagged with the sittings they were recalled in.</p>}</section>
   <section className="panel span6" id="recent" aria-labelledby="recent-title"><div className="panel-head"><h2 id="recent-title">Recent sessions</h2>{recent.length>0&&<Link className="state" href={`/practice/history?exam=${exam.id}`}>All sessions</Link>}</div>
    {recent.length?<ul className="rows">{recent.slice(0,6).map(a=>{const pct=a.answered?Math.round(100*a.correct/(a.mode==='exam'?a.total:a.answered)):null;return <li key={a.id}><Link className="rowcard" href={a.submitted?`/practice/${a.id}/results`:`/practice/${a.id}`}>
     <span className="main"><strong>{a.paperTitle??(a.mode==='exam'?(a.access==='trial'?'Mini mock':'Timed exam'):'Revision')}</strong><span>{date(a.startedAt)} · {a.answered} of {a.total} answered</span></span>
     <span className={a.submitted?'num':'num is-open'}>{a.submitted?(pct===null?'—':`${pct}%`):'Continue'}</span></Link></li>;})}</ul>:<p className="empty">Your sessions and scores will appear here.</p>}</section>
  </div>

  {offers.length>0&&<TrialOffers offers={offers}/>}
 </div></StudentShell>;
}

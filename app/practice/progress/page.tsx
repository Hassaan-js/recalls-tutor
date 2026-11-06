import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {SuspendedNotice} from '@/components/auth/suspended';
import {getDatabase} from '@/lib/db/client';
import {listPracticeExams} from '@/lib/services/practice';
import {getProgress,type Progress} from '@/lib/services/analytics';
import {StudentShell} from '@/components/practice/shell';
import {QuickStart} from '@/components/practice/start-form';
export const metadata={title:'Progress',robots:{index:false}};
export const dynamic='force-dynamic';
const pct=(c:number,n:number)=>n?Math.round(100*c/n):null;
const secs=(ms:number|null)=>{if(ms===null)return "—";const s=Math.round(ms/1000);return s>=60?`${Math.floor(s/60)} min${s%60?` ${s%60} s`:""}`:`${s} s`;};
const week=(d:string)=>new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
// One teal ramp for accuracy (sequential, light to dark); text switches to white on the two darkest steps.
const RAMP=['#f0fdfa','#ccfbf1','#99f6e4','#5eead4','#14b8a6','#0f766e'];
const shade=(p:number|null)=>p===null?null:RAMP[Math.min(RAMP.length-1,Math.floor(p/(100/RAMP.length)))];
function Cell({c,n}:{c:number;n:number}) {
 const p=pct(c,n),bg=shade(p);
 return <td className="heat-cell" style={bg?{background:bg,color:p!>=67?'#fff':'var(--ink)'}:undefined} title={n?`${c} of ${n} correct`:'Not answered'}>{p===null?'—':`${p}%`}<small>{n?`${n}`:''}</small></td>;
}
// Weekly accuracy, one bar per week; an empty week keeps its slot so the time axis stays honest.
function Trend({weeks,passMark}:{weeks:Progress['weeks'];passMark:number|null}) {
 const W=640,H=200,pad={l:62,r:8,t:14,b:40},bw=(W-pad.l-pad.r)/weeks.length;
 const y=(v:number)=>pad.t+(H-pad.t-pad.b)*(1-v/100);
 return <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Weekly accuracy for the last ${weeks.length} weeks`}>
  {[0,50,100].map(v=><g key={v}><line x1={pad.l} x2={W-pad.r} y1={y(v)} y2={y(v)} className="trend-grid"/><text x={pad.l-6} y={y(v)+4} className="trend-axis" textAnchor="end">{v}%</text></g>)}
  {passMark!==null&&<g><line x1={pad.l} x2={W-pad.r} y1={y(passMark)} y2={y(passMark)} className="trend-pass"/><text x={pad.l+4} y={y(passMark)-5} className="trend-axis" textAnchor="start">Pass mark {passMark}%</text></g>}
  {weeks.map((w,i)=>{const p=pct(w.correct,w.answered),width=Math.min(18,bw*0.4),x=pad.l+i*bw+(bw-width)/2;
   return <g key={w.start} className="trend-bar"><title>{`Week of ${week(w.start)}: ${w.answered?`${p}% correct, ${w.correct} of ${w.answered}`:'no answers'}`}</title>
    <rect x={pad.l+i*bw} y={pad.t} width={bw} height={H-pad.t-pad.b} fill="transparent"/>
    {p!==null&&<rect x={x} y={y(p)} width={width} height={Math.max(2,y(0)-y(p))} rx={4} className="trend-fill"/>}
    {(i===0||i===weeks.length-1||i%3===0)&&<text x={pad.l+i*bw+bw/2} y={H-8} className="trend-axis" textAnchor="middle">{week(w.start)}</text>}</g>;})}
 </svg>;
}
export default async function ProgressPage(props:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const actor=await getCurrentActor();
 if(!actor)redirect('/sign-in?next=/practice/progress');if(!actor.emailVerified)redirect('/verify-email');
 if(actor.suspended)return <SuspendedNotice/>;
 const db=getDatabase();const query=await props.searchParams;
 const exams=await listPracticeExams(db,actor.id);
 const exam=exams.find(e=>e.id===query.exam)??exams[0];
 const shellExams=exams.map(e=>({id:e.id,name:e.name,access:e.access}));
 const tabs=<nav className="view-tabs" aria-label="Results views"><Link href={`/practice/history${exam?`?exam=${exam.id}`:''}`}>Sessions</Link><Link href={`/practice/progress${exam?`?exam=${exam.id}`:''}`} aria-current="page">Progress</Link><Link href={`/practice/predictor${exam?`?exam=${exam.id}`:''}`}>Pass Predictor</Link></nav>;
 if(!exam)return <StudentShell active="progress" title="Progress" actor={actor}><div className="app-column"><div className="app-title"><div><h1>Progress</h1><p className="app-sub">Your progress appears here once you have access to an exam.</p></div></div><Link className="practice-button" href="/practice">Go to practice</Link></div></StudentShell>;
 const p=(await getProgress(db,actor.id,exam.id))!;
 const r=p.readiness,recent=pct(r.recentCorrect,r.recentAnswered),coverage=pct(r.tried,p.published);
 const enough=r.recentAnswered>=20;
 const verdict=!enough?`Answer ${20-r.recentAnswered} more ${20-r.recentAnswered===1?'question':'questions'} for a reliable picture.`
  :r.passMark===null?`${recent}% of your last ${r.recentAnswered} answers were correct.`
  :recent!>=r.passMark+5?`Your recent answers are above the ${r.passMark}% pass mark.`
  :recent!>=r.passMark-5?`Your recent answers are close to the ${r.passMark}% pass mark.`
  :`Your recent answers are below the ${r.passMark}% pass mark for now.`;
 const hy=pct(p.highYield.hy.correct,p.highYield.hy.answered),other=pct(p.highYield.other.correct,p.highYield.other.answered);
 const weakest=[...p.topics].filter(t=>t.answered>0&&t.correct<t.answered).sort((a,b)=>a.correct/a.answered-b.correct/b.answered)[0];
 const anyWeek=p.weeks.some(w=>w.answered);
 return <StudentShell active="progress" title="Progress" actor={actor} exams={shellExams} examId={exam.id}><div className="app-column">
  <div className="app-title"><div><h1>Progress in {exam.name}</h1><p className="app-sub">{r.tried} of {p.published} questions tried{coverage!==null?` (${coverage}%)`:''}. Figures count answers once you have seen their feedback.</p></div>{tabs}</div>

  <section className="sheet readiness" aria-labelledby="ready-title"><div><h2 id="ready-title">{verdict}</h2>
   <p>A guide from your own answers, not a prediction of your exam result.{coverage!==null&&coverage<50?' Trying more of the bank makes it more reliable.':''}</p></div>
   <dl className="ready-figures"><div><dt>Last {r.recentAnswered||100} answers</dt><dd>{recent===null?'—':`${recent}%`}</dd></div><div><dt>Bank tried</dt><dd>{coverage===null?'—':`${coverage}%`}</dd></div><div><dt>Pass mark</dt><dd>{r.passMark===null?'Not set':`${r.passMark}%`}</dd></div></dl>
   {weakest&&<div className="next-action"><QuickStart examId={exam.id} topicId={weakest.id} label={`Practise ${weakest.topic}`} primary/></div>}</section>

  <section className="panel" aria-labelledby="trend-title"><div className="panel-head"><h2 id="trend-title">Score trend</h2><span className="state">Correct answers per week, last 12 weeks</span></div>
   {anyWeek?<><Trend weeks={p.weeks} passMark={r.passMark}/><details className="chart-table"><summary>Show as a table</summary><table className="history-table"><thead><tr><th scope="col">Week of</th><th scope="col">Answered</th><th scope="col">Correct</th></tr></thead><tbody>{p.weeks.filter(w=>w.answered).map(w=><tr key={w.start}><td>{week(w.start)}</td><td>{w.answered}</td><td>{pct(w.correct,w.answered)}%</td></tr>)}</tbody></table></details></>
    :<p className="empty">Your weekly score shows here after your first answers.</p>}</section>

  <section className="panel" aria-labelledby="heat-title"><div className="panel-head"><h2 id="heat-title">Topics</h2><span className="state">Share correct; the small number is how many you answered</span></div>
   {p.topics.length?<><table className="heat"><thead><tr><th scope="col">Topic</th><th scope="col">All time</th><th scope="col">Last 30 days</th></tr></thead><tbody>
    {p.topics.map(t=><tr key={t.id}><th scope="row">{t.topic}</th><Cell c={t.correct} n={t.answered}/><Cell c={t.recentCorrect} n={t.recentAnswered}/></tr>)}</tbody></table>
    <p className="heat-key" aria-hidden="true">0%{RAMP.map(c=><i key={c} style={{background:c}}/>)}100%</p></>
    :<p className="empty">Topics appear once you answer questions that are tagged with a topic.</p>}</section>

  <div className="grid12">
   <section className="panel span6" aria-labelledby="hy-title"><div className="panel-head"><h2 id="hy-title">High-yield questions</h2><span className="state">Recalled in {p.highYield.min}+ sittings</span></div>
    <ul className="compare">{[['High-yield',hy,p.highYield.hy],['Other questions',other,p.highYield.other]].map(([label,v,s])=>{const x=s as {answered:number;correct:number};return <li key={label as string}><span>{label as string}</span><span className="track" role="img" aria-label={`${label}: ${v===null?'not answered':`${v}% correct`}`}><span className="fill" style={{width:`${v??0}%`}}/></span><span className="n">{v===null?'—':`${v}%`} <small>{x.answered?`of ${x.answered}`:''}</small></span></li>;})}</ul>
    <p className="practice-help">{hy!==null&&other!==null?hy<other?'You do less well on high-yield questions. They come up most often, so they are worth a sprint.':'You do as well or better on high-yield questions.':'Answer some of each to compare.'}</p></section>
   <section className="panel span6" aria-labelledby="pace-title"><div className="panel-head"><h2 id="pace-title">Time per question</h2><span className="state">Average, answered questions</span></div>
    <dl className="ready-figures pace"><div><dt>Revision</dt><dd>{secs(p.pace.revisionMs)}</dd></div><div><dt>Timed exams</dt><dd>{secs(p.pace.examMs)}</dd></div><div><dt>Real exam pace</dt><dd>{p.pace.examPaceMs===null?'Not set':secs(p.pace.examPaceMs)}</dd></div></dl>
    <p className="practice-help">{p.pace.examPaceMs===null?'The real exam pace shows once the exam timing is configured.':p.pace.examMs===null?'Sit a timed exam to compare your pace with the real one.':p.pace.examMs>p.pace.examPaceMs?'You are slower than the real exam pace in timed exams.':'You are within the real exam pace in timed exams.'}</p></section>
  </div>
 </div></StudentShell>;
}

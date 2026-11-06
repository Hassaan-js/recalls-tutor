import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {SuspendedNotice} from '@/components/auth/suspended';
import {getDatabase} from '@/lib/db/client';
import {listPracticeExams} from '@/lib/services/practice';
import {BAND_LABEL,DISCLAIMER,UNLOCK,WEIGHTS,getPrediction,outcomePrompt,type Prediction} from '@/lib/services/predictor';
import {StudentShell} from '@/components/practice/shell';
import {QuickStart} from '@/components/practice/start-form';
import {OutcomeForm} from '@/components/practice/outcome-form';
export const metadata={title:'Pass Predictor',robots:{index:false}};
export const dynamic='force-dynamic';
const day=(d:string)=>new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
const BAND_TEXT:Record<string,string>={very_likely:'Your predicted range sits well above the pass mark.',likely:'Your whole predicted range is at or above the pass mark.',borderline:'Your predicted range crosses the pass mark.',low:'Your predicted range is below the pass mark for now.'};
// PP-1: the predicted range on a 0–100 scale with the pass mark marked, so the band is visible, not just named.
function RangeBar({e,passMark}:{e:NonNullable<Prediction['estimate']>;passMark:number|null}) {
 const W=640,H=64,x=(v:number)=>12+(W-24)*v/100;
 return <svg className="predict-range" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Predicted score ${e.low.toFixed(0)}% to ${e.high.toFixed(0)}%, most likely ${e.score.toFixed(0)}%${passMark!==null?`; pass mark ${passMark}%`:''}`}>
  <rect x={x(0)} y={26} width={x(100)-x(0)} height={8} rx={4} className="pr-track"/>
  <rect x={x(e.low)} y={20} width={Math.max(4,x(e.high)-x(e.low))} height={20} rx={4} className="pr-band"/>
  <circle cx={x(e.score)} cy={30} r={7} className="pr-dot"/>
  {passMark!==null&&<g><line x1={x(passMark)} x2={x(passMark)} y1={10} y2={50} className="pr-pass"/><text x={x(passMark)} y={62} textAnchor="middle" className="pr-axis">Pass mark {passMark}%</text></g>}
  {[0,100].map(v=><text key={v} x={x(v)} y={62} textAnchor={v?'end':'start'} className="pr-axis">{v}%</text>)}
 </svg>;
}
function Trend({trend,passMark}:{trend:Prediction['trend'];passMark:number|null}) {
 const W=640,H=150,pad={l:44,r:16,t:14,b:30},pts=trend.map((t,i)=>({...t,x:pad.l+i*(W-pad.l-pad.r)/(trend.length-1)}));
 const y=(v:number)=>pad.t+(H-pad.t-pad.b)*(1-v/100);const known=pts.filter(p=>p.score!==null);
 return <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Predicted score over the last four weeks: ${trend.map(t=>t.score===null?'not enough data':`${t.score.toFixed(0)}%`).join(', ')}`}>
  {[0,50,100].map(v=><g key={v}><line x1={pad.l} x2={W-pad.r} y1={y(v)} y2={y(v)} className="trend-grid"/><text x={pad.l-6} y={y(v)+4} className="trend-axis" textAnchor="end">{v}%</text></g>)}
  {passMark!==null&&<line x1={pad.l} x2={W-pad.r} y1={y(passMark)} y2={y(passMark)} className="trend-pass"/>}
  {known.length>1&&<polyline points={known.map(p=>`${p.x},${y(p.score!)}`).join(' ')} className="pr-line"/>}
  {pts.map(p=><g key={p.weekOf}>{p.score!==null&&<circle cx={p.x} cy={y(p.score)} r={5} className="pr-dot"><title>{`${day(p.weekOf)}: ${p.score.toFixed(0)}%`}</title></circle>}
   <text x={p.x} y={H-8} className="trend-axis" textAnchor="middle">{p===pts.at(-1)?'Today':day(p.weekOf)}</text></g>)}
 </svg>;
}
export default async function PredictorPage(props:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const actor=await getCurrentActor();
 if(!actor)redirect('/sign-in?next=/practice/predictor');if(!actor.emailVerified)redirect('/verify-email');
 if(actor.suspended)return <SuspendedNotice/>;
 const db=getDatabase();const query=await props.searchParams;
 const exams=await listPracticeExams(db,actor.id);
 const exam=exams.find(e=>e.id===query.exam)??exams[0];
 const q=exam?`?exam=${exam.id}`:'';
 const tabs=<nav className="view-tabs" aria-label="Results views"><Link href={`/practice/history${q}`}>Sessions</Link><Link href={`/practice/progress${q}`}>Progress</Link><Link href={`/practice/predictor${q}`} aria-current="page">Pass Predictor</Link></nav>;
 if(!exam)return <StudentShell active="progress" title="Pass Predictor" actor={actor}><div className="app-column"><div className="app-title"><div><h1>Pass Predictor</h1><p className="app-sub">The Pass Predictor appears once you have access to an exam.</p></div></div><Link className="practice-button" href="/practice">Go to practice</Link></div></StudentShell>;
 const [p,ask]=await Promise.all([getPrediction(db,actor.id,exam.id),outcomePrompt(db,actor.id,exam.id)]);
 const [profile]=ask?await db.query<{date:string}>('SELECT exam_date::text AS date FROM student_profiles WHERE user_id=$1',[actor.id]):[];
 const shellExams=exams.map(e=>({id:e.id,name:e.name,access:e.access}));
 const e=p!.estimate;
 return <StudentShell active="progress" title="Pass Predictor" actor={actor} exams={shellExams} examId={exam.id}><div className="app-column">
  <div className="app-title"><div><h1>Pass Predictor for {exam.name}</h1><p className="app-sub">{DISCLAIMER}</p></div>{tabs}</div>
  {ask&&profile&&<section className="sheet outcome" aria-label="Your exam result"><OutcomeForm examId={exam.id} examName={exam.name} examDate={profile.date}/></section>}
  {!p!.unlocked?<section className="sheet predict-locked" aria-labelledby="locked-title">
    <h2 id="locked-title">{p!.trial?'Available with a plan':'Unlocks after more practice'}</h2>
    <p>{p!.trial?`During the free trial you can see how the Pass Predictor works. It unlocks with a plan, after one complete timed paper and ${UNLOCK.answered} answered questions.`:`The predictor needs one complete Exam Mode paper and at least ${UNLOCK.answered} answered questions, so the estimate rests on enough of your own answers.`}</p>
    <ul className="predict-steps">
     <li className={p!.progress.papers>=UNLOCK.papers?'done':''}><strong>{Math.min(p!.progress.papers,UNLOCK.papers)} of {UNLOCK.papers}</strong> complete timed paper</li>
     <li className={p!.progress.answered>=UNLOCK.answered?'done':''}><strong>{Math.min(p!.progress.answered,UNLOCK.answered)} of {UNLOCK.answered}</strong> answered questions<span className="track" aria-hidden="true"><span className="fill" style={{width:`${Math.min(100,100*p!.progress.answered/UNLOCK.answered)}%`}}/></span></li>
    </ul>
    {p!.trial?<Link className="practice-button" href="/account/plans">See plans</Link>:<Link className="practice-button" href={`/practice${q}`}>Keep practising</Link>}
   </section>
  :e?<>
   <section className="sheet predict-head" aria-labelledby="band-title">
    <div><p className="predict-kicker">Likelihood</p><h2 id="band-title" className={`band band-${e.band??'none'}`}>{e.band?BAND_LABEL[e.band]:'No pass mark yet'}</h2>
     <p>{e.band?BAND_TEXT[e.band]:`The pass mark for ${exam.name} isn’t published here yet, so there is no band. Your predicted score is shown on its own.`}</p></div>
    <dl className="ready-figures"><div><dt>Predicted score</dt><dd>{e.low.toFixed(0)}–{e.high.toFixed(0)}%</dd></div><div><dt>Most likely</dt><dd>{e.score.toFixed(0)}%</dd></div><div><dt>Pass mark</dt><dd>{p!.passMark===null?'Not set':`${p!.passMark}%`}</dd></div></dl>
    <div className="predict-bar"><RangeBar e={e} passMark={p!.passMark}/></div>
   </section>
   <div className="grid12">
    <section className="panel span6" aria-labelledby="trend-title"><div className="panel-head"><h2 id="trend-title">Last 4 weeks</h2><span className="state">Predicted score at the end of each week</span></div>
     <Trend trend={p!.trend} passMark={p!.passMark}/>
     <details className="chart-table"><summary>Show as a table</summary><table className="history-table"><thead><tr><th scope="col">Week</th><th scope="col">Predicted score</th></tr></thead><tbody>{p!.trend.map(t=><tr key={t.weekOf}><td>{day(t.weekOf)}</td><td>{t.score===null?'Not enough data yet':`${t.score.toFixed(0)}%`}</td></tr>)}</tbody></table></details></section>
    <section className="panel span6" aria-labelledby="target-title"><div className="panel-head"><h2 id="target-title">To reach “Likely”</h2></div>
     {p!.daily===null?<p className="practice-help">A daily target appears once the pass mark is set.</p>
      :!p!.daily.toLikely?<p className="practice-help">You are already in the “Likely” range or above. Keep your accuracy steady with a mixed set each day.</p>
      :<><p className="predict-big">+{p!.daily.toLikely.toFixed(0)} <small>points needed</small></p>
       {p!.daily.questionsPerDay!==null&&<p className="practice-help">About <strong>{p!.daily.questionsPerDay} questions a day</strong> {p!.daily.examDate?`until your exam on ${new Date(p!.daily.examDate).toLocaleDateString('en-GB',{day:'numeric',month:'long',timeZone:'UTC'})}`:'for four weeks'} works through the questions you haven’t got right yet in the topics below.{p!.daily.examDate?'':' Add your exam date in your profile for a target to your exam day.'}</p>}</>}
    </section>
   </div>
   <section className="panel" aria-labelledby="topics-title"><div className="panel-head"><h2 id="topics-title">Best use of your study time</h2><span className="state">Top 3 topics by marks gained per hour</span></div>
    {p!.topics.length?<ol className="predict-topics">{p!.topics.map(t=><li key={t.id}><div><strong>{t.name}</strong><span>{t.accuracy===null?'Not tried yet':`${t.accuracy}% correct`} · {t.remaining} question{t.remaining===1?'':'s'} to get right · about {t.hours<1?`${Math.max(5,Math.round(t.hours*60))} minutes`:`${t.hours.toFixed(1)} hours`}</span></div>
     <span className="predict-gain">{t.gainPerHour.toFixed(1)} <small>points / hour</small></span><QuickStart examId={exam.id} topicId={t.id} label="Practise"/></li>)}</ol>
     :<p className="practice-help">You have answered every question correctly at least once. Mixed timed papers are the best next step.</p>}</section>
   <section className="panel" aria-labelledby="how-title"><details className="predict-how"><summary><h2 id="how-title">How this is worked out</h2></summary>
    <p>The estimate is a weighted average of your own answers. Parts with too little data are left out and the other weights scaled up.</p>
    <table className="history-table"><thead><tr><th scope="col">Part</th><th scope="col">Your figure</th><th scope="col">Weight</th></tr></thead><tbody>
     {e.parts.map(x=><tr key={x.label}><td>{x.label}</td><td>{x.value===null?'Not enough answers yet':`${x.value.toFixed(0)}%`}</td><td>{Math.round(x.weight*100)}%</td></tr>)}
     {e.adjustments.map(a=><tr key={a.label}><td>{a.label}</td><td>{a.points} points</td><td>—</td></tr>)}</tbody></table>
    <p>The range is ±{(e.score-e.low).toFixed(0)} points{e.spreadReasons.length?`, wider because ${e.spreadReasons.join(', ')}`:''}. Bands: <em>Very likely</em> when the whole range is 5 or more points above the pass mark, <em>Likely</em> when it is all at or above it, <em>Borderline</em> when it crosses it, and <em>Low</em> when it is all below.</p>
    <p>Only first attempts count for accuracy, so repeating questions you have seen doesn’t inflate it. Weights: papers {WEIGHTS.papers*100}%, first attempts {WEIGHTS.firstAttempt*100}%, high-yield {WEIGHTS.highYield*100}%, latest sitting {WEIGHTS.latestSitting*100}%. This is the first version; it will be checked against real exam results as students report them.</p>
    <p className="predict-disclaimer">{DISCLAIMER}</p></details></section>
  </>:<section className="sheet"><p>Complete a timed paper to see your estimate.</p></section>}
 </div></StudentShell>;
}

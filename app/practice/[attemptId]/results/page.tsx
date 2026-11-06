import Link from 'next/link';
import {paperPercentile} from '@/lib/services/percentile';
const ordinal=(n:number)=>n%100>=11&&n%100<=13?'th':({1:'st',2:'nd',3:'rd'} as Record<number,string>)[n%10]??'th';
import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {SuspendedNotice} from '@/components/auth/suspended';
import {getDatabase} from '@/lib/db/client';
import {getResults} from '@/lib/services/practice';
import {StudentShell} from '@/components/practice/shell';
import {QuickStart} from '@/components/practice/start-form';
export const metadata={title:'Practice results',robots:{index:false}};
export const dynamic='force-dynamic';
const CONFIDENCE={sure:'Sure',unsure:'Unsure',guess:'Guess'};
const duration=(ms:number)=>{const s=Math.round(ms/1000);return s<60?`${s} s`:`${Math.floor(s/60)} min ${String(s%60).padStart(2,'0')} s`;};
// The report answers "How did I do, and what should I practise next?"
export default async function ResultsPage(props:PageProps<'/practice/[attemptId]/results'>) {
 const actor=await getCurrentActor();
 if(!actor)redirect('/sign-in');if(!actor.emailVerified)redirect('/verify-email');
 if(actor.suspended)return <SuspendedNotice/>;
 const {attemptId}=await props.params;
 const results=await getResults(getDatabase(),actor.id,attemptId).catch((error:Error)=>error.message.startsWith('Finish')?'unfinished':null);
 if(results==='unfinished')redirect(`/practice/${attemptId}`);
 if(!results)return <StudentShell active="results" title="Results" actor={actor}><div className="app-column"><div className="app-title"><div><h1>Results not found.</h1></div><Link className="practice-button" href="/practice">Back to practice</Link></div></div></StudentShell>;
 const label=results.paperTitle??(results.mode==='exam'?(results.access==='trial'?'trial mini mock':'timed exam'):'revision session');
 const wrong=results.items.filter(i=>i.answered&&!i.correct&&!i.withdrawn).length,unanswered=results.items.filter(i=>!i.answered&&!i.withdrawn).length;
 const weakest=results.topics.find(t=>t.topic!=='Untagged'&&t.correct<t.total);
 const finding=results.passed!==null?`${results.passed?'At or above':'Below'} the ${results.passMark}% pass mark.`:weakest?`Weakest topic: ${weakest.topic}, ${weakest.correct} of ${weakest.total} correct.`:wrong?`${wrong} wrong answer${wrong===1?'':'s'} added to your mistakes deck.`:results.scored?'Every scored answer was correct.':'No answers were scored in this session.';
 const average=results.answered?results.timeMs/results.answered:0;
 const rank=await paperPercentile(getDatabase(),actor.id,attemptId);
 return <StudentShell active="results" title="Results" actor={actor} examId={results.examId}><div className="app-column">
  <div className="app-title"><div><h1>{results.percent}% on your {label}</h1><p className="app-sub">{results.examName} · {finding}</p></div>
   {wrong>0?<QuickStart examId={results.examId} pool="mistakes" label="Practise your mistakes" primary/>:<Link className="practice-button" href={`/practice?exam=${results.examId}`}>Start another session</Link>}</div>
  <section className="sheet scorecard" aria-label="Score">
   <div><span className="value">{results.correct}<small> of {results.scored}</small></span><span className="label">correct</span><span className="caption">{results.mode==='exam'?'Unanswered questions count as wrong':'Only answered questions are scored'}</span></div>
   <div><span className="value">{results.answered}<small> of {results.items.length}</small></span><span className="label">answered</span><span className="caption">{unanswered?`${unanswered} left blank`:'None left blank'}</span></div>
   <div><span className="value">{duration(results.timeMs)}</span><span className="label">on the clock</span><span className="caption">Total time on answered questions</span></div>
   <div><span className="value">{results.answered?duration(average):'—'}</span><span className="label">per question</span><span className="caption">Average for answered questions</span></div>
   {rank&&<div><span className="value">{rank.available?<>{rank.percentile}<small>{ordinal(rank.percentile)}</small></>:'—'}</span><span className="label">percentile</span><span className="caption">{rank.available?`Among ${rank.peers} students on this paper; median ${rank.median}%`:`Shown once ${rank.needed} students have sat this paper (${rank.peers} so far)`}</span></div>}
  </section>
  <div className="grid12">
   <section className="panel span8" aria-labelledby="topics-title"><div className="panel-head"><h2 id="topics-title">By topic<span className="count">{results.topics.length}</span></h2><span className="state">Weakest first</span></div>
    {results.topics.some(t=>t.topic!=='Untagged')?<ul className="topic-bars">{[...results.topics].sort((a,b)=>Number(a.topic==='Untagged')-Number(b.topic==='Untagged')).map(t=><li key={t.topic}><span>{t.topic}</span><span className="track" role="img" aria-label={`${t.correct} of ${t.total} correct`}><span className="fill" style={{width:`${Math.round(100*t.correct/t.total)}%`}}/></span><span className="n">{t.correct} / {t.total}</span></li>)}</ul>
     :<p className="empty">The topic breakdown appears once questions are tagged with topics.</p>}</section>
   <section className="panel span4" aria-labelledby="next-title"><div className="panel-head"><h2 id="next-title">Next</h2></div>
    <ul className="facts"><li><strong>Mistakes deck</strong><span>{wrong?`${wrong} question${wrong===1?'':'s'} from this session join it until you answer each correctly twice.`:'Nothing new from this session.'}</span></li>
     <li><strong>Review every answer</strong><span>Open a question below to see the explanation and key notes.</span></li></ul>
    <div className="practice-shortcuts" style={{marginTop:14}}><Link className="practice-ghost" href={`/practice?exam=${results.examId}`}>Back to practice</Link></div></section>
  </div>
  <div className="grid12"><section className="panel span12" aria-labelledby="review-title"><div className="panel-head"><h2 id="review-title">Review<span className="count">{results.items.length}</span></h2></div>
   <table className="review-table"><thead><tr><th scope="col">Question</th><th scope="col">Result</th><th scope="col">Topic</th><th scope="col">Confidence</th><th scope="col" className="num">Time</th></tr></thead>
    <tbody>{results.items.map(i=><tr key={i.position}><td><Link href={`/practice/${results.id}?q=${i.position}`}>Question {i.position}</Link>{i.flagged&&<span className="state"> · flagged</span>}</td>
     {i.answered&&!i.withdrawn?<><td className={i.correct?'is-correct':'is-wrong'}>{i.correct?'Correct':'Incorrect'}</td><td>{i.topic??'Untagged'}</td><td>{i.confidence?CONFIDENCE[i.confidence]:'Not given'}</td><td className="num">{duration(i.timeMs)}</td></>
      :<td colSpan={4} className="is-blank">{i.withdrawn?'Withdrawn, not scored':'Not answered'}{i.topic?` · ${i.topic}`:''}</td>}</tr>)}</tbody></table></section></div>
 </div></StudentShell>;
}

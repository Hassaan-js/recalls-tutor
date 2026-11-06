'use client';
import {useActionState,useEffect,useState,useTransition} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {beginTrial,startPaper,startPractice} from '@/app/practice/actions';
import type {PracticeExam,TrialOffer} from '@/lib/services/practice';
export function StartPractice({exams}:{exams:PracticeExam[]}){
 const[state,action,pending]=useActionState(startPractice,{});const[requestId,setRequestId]=useState('');const[mode,setMode]=useState('revision');const[examId,setExamId]=useState(exams[0]?.id??'');const router=useRouter();
 const exam=exams.find(e=>e.id===examId)??exams[0];const trial=exam?.access==='trial';
 useEffect(()=>setRequestId(crypto.randomUUID()),[]);
 useEffect(()=>{if(state.attemptId)router.push(`/practice/${state.attemptId}`);else if(state.error)setRequestId(crypto.randomUUID());},[state,router]);
 return <form action={action} className="practice-start"><input type="hidden" name="requestId" value={requestId}/>
  <label className="practice-field">Exam<select name="examId" required value={examId} onChange={e=>setExamId(e.target.value)}>{exams.map(e=><option key={e.id} value={e.id}>{e.name}{e.access==='trial'?' · free trial':''} · {e.published} questions</option>)}</select></label>
  {trial&&exam.trial&&<p className="practice-feedback">Free trial: {exam.trial.limit-exam.trial.used} of {exam.trial.limit} questions left, until {new Date(exam.endsAt).toLocaleDateString('en-GB',{day:'numeric',month:'long'})}. Trial questions come from earlier sittings.</p>}
  <fieldset className="practice-choice"><legend>Mode</legend>
   <label><input type="radio" name="mode" value="revision" checked={mode==='revision'} onChange={()=>setMode('revision')}/><span><strong>Revision</strong> Instant feedback after each answer.</span></label>
   {(!trial||exam.trial?.mockAvailable)&&<label><input type="radio" name="mode" value="exam" checked={mode==='exam'} onChange={()=>setMode('exam')}/><span><strong>{trial?'Mini mock':'Exam'}</strong> {trial?'A single timed mock included in your trial.':'Timed at the real exam pace. Results after you submit.'}{!exam?.examReady&&' Not available until the exam timing is configured.'}</span></label>}
  </fieldset>
  <label className="practice-field">Questions from<select name="pool" defaultValue="all"><option value="all">All available questions</option><option value="unanswered">Questions I have not answered</option><option value="mistakes">My mistakes deck ({exam?.mistakes??0})</option></select></label>
  {!(trial&&mode==='exam')&&<label className="practice-field">Number of questions<input name="count" type="number" min={1} max={100} defaultValue={20} required/></label>}
  {trial&&mode==='exam'&&<input type="hidden" name="count" value="1"/>}
  {exam&&<details className="practice-filters" key={exam.id}><summary>Narrow it down <small>topics, sittings, difficulty, bookmarks</small></summary>
   {exam.topics.length>0&&<fieldset><legend>Topics</legend><div className="practice-checks">{exam.topics.map(t=><label key={t.id}><input type="checkbox" name="topicIds" value={t.id}/>{t.label}</label>)}</div></fieldset>}
   {exam.sittings.length>0&&<fieldset><legend>Sittings (year and diet)</legend><div className="practice-checks">{exam.sittings.map(s=><label key={s.id}><input type="checkbox" name="sittingIds" value={s.id}/>{s.label} <small>{s.questions}</small></label>)}</div></fieldset>}
   <fieldset><legend>Difficulty</legend><div className="practice-checks">{['easy','medium','hard'].map(d=><label key={d}><input type="checkbox" name="difficulties" value={d}/>{d[0].toUpperCase()+d.slice(1)}</label>)}</div></fieldset>
   <fieldset><legend>Focus</legend><div className="practice-checks"><label><input type="checkbox" name="highYield" value="true"/>High-yield only (seen in {exam.highYieldMin}+ sittings)</label><label><input type="checkbox" name="latestSitting" value="true"/>Latest sitting only</label><label><input type="checkbox" name="bookmarked" value="true"/>Bookmarked by me</label><label><input type="checkbox" name="flagged" value="true"/>Flagged for review</label></div></fieldset>
   {!exam.topics.length&&!exam.sittings.length&&<p className="practice-help">Topic and sitting filters appear once questions are tagged.</p>}</details>}
  {state.error&&<p className="practice-feedback practice-error" role="alert">{state.error}</p>}
  <button className="practice-button" disabled={pending||!requestId}>{pending?'Preparing…':mode==='exam'?(trial?'Start mini mock':'Start timed exam'):'Start revision'}</button>
 </form>;
}
// Every other way into practice, as one ruled list: the two one-tap packs (STU-8), each complete paper with an
// inline check before its timer starts, and the full custom-session form folded into the last row.
export function PracticeWays({exam,exams}:{exam:PracticeExam;exams:PracticeExam[]}){
 const router=useRouter();const[busy,start]=useTransition();const[error,setError]=useState('');const[arming,setArming]=useState('');
 const pack=(focus:'highYield'|'latestSitting')=>start(async()=>{const form=new FormData();form.set('requestId',crypto.randomUUID());form.set('examId',exam.id);form.set('mode','revision');form.set('pool','all');form.set('count','20');form.set(focus,'true');
  const result=await startPractice({},form);if(result.attemptId)router.push(`/practice/${result.attemptId}`);else setError(result.error??'');});
 const sit=(paperId:string)=>start(async()=>{const r=await startPaper(paperId,crypto.randomUUID());if(r.attemptId)router.push(`/practice/${r.attemptId}`);else{setArming('');setError(r.error??'');}});
 const latest=exam.sittings[0]?.label;
 return <><ul className="ways">
  <li><span className="way-main"><strong>High-yield sprint</strong><span>20 questions recalled in {exam.highYieldMin} or more sittings, with feedback after each answer.</span></span><button type="button" className="practice-ghost" disabled={busy} onClick={()=>pack('highYield')}>Start sprint</button></li>
  <li><span className="way-main"><strong>Latest-diet pack</strong><span>20 questions from {latest?`the ${latest} sitting`:'the most recent sitting'}.</span></span><button type="button" className="practice-ghost" disabled={busy} onClick={()=>pack('latestSitting')}>Start pack</button></li>
  {exam.access==='full'?exam.papers.map(p=><li key={p.id} className={arming===p.id?'is-arming':undefined}><span className="way-main"><strong>{p.title}</strong><span>{arming===p.id?`The ${p.minutes}-minute timer starts as soon as you begin and keeps running if you leave.`:`Complete paper${p.sitting?`, ${p.sitting}`:''} · ${p.questions} questions in ${p.minutes} minutes · results after you submit`}</span></span>
   {arming===p.id?<span className="way-actions"><button type="button" className="practice-ghost" disabled={busy} onClick={()=>setArming('')}>Not yet</button><button type="button" className="practice-button" disabled={busy} onClick={()=>sit(p.id)}>{busy?'Starting…':'Start the timer'}</button></span>
    :<button type="button" className="practice-ghost" disabled={busy} onClick={()=>setArming(p.id)}>Sit this paper</button>}</li>)
   :<li><span className="way-main"><strong>Complete papers</strong><span>Full recall papers, timed at the real exam pace, come with a plan.</span></span><Link className="practice-ghost" href="/pricing">See plans</Link></li>}
  <li className="way-custom"><details><summary><span className="way-main"><strong>Custom session</strong><span>Choose the mode, the question pool and how many, then narrow by topic, sitting or difficulty.</span></span><span className="practice-ghost way-toggle" aria-hidden="true">Set up</span></summary><StartPractice exams={exams}/></details></li>
 </ul>{error&&<p className="practice-feedback practice-error" role="alert">{error}</p>}</>;
}
export function TrialOffers({offers}:{offers:TrialOffer[]}){
 const router=useRouter();const[busy,start]=useTransition();const[message,setMessage]=useState<{error?:string;success?:string}>({});
 if(!offers.length)return null;
 return <section className="panel" aria-labelledby="trial-title"><div className="panel-head"><h2 id="trial-title">Try another exam free</h2><span className="state">No card needed · one free trial per exam</span></div><ul className="ways">{offers.map(o=><li key={o.id}><span className="way-main"><strong>{o.name}</strong><span>{o.days} days or {o.questionLimit} questions, whichever comes first, plus one mini mock.</span></span>
  <button type="button" className="practice-button practice-button-small" disabled={busy} onClick={()=>start(async()=>{const r=await beginTrial(o.id);setMessage(r);if(!r.error)router.refresh();})}>Start free trial</button></li>)}</ul>
  {message.error&&<p className="practice-feedback practice-error" role="alert">{message.error}</p>}{message.success&&<p className="practice-feedback" role="status">{message.success}</p>}</section>;
}
// One click into the session the home screen recommends (mistakes deck, unanswered or all).
export function QuickStart({examId,label,pool='all',primary=false,topicId}:{examId:string;label:string;pool?:'all'|'unanswered'|'mistakes'|'review';primary?:boolean;topicId?:string}){
 const router=useRouter();const[busy,start]=useTransition();const[error,setError]=useState('');
 const go=()=>start(async()=>{const form=new FormData();form.set('requestId',crypto.randomUUID());form.set('examId',examId);form.set('mode','revision');form.set('pool',pool);form.set('count',topicId?'10':'20');if(topicId)form.set('topicIds',topicId);
  const result=await startPractice({},form);if(result.attemptId)router.push(`/practice/${result.attemptId}`);else setError(result.error??'');});
 return <span className="quick-start"><button type="button" className={primary?'practice-button':'practice-ghost'} disabled={busy} onClick={go}>{busy?'Preparing…':label}</button>{error&&<span className="practice-feedback practice-error" role="alert">{error}</span>}</span>;
}

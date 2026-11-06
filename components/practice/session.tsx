'use client';
import {TutorPanel} from './tutor';
import {Discussion} from './discussion';
import Link from 'next/link';
import {startTransition as dispatchSave,useActionState,useCallback,useEffect,useRef,useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {finishPractice,submitAnswer,toggleBookmark,toggleFlag} from '@/app/practice/actions';
import {QuestionTools} from '@/components/practice/question-tools';
import type {PracticeView} from '@/lib/services/practice';
const LETTERS='ABCDE';
function formatTime(ms:number){const s=Math.max(0,Math.ceil(ms/1000));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),r=s%60;return `${h?`${h}:`:''}${String(m).padStart(h?2:1,'0')}:${String(r).padStart(2,'0')}`;}
function Timer({deadline,serverNow,onExpire}:{deadline:string;serverNow:string;onExpire:()=>void}){
 const offset=useRef(Date.parse(serverNow)-Date.now());const[left,setLeft]=useState(()=>Date.parse(deadline)-Date.parse(serverNow));const fired=useRef(false);
 useEffect(()=>{const tick=()=>{const remaining=Date.parse(deadline)-(Date.now()+offset.current);setLeft(remaining);if(remaining<=0&&!fired.current){fired.current=true;onExpire();}};tick();const id=setInterval(tick,500);return()=>clearInterval(id);},[deadline,onExpire]);
 return <span className={`practice-timer${left<5*60000?' practice-timer-low':''}`} role="timer" aria-live={left<60000?'polite':'off'}>{formatTime(left)}</span>;
}
// The last check before an exam is marked: what is answered, blank and flagged, in the page's own voice.
function SubmitCheck({navigator,total,busy,onCancel,onSubmit}:{navigator:PracticeView['navigator'];total:number;busy:boolean;onCancel:()=>void;onSubmit:()=>void}){
 const done=navigator.filter(n=>n.answered).length,blank=total-done,marked=navigator.filter(n=>n.flagged).length;
 return <div className="practice-confirm" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-text"><p><strong id="confirm-title">Submit with {done} of {total} answered?</strong> <span id="confirm-text">{blank?`${blank} unanswered ${blank===1?'counts':'count'} as wrong. `:''}{marked?`${marked} still flagged. `:''}You cannot change answers afterwards.</span></p>
  <span className="practice-confirm-actions"><button type="button" className="practice-ghost" onClick={onCancel} autoFocus>Keep working</button><button type="button" className="practice-button" onClick={onSubmit} disabled={busy}>{busy?'Submitting…':'Submit exam'}</button></span></div>;
}
export function PracticeSession({view,watermark}:{view:PracticeView;watermark:string}){
 const{attempt,question:q,feedback,navigator}=view;const router=useRouter();
 const[state,action,pending]=useActionState(submitAnswer,{});const[selected,setSelected]=useState<number|null>(q.selected);const[struck,setStruck]=useState<number[]>([]);
 const[flagged,setFlagged]=useState(q.flagged);const[bookmarked,setBookmarked]=useState(q.bookmarked);const[busy,startTransition]=useTransition();const[notice,setNotice]=useState('');const[confirming,setConfirming]=useState(false);const form=useRef<HTMLFormElement>(null);const protectedArea=useRef<HTMLElement>(null);const shown=useRef(Date.now());
 const finished=attempt.submittedAt!==null;const exam=attempt.mode==='exam';const locked=finished||(!exam&&q.selected!==null)||q.withdrawn;
 const href=(p:number)=>`/practice/${attempt.id}?q=${p}`;
 // PROT-4 deterrents only: they slow casual copying; rate limits and watermark tracing are the real controls.
 useEffect(()=>{const area=protectedArea.current;if(!area)return;const block=(e:Event)=>{if(e.target instanceof Element&&e.target.closest('.practice-tools'))return;e.preventDefault();};const events=['contextmenu','copy','cut','dragstart'];events.forEach(name=>area.addEventListener(name,block));return()=>events.forEach(name=>area.removeEventListener(name,block));},[]);
 useEffect(()=>{if(state.success){shown.current=Date.now();router.refresh();}},[state,router]);
 const finish=useCallback(()=>startTransition(async()=>{const result=await finishPractice(attempt.id);if(result.error)setNotice(result.error);else router.push(`/practice/${attempt.id}/results`);}),[attempt.id,router]);
 const flag=useCallback(()=>startTransition(async()=>{const result=await toggleFlag(attempt.id,attempt.position,!flagged);if(result.error)setNotice(result.error);else{setFlagged(!flagged);setNotice(result.success??'');router.refresh();}}),[attempt.id,attempt.position,flagged,router]);
 const bookmark=useCallback(()=>startTransition(async()=>{const result=await toggleBookmark(attempt.id,attempt.position,!bookmarked);if(result.error)setNotice(result.error);else{setBookmarked(!bookmarked);setNotice(result.success??'');}}),[attempt.id,attempt.position,bookmarked]);
 const save=useCallback((data:FormData)=>{data.set('timeMs',String(Date.now()-shown.current));action(data);},[action]);
 const choose=useCallback((i:number)=>{if(locked)return;setSelected(i);
  // Exam Mode saves each choice immediately so nothing is lost on navigation or time-out.
  if(exam&&form.current){const data=new FormData(form.current);data.set('selected',String(i));dispatchSave(()=>save(data));}},[locked,exam,save]);
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.target instanceof HTMLElement&&e.target.closest('input[type=text],textarea,select'))return;if(e.metaKey||e.ctrlKey||e.altKey)return;
  const key=e.key.toUpperCase(),index=LETTERS.indexOf(key)>=0?LETTERS.indexOf(key):'12345'.indexOf(key);
  if(index>=0&&index<q.options.length){e.preventDefault();choose(index);}
  else if(key==='N'&&attempt.position<attempt.total)router.push(href(attempt.position+1));
  else if(key==='P'&&attempt.position>1)router.push(href(attempt.position-1));
  else if(key==='F'&&!finished)flag();
  else if(key==='B'&&!q.withdrawn)bookmark();
  // Enter checks the chosen answer in Revision Mode, so a whole session runs from the keyboard.
  else if(e.key==='Enter'&&!exam&&!locked&&selected!==null&&!(e.target instanceof HTMLButtonElement)){e.preventDefault();form.current?.requestSubmit();}};
  window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);});
 return <div className="practice-session">
  <header className="practice-bar"><div><h1>Question {attempt.position} <small>of {attempt.total}</small></h1><p className="app-sub">{attempt.examName} · {attempt.paperTitle??(exam?(attempt.access==='trial'?'Trial mini mock':'Exam Mode'):'Revision Mode')}</p></div>
   <div className="practice-bar-actions">{exam&&!finished&&<Timer deadline={attempt.deadlineAt!} serverNow={attempt.serverNow} onExpire={finish}/>}
    {!q.withdrawn&&<button type="button" className="practice-ghost practice-bookmark" aria-pressed={bookmarked} onClick={bookmark} disabled={busy}><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 1.75h7v10.5L7 9.6l-3.5 2.65z" fill={bookmarked?'currentColor':'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>{bookmarked?'Bookmarked':'Bookmark'}</button>}
    {!finished&&<button type="button" className="practice-ghost" aria-pressed={flagged} onClick={flag} disabled={busy}>{flagged?'Flagged':'Flag'}</button>}
    {finished?<Link className="practice-button" href={`/practice/${attempt.id}/results`}>Results</Link>:<button type="button" className="practice-button" onClick={()=>exam?setConfirming(true):finish()} disabled={busy||confirming}>{exam?'Submit exam':'Finish'}</button>}</div>
   {confirming&&!finished&&<SubmitCheck navigator={navigator} total={attempt.total} busy={busy} onCancel={()=>setConfirming(false)} onSubmit={finish}/>}</header>
  {notice&&<p className="practice-feedback" role="status">{notice}</p>}
  <div className="practice-layout"><section ref={protectedArea} className="practice-question" aria-label={`Question ${attempt.position}`}>
   <div className="practice-watermark" aria-hidden="true">{Array.from({length:12},(_,i)=><span key={i}>{watermark}</span>)}</div>
   {q.withdrawn?<div className="practice-withdrawn"><h2>This question has been withdrawn.</h2><p>It was removed from the bank after you started and does not count towards your score.</p></div>:<>
   <p className="practice-stem">{q.stem}</p>
   <form ref={form} action={save}><input type="hidden" name="attemptId" value={attempt.id}/><input type="hidden" name="position" value={attempt.position}/><input type="hidden" name="selected" value={selected??''}/>
    <fieldset className="practice-options" disabled={locked}><legend className="sr-only">Answer options</legend>
     {q.options.map((option,i)=>{const correct=feedback?.correctAnswer===i,chosen=selected===i;const cls=['practice-option',chosen&&'is-selected',struck.includes(i)&&'is-struck',feedback&&correct&&'is-correct',feedback&&chosen&&!correct&&'is-wrong'].filter(Boolean).join(' ');
      return <div key={i} className={cls}><label><input type="radio" name="choice" value={i} checked={chosen} onChange={()=>choose(i)} aria-label={`${LETTERS[i]}. ${option}`}/><span className="practice-letter">{LETTERS[i]}</span><span className="practice-option-text">{option}</span>{feedback&&<span className="practice-share">{feedback.distribution[i]}%</span>}</label>
       {!locked&&<button type="button" className="practice-strike" aria-pressed={struck.includes(i)} aria-label={`${struck.includes(i)?'Restore':'Strike through'} option ${LETTERS[i]}`} onClick={()=>setStruck(s=>s.includes(i)?s.filter(x=>x!==i):[...s,i])}><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg></button>}</div>;})}
    </fieldset>
    {!locked&&!exam&&<fieldset className="practice-confidence"><legend>How sure are you?</legend>{(['sure','unsure','guess'] as const).map(c=><label key={c}><input type="radio" name="confidence" value={c} defaultChecked={q.confidence===c}/>{c==='sure'?'Sure':c==='unsure'?'Unsure':'Guess'}</label>)}</fieldset>}
    {exam&&!finished&&<input type="hidden" name="confidence" value=""/>}
    {state.error&&<p className="practice-feedback practice-error" role="alert">{state.error}</p>}
    {!locked&&!exam&&<button className="practice-button" disabled={pending||selected===null}>{pending?'Checking…':'Check answer'}</button>}
    {exam&&!finished&&<p className="practice-help" aria-live="polite">{pending?'Saving…':q.selected!==null||state.success?'Answer saved. You can change it until you submit.':'Choose an answer. It saves automatically.'}</p>}
   </form>
   {feedback&&<section className="practice-explanation" aria-live="polite"><p className={`practice-verdict ${feedback.correct?'is-correct':'is-wrong'}`}>{q.selected===null?`Not answered. The correct answer is ${LETTERS[feedback.correctAnswer]}.`:feedback.correct?'Correct.':`Incorrect. The correct answer is ${LETTERS[feedback.correctAnswer]}.`}</p>
    {(feedback.seenIn.length>0||feedback.highYield||feedback.newThisSitting)&&<div className="practice-badges">{feedback.highYield&&<span className="practice-badge is-hot">High-yield</span>}{feedback.newThisSitting&&<span className="practice-badge is-new">New this sitting</span>}{feedback.seenIn.map(label=><span key={label} className="practice-badge">Seen in {label}</span>)}</div>}<h2>Explanation</h2><p className="practice-prose">{feedback.explanation}</p>{feedback.keyNotes.length>0&&<><h3>Key notes</h3><ul>{feedback.keyNotes.map((n,i)=><li key={i}>{n}</li>)}</ul></>}
    {feedback.references.length>0&&<><h3>References</h3><ul>{feedback.references.map((r,i)=><li key={i}>{r}</li>)}</ul></>}
    <p className="practice-help">Percentages show how other students answered this question.</p></section>}
   {feedback&&<TutorPanel key={attempt.position} attemptId={attempt.id} position={attempt.position}/>}
   {feedback&&<Discussion key={`d${attempt.position}`} attemptId={attempt.id} position={attempt.position}/>}
   {feedback&&<QuestionTools attemptId={attempt.id} position={attempt.position} note={q.note} reported={q.reported}/>}</>}
   <nav className="practice-pager" aria-label="Question navigation">{attempt.position>1?<Link href={href(attempt.position-1)}>← Previous</Link>:<span/>}{attempt.position<attempt.total?<Link href={href(attempt.position+1)}>Next →</Link>:<span/>}</nav>
  </section>
  <aside className="practice-navigator"><h2>Navigator</h2><ol>{navigator.map(n=><li key={n.position}><Link href={href(n.position)} aria-current={n.position===attempt.position?'page':undefined} className={[n.answered&&'is-answered',n.flagged&&'is-flagged'].filter(Boolean).join(' ')} aria-label={`Question ${n.position}${n.answered?', answered':''}${n.flagged?', flagged':''}`}>{n.position}</Link></li>)}</ol>
   <p className="practice-help">{navigator.filter(n=>n.answered).length} answered · {navigator.filter(n=>n.flagged).length} flagged</p>
   <p className="practice-help practice-keys">Keys: A–E choose{exam?'':' · Enter check'} · N next · P previous · F flag · B bookmark</p></aside></div>
 </div>;
}

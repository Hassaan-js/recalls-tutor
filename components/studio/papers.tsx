'use client';
import Link from 'next/link';
import {useActionState,useEffect,useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {changePaper,newPaper,proposeExamPapers} from '@/app/studio/papers/actions';
import type {PaperDetail} from '@/lib/services/papers';
function Result({state}:{state:{error?:string;success?:string}}){return <>{state.error&&<p className="studio-feedback studio-error" role="alert">{state.error}</p>}{state.success&&<p className="studio-feedback" role="status">{state.success}</p>}</>;}
export function NewPaper({exams}:{exams:{id:string;name:string;sittings:{id:string;label:string}[];defaultMinutes:number|null}[]}){
 const[state,action,pending]=useActionState(newPaper,{});const router=useRouter();const[examId,setExamId]=useState(exams[0]?.id??'');const exam=exams.find(e=>e.id===examId);
 useEffect(()=>{if(state.paperId)router.push(`/studio/papers?paper=${state.paperId}`);},[state.paperId,router]);
 return <form action={action}><label className="studio-field">Exam<select name="examId" value={examId} onChange={e=>setExamId(e.target.value)}>{exams.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
  <label className="studio-field">Title<input name="title" required maxLength={160} placeholder="e.g. September 2026 recall paper 1"/></label>
  <label className="studio-field"><span>Sitting <small>optional</small></span><select name="sittingId" defaultValue="" key={examId}><option value="">Not linked to a sitting (mock)</option>{exam?.sittings.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
  <label className="studio-field">Time limit (minutes)<input name="minutes" type="number" min={1} max={600} required key={examId} defaultValue={exam?.defaultMinutes??''}/><span className="studio-help">{exam?.defaultMinutes?'Prefilled from the exam’s configured duration.':'Set the real paper time once the exam team confirms it.'}</span></label>
  <Result state={state}/><button className="studio-button" disabled={pending||!exams.length}>{pending?'Creating…':'Create paper'}</button></form>;
}
export function PaperEditor({paper,candidates,sittings,topics,filter}:{paper:PaperDetail;candidates:{id:string;stem:string;topic:string|null;sittings:string}[];sittings:{id:string;label:string}[];topics:{id:string;label:string}[];filter:{sittingId:string;topicId:string;text:string}}){
 const router=useRouter();const[busy,start]=useTransition();const[notice,setNotice]=useState<{error?:string;success?:string}>({});
 const run=(change:Parameters<typeof changePaper>[1])=>start(async()=>{const r=await changePaper(paper.id,change);setNotice(r.error?{error:r.error}:{});if(!r.error)router.refresh();});
 const editable=!paper.locked;const published=paper.items.filter(i=>i.status==='published').length;
 return <div className="paper-editor">
  <header className="studio-question-heading"><div><h2>{paper.title}</h2><p className="studio-meta">{paper.examName}{paper.sitting?` · ${paper.sitting}`:' · Mock'} · {paper.minutes} min</p></div><span className="studio-status">{paper.status}{paper.locked?' · locked':''}</span></header>
  <p className={`studio-feedback${paper.complete?'':' catalogue-warn'}`}>{paper.blueprintCount===null?`${published} questions. The real paper size is not configured yet, so completeness cannot be checked.`:paper.complete?`Complete paper: ${published} of ${paper.blueprintCount} questions, matching the exam blueprint.`:`${published} of ${paper.blueprintCount} questions. A complete paper matches the exam blueprint.`}</p>
  <div className="paper-actions">{paper.status==='draft'&&(paper.locked?<><button type="button" className="studio-button" disabled={busy} onClick={()=>run({kind:'publish'})}>Publish to students</button><button type="button" className="studio-button studio-button-secondary" disabled={busy} onClick={()=>run({kind:'unlock'})}>Unlock to edit</button></>:<button type="button" className="studio-button" disabled={busy||!paper.items.length} onClick={()=>run({kind:'lock'})}>Lock question order</button>)}
   {paper.status==='published'&&<button type="button" className="studio-button studio-button-secondary" disabled={busy} onClick={()=>run({kind:'unpublish'})}>Unpublish</button>}</div>
  <Result state={notice}/>
  <h3>Questions in this paper</h3>{paper.items.length?<ol className="paper-list">{paper.items.map((item,index)=><li key={item.questionId} className={item.status!=='published'?'is-withdrawn':''}><span className="paper-pos">{item.position}</span><span className="paper-stem"><Link href={`/studio?question=${item.questionId}`}>{item.stem.slice(0,180)}</Link><small>{item.topic??'No topic'}{item.status!=='published'?` · ${item.status} — excluded from attempts`:''}</small></span>
   {editable&&<span className="paper-buttons"><button type="button" aria-label={`Move question ${item.position} up`} disabled={busy||index===0} onClick={()=>run({kind:'up',questionId:item.questionId})}>↑</button><button type="button" aria-label={`Move question ${item.position} down`} disabled={busy||index===paper.items.length-1} onClick={()=>run({kind:'down',questionId:item.questionId})}>↓</button><button type="button" aria-label={`Remove question ${item.position}`} disabled={busy} onClick={()=>run({kind:'remove',questionId:item.questionId})}>Remove</button></span>}</li>)}</ol>:<p className="studio-help">No questions yet. Add published questions below.</p>}
  {editable&&<section className="paper-add"><h3>Add published questions</h3><form className="catalogue-inline" method="get"><input type="hidden" name="paper" value={paper.id}/>
   <label className="studio-field">Sitting<select name="sitting" defaultValue={filter.sittingId}><option value="">Any</option>{sittings.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
   <label className="studio-field">Topic<select name="topic" defaultValue={filter.topicId}><option value="">Any</option>{topics.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
   <label className="studio-field">Search<input name="q" defaultValue={filter.text} maxLength={100}/></label><button className="studio-button studio-button-secondary">Filter</button></form>
   {candidates.length?<ul className="paper-list">{candidates.map(c=><li key={c.id}><span className="paper-stem">{c.stem.slice(0,180)}<small>{[c.topic,c.sittings].filter(Boolean).join(' · ')||'Untagged'}</small></span><span className="paper-buttons"><button type="button" disabled={busy} onClick={()=>run({kind:'add',questionId:c.id})}>Add</button></span></li>)}</ul>:<p className="studio-help">No published questions match. Questions must be published before they can join a paper.</p>}</section>}
 </div>;
}
// QB-6: one draft paper per published sitting without one, for the content manager to review and lock.
export function ProposePapers({exams}:{exams:{id:string;name:string}[]}){
 const[state,action,pending]=useActionState(proposeExamPapers,{});const router=useRouter();
 useEffect(()=>{if(state.paperId)router.push(`/studio/papers?paper=${state.paperId}`);else if(state.success)router.refresh();},[state,router]);
 return <form action={action}><p className="studio-help">Builds a draft paper for each published sitting that has no paper yet, from that sitting’s published questions, balanced across topics to the blueprint count.</p>
  <label className="studio-field">Exam<select name="examId">{exams.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
  <Result state={state}/><button className="studio-button studio-button-secondary" disabled={pending||!exams.length}>{pending?'Proposing…':'Propose papers'}</button></form>;
}

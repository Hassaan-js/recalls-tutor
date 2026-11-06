'use client';
import Link from 'next/link';
import {useActionState,useEffect,useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {acceptFix,decideSitting,dismissFix,draftFix,saveAiBudget} from '@/app/studio/actions';
import type {Proposal} from '@/lib/services/proposals';
type Result={error?:string;success?:string};
const L='ABCDE';
function Notice({state}:{state:Result}){return <>{state.error&&<p className="studio-feedback studio-error" role="alert">{state.error}</p>}{state.success&&<p className="studio-feedback" role="status">{state.success}</p>}</>;}
// ADM-6: ask Claude to check a student's report and draft a fix. Nothing changes until a person accepts it.
export function DraftFixButton({reportId}:{reportId:string}){
 const router=useRouter();const[busy,start]=useTransition();const[state,setState]=useState<Result>({});
 return <><button type="button" className="studio-button studio-button-secondary studio-button-small" disabled={busy} onClick={()=>start(async()=>{const r=await draftFix(reportId);setState(r);if(!r.error)router.refresh();})}>{busy?'Claude is checking…':'Draft a fix with Claude'}</button>{(state.error||state.success)&&<Notice state={state}/>}</>;
}
// One line of the before/after comparison; changed lines are marked so a reviewer sees them at a glance.
function Line({label,before,after}:{label:string;before:string;after:string}){
 const changed=before.trim()!==after.trim();
 return <div className={`proposal-line${changed?' is-changed':''}`}><span className="proposal-label">{label}{changed&&<b> changed</b>}</span><div className="proposal-cols"><p>{before||'—'}</p><p>{after||'—'}</p></div></div>;
}
function ProposalCard({p,canDecide}:{p:Proposal;canDecide:boolean}){
 const router=useRouter();const[state,action,pending]=useActionState(acceptFix,{});const[busy,start]=useTransition();const[dismissed,setDismissed]=useState<Result>({});const[edit,setEdit]=useState(false);
 useEffect(()=>{if(state.success)router.refresh();},[state,router]);
 const opt=(o:string[],a:number|null)=>o.map((x,i)=>`${L[i]}. ${x}${i===a?'  ✓':''}`).join('\n');
 return <li className="proposal">
  <div className="proposal-head"><strong>{p.source==='error_report'?`Fix for a student report: ${p.reason}`:'New evidence for a published question'}</strong><span>{p.examName} · {new Date(p.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}{p.confidence!==null?` · confidence ${p.confidence}`:''}</span></div>
  {p.reportDetails&&<p className="studio-report-details">“{p.reportDetails}”</p>}
  <p className="proposal-why">{p.rationale}</p>
  {p.changes.length>0&&<ul className="proposal-changes">{p.changes.map((c,i)=><li key={i}>{c}</li>)}</ul>}
  <div className="proposal-cols proposal-cols-head" aria-hidden="true"><span>Published now</span><span>Proposed</span></div>
  <Line label="Stem" before={p.before.stem} after={p.after.stem}/>
  <Line label="Options and answer" before={opt(p.before.options,p.before.answer)} after={opt(p.after.options,p.after.answer)}/>
  <Line label="Explanation" before={p.before.explanation} after={p.after.explanation}/>
  {p.stale&&<p className="studio-feedback catalogue-warn">The question was edited after this proposal was made. Dismiss it, or draft a new fix.</p>}
  {canDecide?<form action={action} className="proposal-actions"><input type="hidden" name="proposalId" value={p.id}/><input type="hidden" name="edited" value={edit?'true':'false'}/>
   {edit&&<div className="proposal-edit">
    <label className="studio-field">Stem<textarea name="stem" rows={4} defaultValue={p.after.stem} required/></label>
    {p.after.options.map((o,i)=><label key={i} className="studio-field">Option {L[i]}<input name={`option${i}`} defaultValue={o} required/></label>)}
    <label className="studio-field">Correct answer<select name="correctAnswer" defaultValue={String(p.after.answer??0)}>{[0,1,2,3,4].map(i=><option key={i} value={i}>{L[i]}</option>)}</select></label>
    <label className="studio-field">Explanation<textarea name="explanation" rows={5} defaultValue={p.after.explanation} required/></label></div>}
   <div className="paper-actions"><button className="studio-button" disabled={pending||p.stale}>{pending?'Publishing…':edit?'Publish my edited version':'Accept and publish'}</button>
    <button type="button" className="studio-button studio-button-secondary" onClick={()=>setEdit(!edit)} disabled={p.stale}>{edit?'Use Claude’s version':'Edit before accepting'}</button>
    <button type="button" className="studio-link-button studio-danger-link" disabled={busy} onClick={()=>start(async()=>{const r=await dismissFix(p.id);setDismissed(r);if(!r.error)router.refresh();})}>Dismiss</button>
    <Link className="studio-link-button" href={`/studio?question=${p.questionId}`}>Open the question</Link></div>
   <Notice state={state}/><Notice state={dismissed}/></form>
   :<p className="studio-help">A content manager accepts or dismisses proposed edits.</p>}
 </li>;
}
export function ProposalList({proposals,canDecide}:{proposals:Proposal[];canDecide:boolean}){
 if(!proposals.length)return <p className="studio-help">No proposed edits waiting.</p>;
 return <ul className="proposal-list">{proposals.map(p=><ProposalCard key={p.id} p={p} canDecide={canDecide}/>)}</ul>;
}
// AIS-14: sittings that uploads mentioned but the catalogue does not have.
export function SittingProposals({items}:{items:{id:string;examName:string;label:string;mention:string}[]}){
 const router=useRouter();const[busy,start]=useTransition();const[state,setState]=useState<Result>({});
 if(!items.length)return null;
 const go=(id:string,confirm:boolean)=>start(async()=>{const r=await decideSitting(id,confirm);setState(r);if(!r.error)router.refresh();});
 return <section className="catalogue-panel" aria-labelledby="sp-title"><h2 id="sp-title">Sittings mentioned in uploads</h2>
  <p className="studio-help">An upload named a sitting this exam does not have yet. Confirm to create it (unpublished), or dismiss.</p>
  <ul className="security-list">{items.map(i=><li key={i.id}><div className="security-row"><strong>{i.examName} · {i.label}</strong><span>“{i.mention}”</span></div>
   <div className="paper-actions"><button type="button" className="studio-button studio-button-secondary studio-button-small" disabled={busy} onClick={()=>go(i.id,true)}>Create {i.label}</button><button type="button" className="studio-link-button" disabled={busy} onClick={()=>go(i.id,false)}>Dismiss</button></div></li>)}</ul>
  <Notice state={state}/></section>;
}
export function AiBudgetForm({budget}:{budget:number|null}){
 const[state,action,pending]=useActionState(saveAiBudget,{});const router=useRouter();
 useEffect(()=>{if(state.success)router.refresh();},[state,router]);
 return <form action={action} className="catalogue-inline"><label className="studio-field">Monthly AI budget (USD) <span className="studio-help">an alert shows at 80% and when it is passed</span><input name="budget" inputMode="decimal" defaultValue={budget??''} placeholder="No budget"/></label>
  <button className="studio-button studio-button-secondary" disabled={pending}>Save</button><Notice state={state}/></form>;
}

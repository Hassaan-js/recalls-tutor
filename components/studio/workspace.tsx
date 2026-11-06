'use client';
import {SampleToggle} from './blog';
import {useActionState,useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {createRecall,saveDraft,reviewQuestion,uploadRecalls,retryJob,refineWithAI,saveTags} from '@/app/studio/actions';
import {grantAccess} from '@/app/practice/actions';
import type {StudioQuestion} from '@/lib/services/studio';
import type {StudioJob} from '@/lib/services/ai-studio';
function Result({state}:{state:{error?:string;success?:string}}){return <>{state.error&&<p className="studio-feedback studio-error" role="alert">{state.error}</p>}{state.success&&<p className="studio-feedback" role="status">{state.success}</p>}</>;}
export function RecallIntake({exams}:{exams:{id:string;name:string}[]}){
 const[state,action,pending]=useActionState(createRecall,{});const[requestId,setRequestId]=useState('');const form=useRef<HTMLFormElement>(null);const handled=useRef<string|undefined>(undefined);const router=useRouter();
 useEffect(()=>setRequestId(crypto.randomUUID()),[]);
 useEffect(()=>{if(state.questionId&&state.questionId!==handled.current){handled.current=state.questionId;form.current?.reset();setRequestId(crypto.randomUUID());router.push(`/studio?question=${state.questionId}`);router.refresh();}},[state.questionId,router]);
 return <form ref={form} action={action}><input type="hidden" name="requestId" value={requestId}/><label className="studio-field">Exam<select name="examId" required defaultValue=""><option value="" disabled>Choose an exam</option>{exams.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label className="studio-field">Source label<input name="sourceLabel" required maxLength={200}/></label><label className="studio-field">Recall text<textarea name="sourceText" rows={7} required maxLength={20000}/></label><p className="studio-help">Remove names, phone numbers and personal identifiers before pasting. The source is retained privately as supplied; nothing is sent to AI. Use Upload recalls for AI drafting.</p><Result state={state}/><button className="studio-button" disabled={pending||!requestId||!exams.length}>{pending?'Saving recall…':'Create draft'}</button></form>;
}
type Taxonomy={topics:{id:string;label:string}[];sittings:{id:string;label:string}[]};
export function QuestionEditor({question:q,manager,taxonomy}:{question:StudioQuestion;manager:boolean;taxonomy:Taxonomy}){
 const[state,action,pending]=useActionState(saveDraft,{});const[dirty,setDirty]=useState(false);const router=useRouter();const locked=['published','retired','rejected'].includes(q.status);
 useEffect(()=>{if(state.success){setDirty(false);router.refresh();}},[state,router]);
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 return <><header className="studio-question-heading"><div><h2>Question workspace</h2><p className="studio-meta">{q.examName} · Single best answer</p></div><Pipeline status={q.status} version={q.version}/></header>{q.aiMeta&&<AiPanel question={q}/>}<div className="studio-editor-columns"><aside className="studio-evidence"><h3>Source evidence</h3><p className="studio-meta">{q.sourceLabel||'Original recall'}</p><span className="studio-help">Private · Staff only</span><pre>{q.sourceText||'No source evidence attached.'}</pre><p className="studio-help">Source claims are evidence, not verified answers. Confirm the answer and references before approval.</p><details className="studio-history"><summary>Version history ({q.history.length})</summary><ol>{q.history.map(v=><li key={v.version}><strong>Version {v.version}</strong><time dateTime={v.createdAt}>{new Date(v.createdAt).toLocaleString('en-GB',{timeZone:'UTC'})} UTC</time></li>)}</ol></details></aside><div className="studio-draft"><h3>Editorial draft</h3>{locked&&<p className="studio-feedback">This {q.status} version is read-only.</p>}<form action={action} onChange={()=>setDirty(true)}><input type="hidden" name="questionId" value={q.id}/><input type="hidden" name="versionId" value={q.versionId}/><fieldset disabled={locked||pending}><legend className="studio-sr-only">Question draft</legend><label className="studio-field">Question stem<textarea name="stem" rows={5} defaultValue={q.stem} maxLength={20000}/></label><h3 className="studio-options-heading">Answer options <small>Five-option SBA</small></h3>{Array.from({length:5},(_,i)=><label className="studio-option" key={i}><span>{String.fromCharCode(65+i)}</span><input aria-label={`Option ${String.fromCharCode(65+i)}`} name={`option${i}`} defaultValue={q.options[i]||''} maxLength={2000}/></label>)}<label className="studio-field">Correct answer<select name="correctAnswer" defaultValue={q.correctAnswer===null?'':String(q.correctAnswer)}><option value="">Not yet determined</option>{Array.from({length:5},(_,i)=><option key={i} value={i}>Option {String.fromCharCode(65+i)}</option>)}</select></label><label className="studio-field">Explanation<textarea name="explanation" rows={6} defaultValue={q.explanation} maxLength={20000}/></label><label className="studio-field">Key learning notes<textarea name="keyNotes" rows={4} defaultValue={q.keyNotes.join('\n')} maxLength={10000}/><span className="studio-help">One note per line, 3–5 notes.</span></label><label className="studio-field">References<textarea name="references" rows={4} defaultValue={q.references.join('\n')} maxLength={10000}/><span className="studio-help">One reference per line, with enough detail for verification.</span></label></fieldset><Result state={state}/>{!locked&&<div className="studio-save-row"><button className="studio-button" disabled={pending||!dirty}>{pending?'Saving version…':'Save new version'}</button><p className="studio-help">{dirty?'Unsaved changes. Save before reviewing or leaving this question.':'Every saved edit creates a version and returns the question to draft.'}</p></div>}</form></div></div>{q.status!=='rejected'&&<TagsPanel question={q} taxonomy={taxonomy}/>}{['raw','ai_refined','in_review'].includes(q.status)&&<RefinePanel question={q} disabled={dirty||pending}/>}<ReviewPanel question={q} manager={manager} disabled={dirty||pending}/>{q.status==='published'&&manager&&<SampleToggle questionId={q.id} on={q.publicSample}/>}</>;
}
// Where this version stands on the way to students: Draft, In review, Approved, Published. Rejected and retired
// questions have left the line, so they show their end state instead.
const STEPS=[{label:'Draft',statuses:['raw','ai_refined']},{label:'In review',statuses:['in_review']},{label:'Approved',statuses:['approved']},{label:'Published',statuses:['published']}];
function Pipeline({status,version}:{status:string;version:number}){
 const at=STEPS.findIndex(s=>s.statuses.includes(status));
 if(at<0)return <p className="studio-pipeline-end">{status==='retired'?'Retired':'Rejected'} · version {version}</p>;
 return <ol className="studio-pipeline" aria-label={`Status: ${STEPS[at].label}, version ${version}`}>{STEPS.map((s,i)=><li key={s.label} className={i<at?'is-done':i===at?'is-now':undefined} aria-current={i===at?'step':undefined}>{s.label}{i===at&&<small> v{version}</small>}</li>)}</ol>;
}
function ReviewPanel({question:q,manager,disabled}:{question:StudioQuestion;manager:boolean;disabled:boolean}){
 const[state,action,pending]=useActionState(reviewQuestion,{});const router=useRouter();const[operation,setOperation]=useState('');useEffect(()=>{if(state.success){setOperation('');router.refresh();}},[state,router]);
 // Every possible next step is a visible button: the forward step is primary, sending back is secondary and
 // the irreversible ones sit apart in red. Choosing one opens its own check before anything is applied.
 type Op={value:string;label:string;confirm:string;kind:'primary'|'secondary'|'danger'};
 const ops:Op[]=[];
 if(['raw','ai_refined'].includes(q.status))ops.push({value:'submit_review',label:'Submit for review',confirm:'Submit for review',kind:'primary'});
 if(q.status==='in_review')ops.push({value:'approve',label:'Approve',confirm:'Approve question',kind:'primary'},{value:'request_changes',label:'Request changes',confirm:'Send back with changes',kind:'secondary'});
 if(q.status==='approved'){if(manager)ops.push({value:'publish',label:'Publish to students',confirm:'Publish now',kind:'primary'});ops.push({value:'request_changes',label:'Request changes',confirm:'Send back with changes',kind:'secondary'});}
 if(q.status==='published'&&manager)ops.push({value:'retire',label:'Retire question',confirm:'Retire question',kind:'danger'});
 if(['raw','ai_refined','in_review','approved'].includes(q.status))ops.push({value:'reject',label:'Reject draft',confirm:'Reject draft',kind:'danger'});
 const chosen=ops.find(o=>o.value===operation);const LETTERS='ABCDE';
 return <section className="studio-review"><div><h3>Human review</h3><p>{q.status==='approved'&&!manager?'Approved. A content manager or Super Admin can publish this question.':q.status==='retired'?'This question has been retired. Students no longer receive it.':q.status==='rejected'?'This draft was rejected and will never reach students.':q.status==='published'?'Live for students. Retiring removes it from new sessions; past results keep it.':'Approval and publication are separate steps. Verify the answer, explanation and references before moving it forward.'}</p></div>
  {ops.length>0&&<form action={action}><input type="hidden" name="questionId" value={q.id}/><input type="hidden" name="versionId" value={q.versionId}/><input type="hidden" name="action" value={operation}/>
   <fieldset disabled={disabled||pending}><legend className="studio-sr-only">Review action</legend>
    {!chosen?<div className="studio-review-actions">{ops.filter(o=>o.kind!=='danger').map(o=><button key={o.value} type="button" className={o.kind==='primary'?'studio-button':'studio-button studio-button-secondary'} onClick={()=>setOperation(o.value)}>{o.label}</button>)}
      {ops.filter(o=>o.kind==='danger').map(o=><button key={o.value} type="button" className="studio-link-button studio-danger-link" onClick={()=>setOperation(o.value)}>{o.label}</button>)}</div>
    :<div className={`studio-review-check is-${chosen.kind}`}>
      {operation==='approve'&&<label className="studio-check"><input type="checkbox" name="reviewed" value="true" required/>I have verified the answer, explanation and references.</label>}
      {(operation==='request_changes'||operation==='reject')&&<label className="studio-field">{operation==='reject'?'Reason for rejection':'Changes required'}<textarea name="note" required rows={3} maxLength={2000}/></label>}
      {operation==='publish'&&<div className="studio-preview"><p className="studio-help">Students will see this question, with {q.correctAnswer===null?'no answer set':`option ${LETTERS[q.correctAnswer]} as the answer`}:</p><p className="studio-preview-stem">{q.stem}</p><ol>{q.options.filter(Boolean).map((o,i)=><li key={i} className={i===q.correctAnswer?'is-answer':undefined}><span>{LETTERS[i]}</span>{o}</li>)}</ol></div>}
      {operation==='retire'&&<p className="studio-help">New sessions stop including it straight away. Students who already answered it keep their results.</p>}
      {operation==='submit_review'&&<p className="studio-help">A reviewer checks it next. You can still edit it, which returns it to draft.</p>}
      <div className="studio-review-actions"><button className={chosen.kind==='danger'?'studio-button security-danger':'studio-button'}>{pending?'Applying…':chosen.confirm}</button><button type="button" className="studio-link-button" onClick={()=>setOperation('')}>Cancel</button></div></div>}
   </fieldset>{disabled&&<p className="studio-help">Save your changes to enable review actions.</p>}<Result state={state}/></form>}</section>;
}
export function GrantAccess({exams}:{exams:{id:string;name:string}[]}){
 const[state,action,pending]=useActionState(grantAccess,{});
 return <form action={action}><label className="studio-field">Verified account email<input name="email" type="email" required autoComplete="off"/></label><label className="studio-field">Exam<select name="examId" required defaultValue=""><option value="" disabled>Choose an exam</option>{exams.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label className="studio-field">Days<input name="days" type="number" min={1} max={366} defaultValue={30} required/></label><Result state={state}/><button className="studio-button" disabled={pending}>{pending?'Granting…':'Grant complimentary access'}</button><p className="studio-help">For internal testing and support. Recorded in the audit log. Not a payment.</p></form>;
}
export function RecallUpload({exams}:{exams:{id:string;name:string;sittings:{id:string;label:string}[]}[]}){
 const[state,action,pending]=useActionState(uploadRecalls,{});const[examId,setExamId]=useState(exams[0]?.id??'');const sittings=exams.find(e=>e.id===examId)?.sittings??[];const[requestId,setRequestId]=useState('');const form=useRef<HTMLFormElement>(null);const handled=useRef<string|undefined>(undefined);const router=useRouter();
 useEffect(()=>setRequestId(crypto.randomUUID()),[]);
 useEffect(()=>{if(state.jobId&&state.jobId!==handled.current){handled.current=state.jobId;form.current?.reset();setRequestId(crypto.randomUUID());router.refresh();}},[state.jobId,router]);
 return <form ref={form} action={action}><input type="hidden" name="requestId" value={requestId}/>
  <label className="studio-field">Exam<select name="examId" required value={examId} onChange={e=>setExamId(e.target.value)}>{exams.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
  <label className="studio-field"><span>Sitting <small>optional</small></span><select name="sittingId" defaultValue="" key={examId}><option value="">Not known</option>{sittings.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select><span className="studio-help">Drafts are tagged with this sitting. Add sittings in the exam catalogue.</span></label>
  <label className="studio-field">Recall files<input name="file" type="file" multiple accept=".txt,.csv,.tsv,.md,.pdf,.docx,.png,.jpg,.jpeg,.webp,.gif,text/plain,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp,image/gif"/><span className="studio-help">Chat exports (.txt), PDF, Word (.docx), CSV or Markdown, plus scanned PDFs, photos and screenshots (PNG, JPG, WebP). Up to 10 files and 4 MB in total. Claude reads scans and images first; the files themselves are not stored.</span></label>
  <label className="studio-field">Or paste recall text<textarea name="sourceText" rows={6} maxLength={60000}/></label>
  <label className="studio-field">Source label<input name="sourceLabel" maxLength={200} placeholder="e.g. September 2026 candidate group"/></label>
  <label className="studio-field"><span>Other sitting hint <small>optional</small></span><input name="sittingHint" maxLength={120} placeholder="e.g. September 2026"/></label>
  <p className="studio-help">Names, phone numbers, emails, @mentions and links are removed before anything is stored or sent to Claude. Claude only drafts; every question needs human review and publication.</p>
  <Result state={state}/><button className="studio-button" disabled={pending||!requestId||!exams.length}>{pending?'Uploading…':'Draft questions with Claude'}</button></form>;
}
const JOB_STEPS=['queued','extracting','refining','deduping','ready'];
export function JobList({jobs,manager}:{jobs:StudioJob[];manager:boolean}){
 const router=useRouter();const[notice,setNotice]=useState('');const[busy,setBusy]=useState('');
 const active=jobs.some(j=>!['ready','failed'].includes(j.status)&&!j.stalled);
 // Poll while Claude is working so status and new drafts appear without a manual reload.
 useEffect(()=>{if(!active)return;const id=setInterval(()=>router.refresh(),3000);return()=>clearInterval(id);},[active,router]);
 if(!jobs.length)return <p className="studio-help">No AI jobs yet.</p>;
 return <>{notice&&<p className="studio-feedback studio-error" role="alert">{notice}</p>}<ul className="studio-jobs" aria-live="polite">{jobs.map(j=>{const step=JOB_STEPS.indexOf(j.status);return <li key={j.id} className={`studio-job is-${j.stalled?'failed':j.status}`}>
  <strong>{j.sourceLabel}</strong><span>{j.examName}{j.fileName?` · ${j.fileName}`:''}</span>
  {j.status==='failed'||j.stalled?<span className="studio-job-error">{j.stalled?'This job stopped responding.':j.error}</span>
   :j.status==='ready'?<span>{j.draftCount} draft{j.draftCount===1?'':'s'} ready for review{j.redactions?` · ${j.redactions} identifier${j.redactions===1?'':'s'} removed`:''}</span>
   :<span className="studio-job-progress"><span className="studio-job-bar" style={{width:`${Math.max(1,step)*25}%`}}/><em>{j.status==='queued'?'Queued':j.status==='extracting'?'Extracting recalls':j.status==='refining'?'Claude is drafting questions…':'Checking for duplicates'}</em></span>}
  {(j.status==='failed'||j.stalled)&&manager&&<button type="button" className="studio-link-button" disabled={busy===j.id} onClick={async()=>{setBusy(j.id);const r=await retryJob(j.id);setBusy('');if(r.error)setNotice(r.error);else{setNotice('');router.refresh();}}}>{busy===j.id?'Retrying…':'Retry'}</button>}
 </li>;})}</ul></>;
}
function AiPanel({question:q}:{question:StudioQuestion}){
 const m=q.aiMeta!;const confidence=q.confidence??0;
 return <section className="studio-ai" aria-label="AI draft details"><div className="studio-ai-head"><p className="studio-ai-title">AI draft · {m.kind==='refine'?'refined on request':'from upload'}{m.editedByHuman?' · edited by staff':''}</p>
  <div className="studio-ai-chips"><span className={`studio-chip ${confidence<80?'is-low':'is-ok'}`}>Confidence {q.confidence??'—'}</span>{q.needsExpert&&<span className="studio-chip is-low">Needs expert</span>}{m.topic&&<span className="studio-chip">{m.topic}</span>}{m.difficulty&&<span className="studio-chip">{m.difficulty}</span>}{m.duplicateOf&&<a className="studio-chip is-low" href={`/studio?question=${m.duplicateOf}`}>Possible duplicate</a>}</div></div>
  {m.issues.length>0&&<><h3>Check before approving</h3><ul>{m.issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul></>}
  {m.instruction&&<p className="studio-help">Instruction given: “{m.instruction}”</p>}
  <p className="studio-help">Drafted by {m.model} on {new Date(m.generatedAt).toLocaleString('en-GB',{timeZone:'UTC'})} UTC. The confidence score is the model’s own estimate, not a verification.</p></section>;
}
function RefinePanel({question:q,disabled}:{question:StudioQuestion;disabled:boolean}){
 const[state,action,pending]=useActionState(refineWithAI,{});const router=useRouter();const form=useRef<HTMLFormElement>(null);
 useEffect(()=>{if(state.success){form.current?.reset();router.refresh();}},[state,router]);
 return <section className="studio-refine"><div><h3>Ask Claude for a better draft</h3><p className="studio-help">Claude rewrites the question from the original evidence and your instructions. The result is a new version that still needs review.</p></div>
  <form ref={form} action={action}><input type="hidden" name="questionId" value={q.id}/><input type="hidden" name="versionId" value={q.versionId}/><fieldset disabled={disabled||pending}><legend className="studio-sr-only">Refine with Claude</legend>
   <label className="studio-field"><span>Instructions <small>optional</small></span><textarea name="instruction" rows={3} maxLength={2000} placeholder="e.g. Make the distractors closer to the correct answer and shorten the stem."/></label>
   <button className="studio-button studio-button-secondary">{pending?'Claude is working… (up to a minute)':'Refine with Claude'}</button></fieldset>
   {disabled&&!pending&&<p className="studio-help">Save your changes before asking Claude.</p>}<Result state={state}/></form></section>;
}
function TagsPanel({question:q,taxonomy}:{question:StudioQuestion;taxonomy:Taxonomy}){
 const[state,action,pending]=useActionState(saveTags,{});const router=useRouter();useEffect(()=>{if(state.success)router.refresh();},[state,router]);
 return <section className="studio-tags"><div><h3>Topic and sittings</h3><p className="studio-help">Tags never change the question version or its status. “Seen in”, high-yield and year/diet filters come from the sittings.</p>{q.aiMeta?.proposedTopic&&<p className="studio-help">Claude proposed a new topic: “{q.aiMeta.proposedTopic}”. Add it in the exam catalogue if it belongs.</p>}</div>
  <form action={action}><input type="hidden" name="questionId" value={q.id}/><fieldset disabled={pending}><legend className="studio-sr-only">Question tags</legend>
   <div className="catalogue-grid"><label className="studio-field">Topic<select name="topicId" defaultValue={q.topicId??''}><option value="">Untagged</option>{taxonomy.topics.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
    <label className="studio-field">Difficulty<select name="difficulty" defaultValue={q.difficulty??''}><option value="">Not set</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label></div>
   <fieldset className="studio-sittings"><legend>Seen in sittings</legend>{taxonomy.sittings.length?taxonomy.sittings.map(s=><label key={s.id} className="studio-check"><input type="checkbox" name="sittingIds" value={s.id} defaultChecked={q.sittingIds.includes(s.id)}/>{s.label}</label>):<p className="studio-help">No sittings exist for this exam yet. Add them in the exam catalogue.</p>}</fieldset>
   <button className="studio-button studio-button-secondary">{pending?'Saving…':'Save tags'}</button></fieldset><Result state={state}/></form></section>;
}

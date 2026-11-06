'use client';
import {useActionState,useEffect,useRef,useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {addExam,addSitting,addTopic,saveExamSettings,toggleSitting} from '@/app/studio/catalogue/actions';
import type {CatalogueExam} from '@/lib/services/catalogue-admin';
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
function Result({state}:{state:{error?:string;success?:string}}){return <>{state.error&&<p className="studio-feedback studio-error" role="alert">{state.error}</p>}{state.success&&<p className="studio-feedback" role="status">{state.success}</p>}</>;}
function useRefreshOnSuccess(state:{success?:string},reset?:()=>void){const router=useRouter();useEffect(()=>{if(state.success){reset?.();router.refresh();}},[state,router,reset]);}
function NumberField({label,name,value,help,min,max,step}:{label:string;name:string;value:number|undefined;help?:string;min:number;max:number;step?:number}){
 return <label className="studio-field">{label}<input name={name} type="number" min={min} max={max} step={step??1} defaultValue={value??''} inputMode="decimal"/>{help&&<span className="studio-help">{help}</span>}</label>;
}
export function ExamSettingsForm({exam,manager,superAdmin}:{exam:CatalogueExam;manager:boolean;superAdmin:boolean}){
 const[state,action,pending]=useActionState(saveExamSettings,{});useRefreshOnSuccess(state);const s=exam.settings,trial={enabled:false,days:3,questionLimit:50,mockSize:25,...(s.trial??{})};
 return <form action={action} className="catalogue-form"><input type="hidden" name="examId" value={exam.id}/><fieldset disabled={!manager||pending}><legend className="studio-sr-only">Exam settings for {exam.name}</legend>
  <h3>Exam Mode</h3><p className="studio-help">Enter the real exam values once the exam team confirms them. Leave a field blank if it is not known; Exam Mode stays off until both questions and duration are set.</p>
  <div className="catalogue-grid"><NumberField label="Questions in the real paper" name="questionCount" value={exam.questionCount??undefined} min={1} max={1000}/><NumberField label="Duration (minutes)" name="durationMinutes" value={s.durationMinutes} min={1} max={600}/><NumberField label="Pass mark (%)" name="passMarkPercent" value={s.passMarkPercent} min={1} max={100} step={0.1} help="Optional. Shown only where the exam publishes one."/></div>
  <h3>Content rules</h3><div className="catalogue-grid"><NumberField label="High-yield after (sittings)" name="highYieldMin" value={s.highYieldMin} min={2} max={20} help="Default 2."/><NumberField label="Needs expert below (confidence)" name="needsExpertBelow" value={s.needsExpertBelow} min={1} max={100} help="Default 80."/></div>
  <label className="studio-field">Approved reference sources<textarea name="approvedSources" rows={4} defaultValue={(s.approvedSources??[]).join('\n')} placeholder={'One per line, e.g.\nRCOG Green-top Guidelines\nNICE'}/><span className="studio-help">Claude may cite only these. References that do not match are flagged for review.</span></label>
  <label className="studio-field">House style notes for Claude<textarea name="styleNotes" rows={3} defaultValue={s.styleProfile?.notes??''} maxLength={4000}/></label>
  {superAdmin&&<><h3>Free trial</h3><label className="studio-check"><input type="checkbox" name="trialEnabled" value="true" defaultChecked={trial.enabled}/>Offer a free trial for this exam (no card)</label>
   <div className="catalogue-grid"><NumberField label="Trial length (days)" name="trialDays" value={trial.days} min={1} max={30}/><NumberField label="Question limit" name="trialQuestionLimit" value={trial.questionLimit} min={1} max={500}/><NumberField label="Mini mock size" name="trialMockSize" value={trial.mockSize} min={1} max={200}/></div>
   <p className="studio-help">Trial questions come only from sittings marked “In trial pool” below. Students get one trial per exam.</p></>}
  {!superAdmin&&s.trial?.enabled&&<p className="studio-help">Free trial is on: {trial.days} days or {trial.questionLimit} questions. A Super Admin can change this.</p>}
  <Result state={state}/>{manager&&<button className="studio-button">{pending?'Saving…':'Save exam settings'}</button>}</fieldset></form>;
}
export function SittingList({exam,manager}:{exam:CatalogueExam;manager:boolean}){
 const router=useRouter();const[busy,start]=useTransition();const[notice,setNotice]=useState('');
 const toggle=(id:string,changes:{published?:boolean;trialPool?:boolean})=>start(async()=>{const r=await toggleSitting(id,changes);setNotice(r.error??'');if(!r.error)router.refresh();});
 return <>{notice&&<p className="studio-feedback studio-error" role="alert">{notice}</p>}{exam.sittings.length?<table className="catalogue-table"><thead><tr><th scope="col">Sitting</th><th scope="col">Questions</th><th scope="col">On website</th><th scope="col">In trial pool</th></tr></thead><tbody>{exam.sittings.map(s=><tr key={s.id}><th scope="row">{s.label}</th><td>{s.questions}</td>
  <td><input type="checkbox" aria-label={`Show ${s.label} on the website`} checked={s.published} disabled={!manager||busy} onChange={e=>toggle(s.id,{published:e.target.checked})}/></td>
  <td><input type="checkbox" aria-label={`Use ${s.label} questions in the free trial`} checked={s.trialPool} disabled={!manager||busy} onChange={e=>toggle(s.id,{trialPool:e.target.checked})}/></td></tr>)}</tbody></table>:<p className="studio-help">No sittings yet.</p>}
  {manager&&<AddSitting examId={exam.id}/>}</>;
}
function AddSitting({examId}:{examId:string}){
 const form=useRef<HTMLFormElement>(null);const[state,action,pending]=useActionState(addSitting,{});useRefreshOnSuccess(state,()=>form.current?.reset());const year=new Date().getFullYear();
 return <form ref={form} action={action} className="catalogue-inline"><input type="hidden" name="examId" value={examId}/><label className="studio-field">Month<select name="month" required defaultValue="">{<option value="" disabled>Month</option>}{MONTHS.map((m,i)=><option key={m} value={i+1}>{m}</option>)}</select></label><label className="studio-field">Year<input name="year" type="number" min={1990} max={2100} defaultValue={year} required/></label><label className="studio-field"><span>Label <small>optional</small></span><input name="label" maxLength={120} placeholder="e.g. September 2026"/></label><button className="studio-button studio-button-secondary" disabled={pending}>{pending?'Adding…':'Add sitting'}</button><Result state={state}/></form>;
}
export function TopicList({exam,manager}:{exam:CatalogueExam;manager:boolean}){
 const parents=exam.topics.filter(t=>!t.parentId);
 return <>{parents.length?<ul className="catalogue-topics">{parents.map(p=><li key={p.id}><strong>{p.name}</strong> <small>{p.questions}</small>{exam.topics.some(t=>t.parentId===p.id)&&<ul>{exam.topics.filter(t=>t.parentId===p.id).map(t=><li key={t.id}>{t.name} <small>{t.questions}</small></li>)}</ul>}</li>)}</ul>:<p className="studio-help">No topics yet. Claude suggests topics freely until a list exists; once it does, Claude must choose from it.</p>}
  {manager&&<AddTopic examId={exam.id} parents={parents}/>}</>;
}
function AddTopic({examId,parents}:{examId:string;parents:{id:string;name:string}[]}){
 const form=useRef<HTMLFormElement>(null);const[state,action,pending]=useActionState(addTopic,{});useRefreshOnSuccess(state,()=>form.current?.reset());
 return <form ref={form} action={action} className="catalogue-inline"><input type="hidden" name="examId" value={examId}/><label className="studio-field">Topic name<input name="name" required maxLength={120}/></label><label className="studio-field"><span>Under <small>optional</small></span><select name="parentId" defaultValue=""><option value="">Top level</option>{parents.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="studio-button studio-button-secondary" disabled={pending}>{pending?'Adding…':'Add topic'}</button><Result state={state}/></form>;
}
// R3: a Super Admin adds an exam, and its family when it is new. It starts planned, with nothing for sale.
export function NewExamForm({families}:{families:{slug:string;name:string}[]}){
 const[state,action,pending]=useActionState(addExam,{});const router=useRouter();const[family,setFamily]=useState(families[0]?.slug??'');
 useEffect(()=>{if(state.slug)router.push(`/studio/catalogue?exam=${state.slug}`);},[state,router]);
 const isNew=!families.some(f=>f.slug===family);
 return <form action={action} className="students-form">
  <div className="catalogue-inline students-inline">
   <label className="studio-field">Family<select value={families.some(f=>f.slug===family)?family:'__new'} onChange={e=>setFamily(e.target.value==='__new'?'':e.target.value)}>{families.map(f=><option key={f.slug} value={f.slug}>{f.name}</option>)}<option value="__new">New family…</option></select></label>
   {isNew&&<><label className="studio-field">Family name<input name="familyName" required maxLength={80} placeholder="e.g. PLAB"/></label></>}
  </div>
  <input type="hidden" name="familySlug" value={family}/>
  {isNew&&<label className="studio-field">Family address <span className="studio-help">used in page addresses, e.g. plab</span><input required maxLength={40} pattern="[a-z0-9\-]+" value={family} onChange={e=>setFamily(e.target.value.toLowerCase())}/></label>}
  <div className="catalogue-inline students-inline">
   <label className="studio-field">Exam name<input name="name" required maxLength={120} placeholder="e.g. PLAB 1"/></label>
   <label className="studio-field">Exam address <span className="studio-help">starts with the family</span><input name="slug" maxLength={80} placeholder={family?`${family}-1`:''} pattern="[a-z0-9\-]*"/></label>
  </div>
  <label className="studio-field">Description <span className="studio-help">shown on its website page</span><textarea name="description" rows={3} required maxLength={600}/></label>
  {state.error&&<p className="studio-feedback studio-error" role="alert">{state.error}</p>}
  <button className="studio-button studio-button-secondary" disabled={pending}>{pending?'Adding…':'Add exam'}</button></form>;
}

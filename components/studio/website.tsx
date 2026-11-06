'use client';
import {useActionState,useEffect,useRef,useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {createFaq,createRedirect,removeFaq,removeRedirect,saveMeta,savePage} from '@/app/studio/website/actions';
function Result({state}:{state:{error?:string;success?:string}}){return <>{state.error&&<p className="studio-feedback studio-error" role="alert">{state.error}</p>}{state.success&&<p className="studio-feedback" role="status">{state.success}</p>}</>;}
function useRefresh(state:{success?:string},reset?:()=>void){const router=useRouter();useEffect(()=>{if(state.success){reset?.();router.refresh();}},[state,router,reset]);}
type PageRow={label:string;path:string;title:string|null;description:string|null;h1:string|null};
export function MetaEditor({pages}:{pages:PageRow[]}){
 const[path,setPath]=useState(pages[0]?.path??'/');const page=pages.find(p=>p.path===path)??pages[0];
 const[state,action,pending]=useActionState(saveMeta,{});useRefresh(state);const[title,setTitle]=useState(page?.title??'');const[description,setDescription]=useState(page?.description??'');
 useEffect(()=>{setTitle(page?.title??'');setDescription(page?.description??'');},[page]);
 return <form action={action} key={path}><label className="studio-field">Page<select name="path" value={path} onChange={e=>setPath(e.target.value)}>{pages.map(p=><option key={p.path} value={p.path}>{p.label} — {p.path}{p.title||p.description||p.h1?' · customised':''}</option>)}</select></label>
  <label className="studio-field"><span>Search title <small>{title.length}/70 · blank uses the default</small></span><input name="title" maxLength={70} value={title} onChange={e=>setTitle(e.target.value)}/></label>
  <label className="studio-field"><span>Meta description <small>{description.length}/170</small></span><textarea name="description" rows={3} maxLength={170} value={description} onChange={e=>setDescription(e.target.value)}/></label>
  <label className="studio-field">Page heading (H1)<input name="h1" maxLength={120} defaultValue={page?.h1??''}/></label>
  <div className="website-preview" aria-label="Search result preview"><span className="website-preview-url">{path}</span><strong>{title||'Default title'}</strong><span>{description||'Default description generated from the page content.'}</span></div>
  <Result state={state}/><button className="studio-button" disabled={pending}>{pending?'Saving…':'Save search settings'}</button><a className="studio-link-button" href={path} target="_blank" rel="noreferrer">View page ↗</a></form>;
}
export function PageEditor({pages}:{pages:{slug:string;title:string;body:string;updatedAt:string}[]}){
 const[slug,setSlug]=useState(pages[0]?.slug??'');const page=pages.find(p=>p.slug===slug);const[state,action,pending]=useActionState(savePage,{});useRefresh(state);
 if(!page)return null;
 return <form action={action} key={slug}><label className="studio-field">Page<select name="slug" value={slug} onChange={e=>setSlug(e.target.value)}>{pages.map(p=><option key={p.slug} value={p.slug}>{p.title} (/{p.slug})</option>)}</select></label>
  <label className="studio-field">Title<input name="title" required maxLength={120} defaultValue={page.title}/></label>
  <label className="studio-field">Text<textarea name="body" required rows={16} maxLength={40000} defaultValue={page.body}/><span className="studio-help">Leave a blank line between paragraphs. Start a line with “## ” for a heading and “- ” for a bullet. HTML is not used.</span></label>
  <p className="studio-help">Last updated {new Date(page.updatedAt).toLocaleString('en-GB',{timeZone:'UTC'})} UTC. Policy pages are drafts until reviewed by a lawyer.</p>
  <Result state={state}/><button className="studio-button" disabled={pending}>{pending?'Publishing…':'Publish page'}</button><a className="studio-link-button" href={`/${slug}`} target="_blank" rel="noreferrer">View page ↗</a></form>;
}
export function FaqEditor({faqs,exams}:{faqs:{id:string;question:string;answer:string;exam:string|null}[];exams:{id:string;name:string}[]}){
 const router=useRouter();const[busy,start]=useTransition();const[notice,setNotice]=useState('');const form=useRef<HTMLFormElement>(null);
 const[state,action,pending]=useActionState(createFaq,{});useRefresh(state,()=>form.current?.reset());
 return <><ul className="security-list">{faqs.map(f=><li key={f.id}><div className="security-row"><strong>{f.question}</strong><span>{f.exam??'All pages'}</span></div><p className="studio-help">{f.answer}</p>
  <button type="button" className="studio-link-button" disabled={busy} onClick={()=>{if(confirm('Remove this FAQ?'))start(async()=>{const r=await removeFaq(f.id);setNotice(r.error??'');if(!r.error)router.refresh();});}}>Remove</button></li>)}</ul>{notice&&<p className="studio-feedback studio-error" role="alert">{notice}</p>}
  <form ref={form} action={action} className="website-add"><h3>Add a question</h3><label className="studio-field">Show on<select name="examId" defaultValue=""><option value="">FAQ page and every exam page</option>{exams.map(e=><option key={e.id} value={e.id}>{e.name} page only</option>)}</select></label>
   <label className="studio-field">Question<input name="question" required maxLength={300}/></label><label className="studio-field">Answer<textarea name="answer" required rows={3} maxLength={3000}/></label><Result state={state}/><button className="studio-button studio-button-secondary" disabled={pending}>{pending?'Adding…':'Add FAQ'}</button></form></>;
}
export function RedirectEditor({redirects}:{redirects:{from:string;to:string}[]}){
 const router=useRouter();const[busy,start]=useTransition();const[notice,setNotice]=useState('');const form=useRef<HTMLFormElement>(null);
 const[state,action,pending]=useActionState(createRedirect,{});useRefresh(state,()=>form.current?.reset());
 return <>{redirects.length?<table className="catalogue-table"><thead><tr><th scope="col">Old address</th><th scope="col">Moves permanently to</th><th scope="col"><span className="studio-sr-only">Remove</span></th></tr></thead><tbody>{redirects.map(r=><tr key={r.from}><td>{r.from}</td><td>{r.to}</td><td><button type="button" className="studio-link-button" disabled={busy} onClick={()=>start(async()=>{const res=await removeRedirect(r.from);setNotice(res.error??'');if(!res.error)router.refresh();})}>Remove</button></td></tr>)}</tbody></table>:<p className="studio-help">No redirects yet.</p>}
  {notice&&<p className="studio-feedback studio-error" role="alert">{notice}</p>}
  <form ref={form} action={action} className="catalogue-inline"><label className="studio-field">Old address<input name="from" required placeholder="/mrcog/old-page" maxLength={200}/></label><label className="studio-field">New address<input name="to" required placeholder="/mrcog/part-1-recalls" maxLength={200}/></label><button className="studio-button studio-button-secondary" disabled={pending}>{pending?'Saving…':'Add redirect'}</button><Result state={state}/></form>
  <p className="studio-help">Use this when a page address changes, so search rankings and old links carry over. Redirects apply to addresses up to three levels deep that no longer exist.</p></>;
}

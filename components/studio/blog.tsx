'use client';
import Link from 'next/link';
import {useActionState,useEffect,useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {draftReport,publishPost,savePostAction,toggleSample} from '@/app/studio/website/actions';
import type {Post} from '@/lib/services/content-site';
type Result={error?:string;success?:string;postId?:string};
function Notice({state}:{state:Result}){return <>{state.error&&<p className="studio-feedback studio-error" role="alert">{state.error}</p>}{state.success&&<p className="studio-feedback" role="status">{state.success}</p>}</>;}
const KIND:Record<string,string>={post:'Article',guide:'Guide',sitting_report:'Sitting report'};
// SEO-2: write, publish and unpublish posts. The body uses ## headings, - lists, **bold** and [links](/path).
export function BlogEditor({posts,post,isNew=false,exams}:{posts:Post[];post:Post|null;isNew?:boolean;exams:{id:string;name:string;sittings:{id:string;label:string}[]}[]}){
 const[state,action,pending]=useActionState(savePostAction,{});const router=useRouter();const[busy,start]=useTransition();const[notice,setNotice]=useState<Result>({});
 const[examId,setExamId]=useState(post?.examId??'');const exam=exams.find(e=>e.id===examId);
 useEffect(()=>{if(state.postId&&state.postId!==post?.id)router.push(`/studio/website?post=${state.postId}#blog`);else if(state.success)router.refresh();},[state,router,post?.id]);
 const run=(fn:()=>Promise<Result>)=>start(async()=>{const r=await fn();setNotice(r);if(r.postId)router.push(`/studio/website?post=${r.postId}#blog`);else if(!r.error)router.refresh();});
 return <div className="blog-admin">
  <ul className="security-list">{posts.map(p=><li key={p.id}><div className="security-row"><Link href={`/studio/website?post=${p.id}#blog`} aria-current={p.id===post?.id?'page':undefined}><strong>{p.title}</strong></Link><span>{KIND[p.kind]} · {p.status==='published'?'Published':'Draft'}</span></div></li>)}
   {!posts.length&&<li><p className="studio-help">No posts yet.</p></li>}</ul>
  <p><Link className="studio-link-button" href="/studio/website?post=new#blog">New post</Link></p>
  {exams.some(e=>e.sittings.length)&&<details className="studio-history"><summary>Draft a “What came up” report for a sitting</summary><ul className="blog-sittings">{exams.flatMap(e=>e.sittings.map(s=><li key={s.id}><span>{e.name} · {s.label}</span><button type="button" className="studio-link-button" disabled={busy} onClick={()=>run(()=>draftReport(s.id))}>Draft report</button></li>))}</ul>
   <p className="studio-help">The draft lists the topics and figures from the catalogue. Add the commentary before publishing; never quote paid questions.</p></details>}
  <Notice state={notice}/>
  {(post||isNew||posts.length===0)&&<form action={action} className="students-form" key={post?.id??'new'}><input type="hidden" name="id" value={post?.id??''}/>
   <label className="studio-field">Title<input name="title" required maxLength={160} defaultValue={post?.title}/></label>
   <div className="catalogue-inline students-inline">
    <label className="studio-field">Address <span className="studio-help">/blog/…, from the title if blank</span><input name="slug" maxLength={80} defaultValue={post?.slug} pattern="[a-z0-9\-]*"/></label>
    <label className="studio-field">Kind<select name="kind" defaultValue={post?.kind??'guide'}><option value="guide">Guide</option><option value="post">Article</option><option value="sitting_report">Sitting report</option></select></label>
   </div>
   <div className="catalogue-inline students-inline">
    <label className="studio-field">Exam <span className="studio-help">optional</span><select name="examId" value={examId} onChange={e=>setExamId(e.target.value)}><option value="">None</option>{exams.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    <label className="studio-field">Sitting <span className="studio-help">optional</span><select name="sittingId" defaultValue={post?.sittingId??''} key={examId}><option value="">None</option>{exam?.sittings.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
   </div>
   <label className="studio-field">Summary <span className="studio-help">shown in lists and search results, up to 300 characters</span><textarea name="excerpt" rows={2} maxLength={300} defaultValue={post?.excerpt}/></label>
   <label className="studio-field">Body <span className="studio-help">## heading, - list item, **bold**, [link text](/path)</span><textarea name="body" rows={16} defaultValue={post?.body} className="blog-body"/></label>
   <Notice state={state}/>
   <div className="paper-actions"><button className="studio-button" disabled={pending}>{pending?'Saving…':'Save'}</button>
    {post&&(post.status==='published'?<><button type="button" className="studio-button studio-button-secondary" disabled={busy} onClick={()=>run(()=>publishPost(post.id,false))}>Unpublish</button><a className="studio-link-button" href={`/blog/${post.slug}`} target="_blank" rel="noreferrer">View ↗</a></>
     :<button type="button" className="studio-button studio-button-secondary" disabled={busy} onClick={()=>run(()=>publishPost(post.id,true))}>Publish</button>)}</div>
  </form>}
 </div>;
}
// SEO-2: a content manager chooses which published questions are free, public samples.
export function SampleToggle({questionId,on}:{questionId:string;on:boolean}){
 const router=useRouter();const[busy,start]=useTransition();const[state,setState]=useState<Result>({});const[confirm,setConfirm]=useState(false);
 const go=(next:boolean)=>start(async()=>{const r=await toggleSample(questionId,next);setState(r);setConfirm(false);if(!r.error)router.refresh();});
 return <div className="sample-toggle"><h3>Free sample</h3>
  <p className="studio-help">{on?'Public on its topic page and its own page, answer and explanation included.':'A free sample is public: anyone can read it, answer included. Choose questions the reviewer has confirmed for the website.'}</p>
  {on?<button type="button" className="studio-button studio-button-secondary" disabled={busy} onClick={()=>go(false)}>Remove from the website</button>
   :confirm?<div className="paper-actions"><button type="button" className="studio-button" disabled={busy} onClick={()=>go(true)}>Yes, make it public</button><button type="button" className="studio-link-button" onClick={()=>setConfirm(false)}>Cancel</button></div>
   :<button type="button" className="studio-button studio-button-secondary" onClick={()=>setConfirm(true)}>Make it a free sample</button>}
  <Notice state={state}/></div>;
}

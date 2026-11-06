'use client';
import Link from 'next/link';
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {moderate} from '@/app/studio/actions';
// STU-15: comments wait here until a staff member approves or rejects them.
export function CommentQueue({comments}:{comments:{id:string;questionId:string;examName:string;stem:string;body:string;createdAt:string}[]}){
 const router=useRouter();const[busy,start]=useTransition();const[error,setError]=useState('');
 if(!comments.length)return <p className="studio-help">No comments waiting.</p>;
 const go=(id:string,ok:boolean)=>start(async()=>{const r=await moderate(id,ok);if(r.error)setError(r.error);else{setError('');router.refresh();}});
 return <><ul className="studio-jobs studio-reports">{comments.map(c=><li key={c.id} className="studio-job">
  <span className="studio-report-details">“{c.body}”</span>
  <span><Link href={`/studio?question=${c.questionId}`}>{c.stem}</Link></span>
  <span>{c.examName} · {new Date(c.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span>
  <span className="studio-report-actions"><button type="button" className="studio-button studio-button-secondary studio-button-small" disabled={busy} onClick={()=>go(c.id,true)}>Approve</button><button type="button" className="studio-button studio-button-secondary studio-button-small" disabled={busy} onClick={()=>go(c.id,false)}>Reject</button></span>
 </li>)}</ul>{error&&<p className="studio-feedback" role="alert">{error}</p>}</>;
}

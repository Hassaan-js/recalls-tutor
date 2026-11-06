'use client';
import Link from 'next/link';
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {closeReport} from '@/app/studio/actions';
import {DraftFixButton} from './proposals';
import type {QuestionReport} from '@/lib/services/student';
const REASON:Record<string,string>={wrong_answer:'Marked answer is wrong',unclear:'Unclear question or options',typo:'Spelling or formatting',outdated:'Out of date',other:'Something else'};
// STU-5 / ADM-6: what students reported, newest first. Fixing means editing the question; closing records the outcome.
export function ReportList({reports,status}:{reports:QuestionReport[];status?:string}){
 const router=useRouter();const[busy,start]=useTransition();const[error,setError]=useState('');
 if(!reports.length)return <p className="studio-help">No open reports from students.</p>;
 const close=(id:string,outcome:'resolved'|'dismissed')=>start(async()=>{const r=await closeReport(id,outcome);if(r.error)setError(r.error);else{setError('');router.refresh();}});
 return <><ul className="studio-jobs studio-reports">{reports.map(r=><li key={r.id} className="studio-job is-failed">
  <strong>{REASON[r.reason]??r.reason}</strong>
  <span><Link href={`/studio?question=${r.questionId}${status?`&status=${status}`:''}`}>{r.stem||'Untitled question'}</Link></span>
  {r.details&&<span className="studio-report-details">“{r.details}”</span>}
  <span>{r.examName} · seen on v{r.version}{r.currentVersion!==null&&r.currentVersion!==r.version?`, now v${r.currentVersion}`:''} · {new Date(r.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span>
  <span className="studio-report-actions"><DraftFixButton reportId={r.id}/><button type="button" className="studio-button studio-button-secondary studio-button-small" disabled={busy} onClick={()=>close(r.id,'resolved')}>Mark fixed</button><button type="button" className="studio-button studio-button-secondary studio-button-small" disabled={busy} onClick={()=>close(r.id,'dismissed')}>Dismiss</button></span>
 </li>)}</ul>{error&&<p className="studio-feedback" role="alert">{error}</p>}</>;
}

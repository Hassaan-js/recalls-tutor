import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {SuspendedNotice} from '@/components/auth/suspended';
import {getDatabase} from '@/lib/db/client';
import {listAttemptHistory,listPracticeExams,type HistoryFilter,type HistoryRow} from '@/lib/services/practice';
import {StudentShell} from '@/components/practice/shell';
export const metadata={title:'Sessions and results',robots:{index:false}};
export const dynamic='force-dynamic';
const FILTERS:{key:HistoryFilter;label:string}[]=[{key:'all',label:'All'},{key:'revision',label:'Revision'},{key:'exam',label:'Timed exams'},{key:'open',label:'In progress'}];
const ZONE='Asia/Karachi';
const month=(value:string)=>new Date(value).toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:ZONE});
const when=(value:string)=>new Date(value).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:ZONE});
const duration=(ms:number)=>{const m=Math.round(ms/60000);return ms<60000?`${Math.round(ms/1000)} s`:m<60?`${m} min`:`${Math.floor(m/60)} h ${String(m%60).padStart(2,'0')} min`;};
function title(r:HistoryRow) {
 if(r.paperTitle)return r.paperTitle;
 if(r.mode==='exam')return r.access==='trial'?'Mini mock':'Timed exam';
 return r.highYield?'High-yield sprint':r.latestSitting?'Latest-diet pack':r.pool==='mistakes'?'Mistakes deck':r.pool==='unanswered'?'New questions':'Revision';
}
// "How have I been doing?" Every session, newest first, scored exactly as its results report.
export default async function HistoryPage(props:PageProps<'/practice/history'>) {
 const actor=await getCurrentActor();
 if(!actor)redirect('/sign-in?next=/practice/history');if(!actor.emailVerified)redirect('/verify-email');
 if(actor.suspended)return <SuspendedNotice/>;
 const db=getDatabase();const query=await props.searchParams;
 const one=(v:string|string[]|undefined)=>typeof v==='string'?v:undefined;
 const exams=await listPracticeExams(db,actor.id);
 const filter=FILTERS.some(f=>f.key===one(query.show))?one(query.show) as HistoryFilter:'all';
 const page=Math.max(1,Number.parseInt(one(query.page)??'1',10)||1);
 const scoped=one(query.exam);
 const history=await listAttemptHistory(db,actor.id,{examId:scoped&&/^[0-9a-f-]{36}$/i.test(scoped)?scoped:undefined,filter,page});
 const examId=history.exams.some(e=>e.id===scoped)?scoped:undefined;
 const examName=history.exams.find(e=>e.id===examId)?.name;
 const href=(over:{show?:HistoryFilter;page?:number;exam?:string|null})=>{
  const p=new URLSearchParams();const e=over.exam===undefined?examId:over.exam;const s=over.show??filter;
  if(e)p.set('exam',e);if(s!=='all')p.set('show',s);if(over.page&&over.page>1)p.set('page',String(over.page));
  return `/practice/history${p.size?`?${p}`:''}`;
 };
 const {counts}=history,shown=counts[filter],pages=Math.max(1,Math.ceil(shown/history.pageSize));
 const accuracy=counts.scored?Math.round(100*counts.correct/counts.scored):null;
 const sub=[examName??(history.exams.length>1?'All exams':history.exams[0]?.name),`${counts.all} session${counts.all===1?'':'s'}`,`${counts.answered} question${counts.answered===1?'':'s'} answered`,accuracy===null?null:`${accuracy}% correct in finished sessions`].filter(Boolean).join(' · ');
 const groups=history.rows.reduce<{month:string;rows:HistoryRow[]}[]>((list,r)=>{const m=month(r.startedAt);if(list.at(-1)?.month!==m)list.push({month:m,rows:[]});list.at(-1)!.rows.push(r);return list;},[]);
 const showExam=!examId&&history.exams.length>1;
 return <StudentShell active="results" title="Sessions and results" actor={actor} exams={exams.map(e=>({id:e.id,name:e.name,access:e.access}))} examId={examId}><div className="app-column">
  <div className="app-title"><div><h1>Sessions and results</h1><p className="app-sub">{counts.all?sub:'Every session you start is kept here with its score.'}</p></div>
   <span className="title-actions"><nav className="view-tabs" aria-label="Results views"><Link href={`/practice/history${examId?`?exam=${examId}`:''}`} aria-current="page">Sessions</Link><Link href={`/practice/progress${examId?`?exam=${examId}`:''}`}>Progress</Link><Link href={`/practice/predictor${examId?`?exam=${examId}`:''}`}>Pass Predictor</Link></nav><Link className="practice-button" href={examId?`/practice?exam=${examId}`:'/practice'}>Start a session</Link></span></div>

  {history.exams.length>1&&<nav className="practice-filters" aria-label="Exam"><Link href={href({exam:null,page:1})} aria-current={!examId?'page':undefined}>All exams</Link>{history.exams.map(e=><Link key={e.id} href={href({exam:e.id,page:1})} aria-current={e.id===examId?'page':undefined}>{e.name}</Link>)}</nav>}
  {counts.all>0&&<nav className="practice-filters" aria-label="Session type">{FILTERS.map(f=><Link key={f.key} href={href({show:f.key,page:1})} aria-current={f.key===filter?'page':undefined}>{f.label} <small>{counts[f.key]}</small></Link>)}</nav>}

  <section className="sheet history" aria-labelledby="history-title"><h2 id="history-title" className="sr-only">{FILTERS.find(f=>f.key===filter)!.label} sessions</h2>
   {history.rows.length?<table className="review-table history-table">
    <thead><tr><th scope="col">Started</th><th scope="col">Session</th><th scope="col" className="num hist-answered">Answered</th><th scope="col" className="num hist-time">Time</th><th scope="col" className="num">Result</th></tr></thead>
    {groups.map(g=><tbody key={g.month}><tr className="hist-month"><th scope="rowgroup" colSpan={5}>{g.month}</th></tr>
     {g.rows.map(r=>{const link=r.finishedAt?`/practice/${r.id}/results`:`/practice/${r.id}`;return <tr key={r.id}>
      <td className="hist-when">{when(r.startedAt)}</td>
      <td><Link href={link}>{title(r)}</Link><span className="hist-meta">{[r.mode==='exam'?'Exam Mode':'Revision Mode',r.access==='trial'?'Trial':null,showExam?r.examName:null].filter(Boolean).join(' · ')}<span className="hist-phone"> · {r.answered} of {r.total} answered</span></span></td>
      <td className="num hist-answered">{r.answered} of {r.total}</td>
      <td className="num hist-time">{r.answered?duration(r.timeMs):'—'}</td>
      <td className="num">{r.finishedAt?<span className="hist-score">{r.percent===null?'—':`${r.percent}%`}{r.passed!==null&&<small className={r.passed?'is-pass':'is-below'}>{r.passed?'At or above pass mark':`Below ${r.passMark}%`}</small>}</span>
       :<Link className="hist-open" href={link}>{r.mode==='exam'?'Return to paper':'Continue'}</Link>}</td>
     </tr>;})}</tbody>)}
   </table>
   :counts.all?<p className="empty">No {filter==='open'?'sessions are in progress':`${FILTERS.find(f=>f.key===filter)!.label.toLowerCase()} sessions yet`}. <Link href={href({show:'all',page:1})}>Show all sessions</Link></p>
   :<div className="history-empty"><h2>No sessions yet.</h2><p>Start a revision session from the practice page. Each one appears here with its score, and you can open any finished session to review every answer.</p></div>}
  </section>

  {pages>1&&<nav className="history-pages" aria-label="Pages">{history.page>1?<Link href={href({page:history.page-1})}>Newer sessions</Link>:<span/>}<span>Page {history.page} of {pages}</span>{history.page<pages?<Link href={href({page:history.page+1})}>Older sessions</Link>:<span/>}</nav>}
 </div></StudentShell>;
}

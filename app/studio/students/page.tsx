import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {getStudent,listStudents,STUDENT_PAGE,type StudentFilter} from '@/lib/services/admin';
import {examOptions} from '@/lib/services/student';
import {StudioShell} from '@/components/studio/nav';
import {AccountActions,GrantForm,RevokeButton} from '@/components/studio/students';
import '../studio.css';
export const metadata={title:'Students'};
export const dynamic='force-dynamic';
const FILTERS:{key:StudentFilter;label:string}[]=[{key:'all',label:'All'},{key:'paying',label:'Paying'},{key:'trial',label:'Trial'},{key:'complimentary',label:'Complimentary'},{key:'none',label:'No access'},{key:'suspended',label:'Suspended'}];
const ACCESS:Record<string,string>={subscription:'Paid plan',trial:'Free trial',complimentary:'Complimentary',partner:'Partner'};
const date=(v:string|null)=>v?new Date(v).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'—';
const money=(cents:number)=>`$${(cents/100).toFixed(2)}`;
// ADM-3: find a student, see their plans, payments and progress, and act on the account.
export default async function StudentsPage(props:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const actor=await getCurrentActor();const access=staffAccess(actor);
 if(access==='unauthenticated')redirect('/sign-in');if(access==='unverified')redirect('/verify-email');if(access==='mfa_required')redirect('/account/security');
 if(access!=='allowed'||!actor||actor.role!=='super_admin')return <StudioShell current="students" actor={actor} title="Super Admin access required." sub="Student accounts, plans and payments are managed by a Super Admin."/>;
 const query=await props.searchParams;const str=(k:string)=>typeof query[k]==='string'?query[k] as string:'';
 const q=str('q').slice(0,200),filter=(FILTERS.find(f=>f.key===str('filter'))?.key??'all'),page=Math.max(1,Number(str('page'))||1),selected=str('student');
 const db=getDatabase();
 const [list,student,exams]=await Promise.all([listStudents(db,actor.id,{query:q,filter,page}),selected?getStudent(db,actor.id,selected).catch(()=>null):null,examOptions(db)]);
 const href=(over:Record<string,string|number|null>)=>{const p=new URLSearchParams();const v={q,filter:filter==='all'?'':filter,page:page>1?String(page):'',student:selected,...over};for(const [k,x] of Object.entries(v))if(x)p.set(k,String(x));const s=p.toString();return `/studio/students${s?`?${s}`:''}`;};
 const pages=Math.max(1,Math.ceil(list.total/STUDENT_PAGE));
 return <StudioShell current="students" actor={actor} title="Students" sub={`${list.total} ${list.total===1?'account matches':'accounts match'}${q?` “${q}”`:''}${filter!=='all'?` · ${FILTERS.find(f=>f.key===filter)!.label.toLowerCase()}`:''}.`}>
  <div className="studio-workspace"><aside className="studio-sidebar">
   <form method="get" className="students-search"><label className="studio-field">Search<input name="q" defaultValue={q} maxLength={200} placeholder="Name, email or account ID"/></label>{filter!=='all'&&<input type="hidden" name="filter" value={filter}/>}<button className="studio-button studio-button-secondary">Search</button></form>
   <nav className="studio-filters" aria-label="Filter students">{FILTERS.map(f=><Link key={f.key} href={href({filter:f.key==='all'?'':f.key,page:null,student:null})} aria-current={f.key===filter?'page':undefined}>{f.label}</Link>)}</nav>
   {list.rows.length?<ul className="studio-queue">{list.rows.map(s=><li key={s.id}><Link href={href({student:s.id})} aria-current={s.id===selected?'page':undefined}>
    <span>{s.email}</span><strong>{s.name}</strong>
    <span className="studio-queue-state"><b className={s.status==='suspended'?'is-rejected':s.access==='subscription'?'is-published':s.access?'is-approved':undefined}>{s.status==='suspended'?'Suspended':s.access?ACCESS[s.access]??s.access:'No access'}</b>{s.accessUntil?` until ${date(s.accessUntil)}`:''} · {s.answered} answered{s.verified?'':' · unverified'}</span></Link></li>)}</ul>
    :<p className="studio-help">{q||filter!=='all'?'No students match. Try a shorter search or another filter.':'No student accounts yet.'}</p>}
   {pages>1&&<nav className="students-pager" aria-label="Pages">{page>1?<Link href={href({page:page-1,student:null})}>← Newer</Link>:<span/>}<span className="studio-help">Page {page} of {pages}</span>{page<pages?<Link href={href({page:page+1,student:null})}>Older →</Link>:<span/>}</nav>}
  </aside>
  <section className="studio-main" aria-label="Student">{!student?<div className="studio-empty"><h2>{selected?'Student not found.':'Choose a student.'}</h2><p>Search by name, email or the 8-character ID from a watermark. Open a student to see their plans, payments and progress, give or extend access, send a password reset, or suspend the account.</p><p className="studio-help">Every change here is written to the audit log.</p></div>:<>
   <header className="studio-question-heading"><div><h2>{student.name}</h2><p className="studio-meta">{student.email} · joined {date(student.joinedAt)} · ID {student.id.slice(0,8)}</p></div>
    <span className="students-tags">{student.status==='suspended'&&<span className="studio-chip is-low">Suspended</span>}{!student.verified&&<span className="studio-chip is-low">Email not verified</span>}{student.twoFactor&&<span className="studio-chip is-ok">Two-step sign-in on</span>}</span></header>
   {student.status==='suspended'&&<p className="studio-feedback studio-error">Suspended: {student.suspendedReason}</p>}
   <dl className="students-facts">
    <div><dt>Country</dt><dd>{student.country||'—'}</dd></div><div><dt>Exam date</dt><dd>{student.examDate?date(student.examDate):'—'}</dd></div>
    <div><dt>Questions opened, 24 h</dt><dd>{student.views24h}</dd></div><div><dt>Open reports · alerts</dt><dd>{student.openReports} · {student.openAlerts}</dd></div>
   </dl>
   <div className="students-columns"><div>
    <section className="catalogue-panel"><h2>Progress</h2>{student.progress.length?<table className="catalogue-table"><thead><tr><th scope="col">Exam</th><th scope="col">Sessions</th><th scope="col">Answered</th><th scope="col">Correct</th><th scope="col">Last active</th></tr></thead><tbody>
     {student.progress.map(p=><tr key={p.exam}><th scope="row">{p.exam}</th><td>{p.sessions}</td><td>{p.answered}</td><td>{p.answered?`${Math.round(100*p.correct/p.answered)}%`:'—'}</td><td>{date(p.lastActiveAt)}</td></tr>)}</tbody></table>:<p className="studio-help">No practice yet.</p>}
     {student.recent.length>0&&<><h3 className="security-sub">Recent sessions</h3><ul className="studio-jobs">{student.recent.map(r=><li key={r.id} className="studio-job"><strong>{r.exam} · {r.mode==='exam'?'Timed exam':'Revision'}</strong><span>{date(r.startedAt)} · {r.answered} of {r.total} answered{r.finished?` · ${r.correct} correct`:' · in progress'}</span></li>)}</ul></>}</section>
    <section className="catalogue-panel"><h2>Payments</h2>{student.subscriptions.length?<table className="catalogue-table"><thead><tr><th scope="col">Plan</th><th scope="col">Price</th><th scope="col">Status</th><th scope="col">Period ends</th><th scope="col">Auto-renew</th></tr></thead><tbody>
     {student.subscriptions.map((s,i)=><tr key={i}><th scope="row">{s.exam}, {s.months===1?'1 month':`${s.months} months`}</th><td>{money(s.priceCents)}</td><td>{s.hold?`${s.status} · ${s.hold}`:s.status.replaceAll('_',' ')}</td><td>{date(s.periodEnd)}</td><td>{s.autoRenew?'On':'Off'}</td></tr>)}</tbody></table>
     :<p className="studio-help">No paid plans. Refunds and disputes are handled in <Link href="/studio/billing">Billing</Link>.</p>}</section>
   </div><div>
    <section className="catalogue-panel"><h2>Access</h2>{student.access.length?<table className="catalogue-table"><thead><tr><th scope="col">Exam</th><th scope="col">Source</th><th scope="col">Until</th><th scope="col"><span className="studio-sr-only">Action</span></th></tr></thead><tbody>
     {student.access.map(a=><tr key={a.id} className={a.live?undefined:'students-past'}><th scope="row">{a.exam}</th><td>{ACCESS[a.source]??a.source}</td><td>{a.revokedAt?`Revoked ${date(a.revokedAt)}`:a.live?date(a.endsAt):new Date(a.startsAt)>new Date()?`From ${date(a.startsAt)} to ${date(a.endsAt)}`:`Ended ${date(a.endsAt)}`}</td><td>{a.source==='complimentary'&&!a.revokedAt&&new Date(a.endsAt)>new Date()&&<RevokeButton entitlementId={a.id}/>}</td></tr>)}</tbody></table>:<p className="studio-help">No access yet.</p>}
     {student.trials.map(t=><p key={t.exam} className="studio-help">Free trial, {t.exam}: {t.used} of {t.limit} questions, {new Date(t.endsAt)>new Date()?`ends ${date(t.endsAt)}`:`ended ${date(t.endsAt)}`}.</p>)}
     <h3 className="security-sub">Give or extend access</h3>{student.status==='active'&&student.verified?<GrantForm userId={student.id} exams={exams}/>:<p className="studio-help">Access can be given once the account is active and verified.</p>}</section>
    <section className="catalogue-panel"><h2>Account</h2><AccountActions userId={student.id} suspended={student.status==='suspended'} verified={student.verified}/></section>
   </div></div></>}
  </section></div>
 </StudioShell>;
}

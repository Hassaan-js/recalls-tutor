import Link from 'next/link';
import {SignOutButton} from '@/components/auth/forms';
import {Mark} from '@/components/site/icons';
import '@/app/practice/practice.css';
// The student's app shell: a labelled sidebar on the ground with the mark, the exam switcher (STU-10), the
// navigation and the student at the bottom. On a phone it becomes a top bar with a menu plus a bottom tab bar,
// so every core screen is one thumb away.
export type ShellExam={id:string;name:string;access:'full'|'trial'};
type Active='practice'|'session'|'results'|'progress'|'plan'|'plans'|'profile'|'account';
const ICON:Record<Exclude<Active,'session'>,React.ReactNode>={
 practice:<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7.5h6"/>,
 progress:<path d="M4 19l5-6 4 3 7-9"/>,
 plan:<path d="M4 5.5h16v14H4zM4 9.5h16M8.5 3v4M15.5 3v4"/>,
 results:<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>,
 plans:<path d="M3.5 7.5h17v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM3.5 7.5l2-4h13l2 4M9 12h6"/>,
 profile:<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c.9-3.6 3.9-6 7.5-6s6.6 2.4 7.5 6"/>,
 account:<path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6z"/>,
};
const NAV:{key:Exclude<Active,'session'>;href:(q:string)=>string;label:string;short:string;sidebarOnly?:boolean}[]=[{key:'practice',href:q=>`/practice${q}`,label:'Practice',short:'Practice'},{key:'results',href:q=>`/practice/history${q}`,label:'Sessions and results',short:'Results'},{key:'progress',href:q=>`/practice/progress${q}`,label:'Progress',short:'Progress',sidebarOnly:true},{key:'plan',href:q=>`/practice/plan${q}`,label:'Study plan',short:'Plan',sidebarOnly:true},{key:'plans',href:()=>'/account/plans',label:'My plans',short:'Plans'},{key:'profile',href:()=>'/account/profile',label:'Profile',short:'Profile'},{key:'account',href:()=>'/account/security',label:'Account security',short:'Security'}];
function initials(name:string){return name.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]!.toUpperCase()).join('')||'?';}
export function StudentShell({active,title,actor,exams=[],examId,children}:{active:Active;title:string;actor:{name:string;email:string;role:string};exams?:ShellExam[];examId?:string;children:React.ReactNode}) {
 const q=examId?`?exam=${examId}`:'';
 const current=(key:string)=>key===active||(active==='session'&&key==='practice')?'page':undefined;
 const sidebar=<>
  <Link href="/" className="app-mark" aria-label="Recalls Tutor website"><Mark size={28}/>Recalls Tutor</Link>
  {exams.length>1&&<div className="app-group app-exams"><p className="app-group-label">Your exams</p><ul>{exams.map(e=><li key={e.id}><Link href={`/practice?exam=${e.id}`} aria-current={e.id===examId?'true':undefined}>{e.name}{e.access==='trial'&&<span className="app-tag">Trial</span>}</Link></li>)}</ul></div>}
  <nav className="app-group" aria-label="Practice"><p className="app-group-label">Study</p><ul>{NAV.map(n=><li key={n.key}><Link href={n.href(q)} aria-current={current(n.key)}>{n.label}</Link></li>)}
   {actor.role!=='student'&&<li><Link href="/studio">Content Studio</Link></li>}</ul></nav>
  <div className="app-user"><span className="app-avatar" aria-hidden="true">{initials(actor.name)}</span><span className="app-who"><strong>{actor.name}</strong><span>{actor.email}</span></span><SignOutButton/></div>
 </>;
 return <div className="app student-shell">
  <aside className="app-side" aria-label="Recalls Tutor">{sidebar}</aside>
  <details className="app-phone"><summary><span className="app-phone-title">{title}</span><span className="app-menu">Menu</span></summary><div className="app-sheet">{sidebar}</div></details>
  <main id="main" className="app-canvas">{children}</main>
  <nav className="app-bottom" aria-label="Sections">{NAV.filter(n=>!n.sidebarOnly).map(n=><Link key={n.key} href={n.href(q)} aria-current={current(n.key)??(active==='progress'&&n.key==='results'?'page':undefined)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON[n.key]}</svg>{n.short}</Link>)}</nav>
 </div>;
}

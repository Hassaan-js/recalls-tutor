import Link from 'next/link';
import {SignOutButton} from '@/components/auth/forms';
import '@/app/studio/shell.css';
import '@/app/studio/studio.css';
// The Studio uses the same app shell as practice: one sidebar on the page ground with the product mark,
// the workspace sections, the administration sections (Super Admin only), the student view and the user.
type Key='overview'|'queue'|'papers'|'catalogue'|'website'|'students'|'partners'|'billing'|'security'|'team';
const WORK:{key:Key;href:string;label:string}[]=[{key:'overview',href:'/studio/overview',label:'Overview'},{key:'queue',href:'/studio',label:'Questions'},{key:'papers',href:'/studio/papers',label:'Papers'},{key:'catalogue',href:'/studio/catalogue',label:'Exam catalogue'},{key:'website',href:'/studio/website',label:'Website'}];
const ADMIN:{key:Key;href:string;label:string}[]=[{key:'students',href:'/studio/students',label:'Students'},{key:'partners',href:'/studio/partners',label:'Partners'},{key:'billing',href:'/studio/billing',label:'Billing'},{key:'security',href:'/studio/security',label:'Content protection'},{key:'team',href:'/studio/team',label:'Team and audit log'}];
const TITLES:Record<Key,string>={overview:'Overview',students:'Students',partners:'Partners',team:'Team and audit log',queue:'Questions',papers:'Papers',catalogue:'Exam catalogue',website:'Website',billing:'Billing',security:'Content protection'};
function initials(name:string){return name.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]!.toUpperCase()).join('')||'?';}
const role=(r:string)=>r.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
export function StudioShell({current,actor,title,sub,action,children}:{current:Key;actor:{name:string;email:string;role:string}|null;title:string;sub?:React.ReactNode;action?:React.ReactNode;children?:React.ReactNode}) {
 const superAdmin=actor?.role==='super_admin';
 const link=(l:{key:Key;href:string;label:string})=><li key={l.key}><Link href={l.href} aria-current={l.key===current?'page':undefined}>{l.label}</Link></li>;
 const sidebar=<>
  <Link href="/" className="app-mark" aria-label="Recalls Tutor website"><span aria-hidden="true">r.</span>recalls<b>tutor</b></Link>
  <nav className="app-group" aria-label="Content Studio"><p className="app-group-label">Content Studio</p><ul>{WORK.map(link)}</ul></nav>
  {superAdmin&&<nav className="app-group" aria-label="Administration"><p className="app-group-label">Administration</p><ul>{ADMIN.map(link)}</ul></nav>}
  <nav className="app-group" aria-label="Student view"><p className="app-group-label">Student view</p><ul><li><Link href="/practice">Practice</Link></li><li><Link href="/account/security">Account security</Link></li></ul></nav>
  {actor&&<div className="app-user"><span className="app-avatar" aria-hidden="true">{initials(actor.name)}</span><span className="app-who"><strong>{actor.name}</strong><span>{role(actor.role)}</span></span><SignOutButton/></div>}
 </>;
 return <div className="app studio-shell">
  <aside className="app-side" aria-label="Recalls Tutor">{sidebar}</aside>
  <details className="app-phone"><summary><span className="app-phone-title">{TITLES[current]}</span><span className="app-menu">Menu</span></summary><div className="app-sheet">{sidebar}</div></details>
  <main id="main" className="app-canvas"><div className="app-column studio-page">
   <div className="app-title"><div><h1>{title}</h1>{sub&&<p className="app-sub">{sub}</p>}</div>{action}</div>
   {children}
  </div></main>
 </div>;
}

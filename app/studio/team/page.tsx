import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {listAuditLog,listTeam} from '@/lib/services/admin';
import {StudioShell} from '@/components/studio/nav';
import {RoleForm} from '@/components/studio/team';
import '../studio.css';
export const metadata={title:'Team and audit log'};
export const dynamic='force-dynamic';
const ROLE:Record<string,string>={super_admin:'Super Admin',content_manager:'Content manager',reviewer:'Reviewer'};
const AREAS:{key:string;label:string}[]=[{key:'',label:'Everything'},{key:'question',label:'Questions'},{key:'paper',label:'Papers'},{key:'entitlement',label:'Access'},{key:'account',label:'Accounts'},{key:'subscription',label:'Billing'},{key:'question_report',label:'Reports'}];
const when=(v:string)=>new Date(v).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC';
// Short, readable summary of what an entry changed; the full before and after are one click away.
function summary(before:unknown,after:unknown) {
 const pick=(v:unknown)=>v&&typeof v==='object'?Object.entries(v as Record<string,unknown>).filter(([,x])=>x!==null&&x!==''&&typeof x!=='object').slice(0,4).map(([k,x])=>`${k}: ${String(x).slice(0,60)}`).join(' · '):'';
 const b=pick(before),a=pick(after);return b&&a?`${b} → ${a}`:a||b;
}
export default async function TeamPage(props:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const actor=await getCurrentActor();const access=staffAccess(actor);
 if(access==='unauthenticated')redirect('/sign-in');if(access==='unverified')redirect('/verify-email');if(access==='mfa_required')redirect('/account/security');
 if(access!=='allowed'||!actor||actor.role!=='super_admin')return <StudioShell current="team" actor={actor} title="Super Admin access required." sub="The team, roles and the audit log are managed by a Super Admin."/>;
 const query=await props.searchParams;const area=AREAS.find(a=>a.key===query.area)?.key??'';const before=typeof query.before==='string'?query.before:'';
 const db=getDatabase();const [team,log]=await Promise.all([listTeam(db,actor.id),listAuditLog(db,actor.id,{action:area,before})]);
 const noMfa=team.filter(t=>t.role==='super_admin'&&!t.twoFactor).length;
 return <StudioShell current="team" actor={actor} title="Team and audit log" sub={`${team.length} staff ${team.length===1?'account':'accounts'}${noMfa?` · ${noMfa} Super Admin without two-step sign-in`:''}. Every change in the Studio is recorded below.`}>
  <section className="catalogue-panel"><h2>Team</h2>
   <table className="catalogue-table team-table"><thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Last action</th></tr></thead><tbody>
    {team.map(t=><tr key={t.id}><th scope="row"><strong>{t.name}</strong><span className="studio-help team-email">{t.email}{t.status==='suspended'?' · suspended':''}{!t.twoFactor&&t.role==='super_admin'?' · needs two-step sign-in':''}</span></th>
     <td>{t.id===actor.id?<>{ROLE[t.role]} <span className="studio-help">(you)</span></>:<RoleForm userId={t.id} current={t.role}/>}</td><td>{t.lastActionAt?when(t.lastActionAt):'—'}</td></tr>)}</tbody></table>
   <p className="studio-help">Reviewers check and approve drafts. Content managers also upload, publish and edit the website. Super Admins manage billing, students, protection and the team, and must use two-step sign-in.</p><h3 className="security-sub">Add a team member</h3><RoleForm/></section>
  <section className="catalogue-panel"><h2>Audit log <small className="studio-help">latest 100{area?` · ${AREAS.find(a=>a.key===area)!.label.toLowerCase()}`:''}</small></h2>
   <nav className="studio-filters" aria-label="Filter the audit log">{AREAS.map(a=><Link key={a.key} href={a.key?`/studio/team?area=${a.key}`:'/studio/team'} aria-current={a.key===area?'page':undefined}>{a.label}</Link>)}</nav>
   {log.length?<table className="catalogue-table audit-table"><thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Details</th></tr></thead><tbody>
    {log.map(l=><tr key={l.id}><td>{when(l.at)}</td><td>{l.actor}</td><td><code>{l.action}</code></td><td><details><summary>{summary(l.before,l.after)||`Record ${l.entityId.slice(0,8)}`}</summary><pre>{JSON.stringify({record:l.entityId,before:l.before,after:l.after},null,2)}</pre></details></td></tr>)}</tbody></table>
    :<p className="studio-help">No entries{area?' in this area':''} yet.</p>}
   {log.length===100&&<Link className="studio-link-button" href={`/studio/team?${new URLSearchParams({...(area?{area}:{}),before:log[log.length-1].at})}`}>Older entries →</Link>}</section>
 </StudioShell>;
}

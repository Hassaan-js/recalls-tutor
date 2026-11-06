import Link from 'next/link';
import {redirect} from 'next/navigation';
import {SignOutButton} from '@/components/auth/forms';
import {getCurrentActor} from '@/lib/auth/session';
import {getDatabase} from '@/lib/db/client';
import {partnerMemberships,requirePartnerAdmin,type Membership} from '@/lib/services/partners';
import '@/app/studio/shell.css';
import '@/app/studio/studio.css';
import '@/app/partner/partner.css';
// PART-3 Partner Portal. It shares the Studio's app shell and controls; a partner admin sees only their organisation.
export type PartnerKey='overview'|'students'|'links'|'developers'|'billing';
const NAV:{key:PartnerKey;href:string;label:string}[]=[{key:'overview',href:'/partner',label:'Overview'},{key:'students',href:'/partner/students',label:'Students and seats'},{key:'links',href:'/partner/links',label:'Invite links'},{key:'billing',href:'/partner/billing',label:'Purchases and invoices'},{key:'developers',href:'/partner/developers',label:'API and webhooks'}];
type Actor=NonNullable<Awaited<ReturnType<typeof getCurrentActor>>>;
export type PartnerContext={actor:Actor;org:Membership;orgs:{id:string;name:string}[];q:string};
function initials(name:string){return name.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]!.toUpperCase()).join('')||'?';}
// Resolves the signed-in partner admin and the organisation chosen with ?org= (the first one by default).
export async function partnerContext(path:string,search:Record<string,string|string[]|undefined>):Promise<PartnerContext|null> {
 const actor=await getCurrentActor();
 if(!actor)redirect(`/sign-in?next=${encodeURIComponent(path)}`);
 if(!actor.emailVerified)redirect('/verify-email');
 if(actor.suspended)return null;
 const db=getDatabase(),orgs=await partnerMemberships(db,actor.id);
 if(!orgs.length)return null;
 const wanted=typeof search.org==='string'?orgs.find(o=>o.id===search.org):undefined,chosen=wanted??orgs[0];
 const org=await requirePartnerAdmin(db,actor.id,chosen.id);
 return {actor,org,orgs,q:orgs.length>1?`?org=${org.id}`:''};
}
export function NotPartner() {
 return <main id="main" className="partner-empty"><div><h1>Partner Portal</h1><p>This account is not a partner admin. If your organisation works with Recalls Tutor, ask us to add this email address as an admin.</p><p><Link href="/practice">Go to practice</Link> · <Link href="/contact">Contact us</Link></p></div></main>;
}
const STATUS:Record<string,string>={pending:'Waiting for approval: you can set up a sandbox integration now, and assign seats once Recalls Tutor approves the account.',suspended:'This partner account is suspended. Students keep the access they have; new seats, links and live API requests are paused. Contact Recalls Tutor.'};
export function PartnerShell({ctx,current,title,sub,action,children}:{ctx:PartnerContext;current:PartnerKey;title:string;sub?:React.ReactNode;action?:React.ReactNode;children:React.ReactNode}) {
 const link=(l:{key:PartnerKey;href:string;label:string})=><li key={l.key}><Link href={`${l.href}${ctx.q}`} aria-current={l.key===current?'page':undefined}>{l.label}</Link></li>;
 const sidebar=<>
  <Link href="/" className="app-mark" aria-label="Recalls Tutor website"><span aria-hidden="true">r.</span>recalls<b>tutor</b></Link>
  <nav className="app-group" aria-label="Partner Portal"><p className="app-group-label">{ctx.org.name}</p><ul>{NAV.map(link)}</ul></nav>
  {ctx.orgs.length>1&&<nav className="app-group" aria-label="Your organisations"><p className="app-group-label">Switch organisation</p><ul>{ctx.orgs.filter(o=>o.id!==ctx.org.id).map(o=><li key={o.id}><Link href={`/partner?org=${o.id}`}>{o.name}</Link></li>)}</ul></nav>}
  <nav className="app-group" aria-label="Your account"><p className="app-group-label">Your account</p><ul><li><Link href="/practice">Practice</Link></li><li><Link href="/account/security">Account security</Link></li></ul></nav>
  <div className="app-user"><span className="app-avatar" aria-hidden="true">{initials(ctx.actor.name)}</span><span className="app-who"><strong>{ctx.actor.name}</strong><span>Partner admin</span></span><SignOutButton/></div>
 </>;
 return <div className="app studio-shell partner-shell">
  <aside className="app-side" aria-label="Recalls Tutor">{sidebar}</aside>
  <details className="app-phone"><summary><span className="app-phone-title">{NAV.find(n=>n.key===current)!.label}</span><span className="app-menu">Menu</span></summary><div className="app-sheet">{sidebar}</div></details>
  <main id="main" className="app-canvas"><div className="app-column studio-page">
   <div className="app-title"><div><h1>{title}</h1>{sub&&<p className="app-sub">{sub}</p>}</div>{action}</div>
   {STATUS[ctx.org.status]&&<p className={`partner-banner partner-banner-${ctx.org.status}`} role="status">{STATUS[ctx.org.status]}</p>}
   {children}
  </div></main>
 </div>;
}

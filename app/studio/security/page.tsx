import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {getProtectionSettings,listSecurityAlerts,traceAccount,type TracedAccount} from '@/lib/services/protection';
import {AlertList,ProtectionForm,TraceResults} from '@/components/studio/security';
import {StudioShell} from '@/components/studio/nav';
import '../studio.css';
export const metadata={title:'Content protection'};
export const dynamic='force-dynamic';
export default async function SecurityPage(props:PageProps<'/studio/security'>) {
 const actor=await getCurrentActor();const access=staffAccess(actor);
 if(access==='unauthenticated')redirect('/sign-in');if(access==='unverified')redirect('/verify-email');if(access==='mfa_required')redirect('/account/security');
 if(access!=='allowed'||!actor||actor.role!=='super_admin')return <StudioShell current="security" actor={actor} title="Super Admin access required." sub="Content protection, alerts and account suspension are managed by a Super Admin."/>;
 const db=getDatabase();const query=await props.searchParams;const trace=typeof query.trace==='string'?query.trace.slice(0,200):'';
 let traced:TracedAccount[]=[],traceError='';
 if(trace)traced=await traceAccount(db,actor.id,trace).catch((error:Error)=>{traceError=error.message;return [];});
 const [settings,alerts]=await Promise.all([getProtectionSettings(db),listSecurityAlerts(db,actor.id)]);
 return <StudioShell current="security" actor={actor} title="Content protection" sub="Rate limits, scraping alerts and leak tracing. Browser measures only slow casual copying; these are the real controls.">
  <div className="catalogue-columns"><div>
   <section className="catalogue-panel"><h2>Open alerts <small className="studio-help">{alerts.length}</small></h2><AlertList alerts={alerts}/></section>
   <section className="catalogue-panel"><h2>Trace a leak</h2><p className="studio-help">Every practice screen carries a faint watermark with the student’s email and the first 8 characters of their account ID. Enter either to find the account.</p>
    <form method="get" className="catalogue-inline"><label className="studio-field">Email or watermark ID<input name="trace" defaultValue={trace} maxLength={200} placeholder="An email address or the 8-character ID"/></label><button className="studio-button studio-button-secondary">Find account</button></form>
    {traceError?<p className="studio-feedback studio-error" role="alert">{traceError}</p>:<TraceResults accounts={traced} query={trace}/>}</section></div>
   <section className="catalogue-panel"><h2>Limits</h2><ProtectionForm settings={settings}/>
    <h3 className="security-sub">Always on</h3><ul className="security-facts"><li>One question per request; no endpoint returns the bank.</li><li>Unpublished questions are never delivered.</li><li>Watermark on every question, text selection, copying, right-click and dragging blocked, practice pages hidden from print.</li><li>Suspending an account signs it out everywhere and blocks sign-in.</li></ul></section></div>
 </StudioShell>;
}

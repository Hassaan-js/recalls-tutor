import {getDatabase} from '@/lib/db/client';
import {listInviteLinks,listProducts} from '@/lib/services/partners';
import {NotPartner,PartnerShell,partnerContext} from '@/components/partner/shell';
import {LinkForm,TurnOffLink} from '@/components/partner/forms';
import {day} from '@/components/partner/format';
export const metadata={title:'Invite links',robots:{index:false}};
export const dynamic='force-dynamic';
// PART-3: a shareable link with a seat cap. Each student who opens it, signs in and claims it uses one seat.
export default async function PartnerLinks(props:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const ctx=await partnerContext('/partner/links',await props.searchParams);
 if(!ctx)return <NotPartner/>;
 const db=getDatabase();
 const [products,links]=await Promise.all([listProducts(db,ctx.org.id),listInviteLinks(db,ctx.org.id)]);
 return <PartnerShell ctx={ctx} current="links" title="Invite links" sub="Share one link with a group. Each student signs in or creates an account, claims a seat, and gets access straight away, until the cap is reached or the link expires.">
  <div className="students-columns">
   <section className="catalogue-panel" aria-labelledby="new-link"><h2 id="new-link">New invite link</h2>
    <LinkForm orgId={ctx.org.id} products={products.map(p=>({value:`${p.examId}:${p.months}`,label:`${p.exam}, ${p.months} months`}))} disabled={ctx.org.status!=='active'||!products.length}/></section>
   <section className="catalogue-panel" aria-labelledby="links-title"><h2 id="links-title">Your links</h2>
    {links.length?<div className="partner-scroll"><table className="catalogue-table"><thead><tr><th scope="col">Link</th><th scope="col">Claimed</th><th scope="col">Works until</th><th scope="col"><span className="studio-sr-only">Actions</span></th></tr></thead><tbody>
     {links.map(l=><tr key={l.id}><th scope="row">{l.label||'Untitled link'}<span className="studio-help team-email">{l.exam}, {l.months} months</span></th><td>{l.used} of {l.cap}</td>
      <td>{l.revoked_at?`Turned off ${day(l.revoked_at)}`:day(l.expires_at)}</td><td>{l.live?<TurnOffLink orgId={ctx.org.id} id={l.id}/>:<span className="partner-state partner-state-expired">{l.revoked_at?'Off':l.used>=l.cap?'Full':'Expired'}</span>}</td></tr>)}</tbody></table></div>
     :<p className="studio-empty">No invite links yet.</p>}
    <p className="studio-help">A link is shown once, when you create it. If you lose one, turn it off and make a new one.</p></section>
  </div>
 </PartnerShell>;
}

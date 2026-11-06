import Link from 'next/link';
import {getDatabase} from '@/lib/db/client';
import {listEnrollments,listProducts} from '@/lib/services/partners';
import {NotPartner,PartnerShell,partnerContext} from '@/components/partner/shell';
import {AssignForm,SeatActions} from '@/components/partner/forms';
import {day,STATE} from '@/components/partner/format';
export const metadata={title:'Students and seats',robots:{index:false}};
export const dynamic='force-dynamic';
const FILTERS:[string,string][]=[['','All'],['invited','Invited'],['active','Active'],['expired','Expired'],['revoked','Revoked']];
const PAGE=50;
const SOURCE:Record<string,string>={api:'API',csv:'CSV',link:'Invite link',portal:'Portal'};
export default async function PartnerStudents(props:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const search=await props.searchParams;
 const ctx=await partnerContext('/partner/students',search);
 if(!ctx)return <NotPartner/>;
 const db=getDatabase();
 const status=typeof search.status==='string'&&FILTERS.some(([k])=>k===search.status)?search.status:'',q=typeof search.q==='string'?search.q.slice(0,254):'',page=Math.max(1,Number(search.page)||1);
 const [products,list]=await Promise.all([listProducts(db,ctx.org.id),listEnrollments(db,ctx.org.id,{status,email:q,limit:PAGE,offset:(page-1)*PAGE})]);
 const months=new Map<string,number[]>();for(const p of products)months.set(p.exam,[...(months.get(p.exam)??[]),p.months]);
 const params=(over:Record<string,string>)=>{const p=new URLSearchParams({...(ctx.orgs.length>1?{org:ctx.org.id}:{}),...(status?{status}:{}),...(q?{q}:{}),...over});for(const [k,v] of [...p])if(!v)p.delete(k);const s=p.toString();return s?`?${s}`:'';};
 const writable=ctx.org.status==='active'&&products.length>0;
 return <PartnerShell ctx={ctx} current="students" title="Students and seats" sub={`${list.total} ${list.total===1?'enrolment':'enrolments'}${status?` · ${STATE[status].toLowerCase()}`:''}. Students who already have a Recalls Tutor account get access at once; others are emailed an invitation, and their seat starts when they first sign in.`}>
  <div className="students-columns">
   <section className="catalogue-panel" aria-labelledby="assign-title"><h2 id="assign-title">Assign seats</h2>
    <AssignForm orgId={ctx.org.id} products={products.map(p=>({value:`${p.examId}:${p.months}`,label:`${p.exam}, ${p.months} months`}))} disabled={!writable}/>
    <p className="studio-help">A seat you revoke before the student activates it goes back to your balance.</p></section>
   <section className="catalogue-panel" aria-labelledby="list-title"><h2 id="list-title">Enrolments</h2>
    <form className="students-search" role="search">{ctx.orgs.length>1&&<input type="hidden" name="org" value={ctx.org.id}/>}{status&&<input type="hidden" name="status" value={status}/>}
     <label className="studio-field"><span className="studio-sr-only">Search by email or your reference</span><input name="q" type="search" defaultValue={q} placeholder="Search by email or your reference"/></label><button className="studio-button studio-button-secondary">Search</button></form>
    <nav className="studio-filters" aria-label="Filter enrolments">{FILTERS.map(([k,l])=><Link key={k} href={`/partner/students${params({status:k,page:''})}`} aria-current={k===status?'page':undefined}>{l}</Link>)}</nav>
    {list.data.length?<div className="partner-scroll"><table className="catalogue-table"><thead><tr><th scope="col">Student</th><th scope="col">Status</th><th scope="col">Access</th><th scope="col"><span className="studio-sr-only">Actions</span></th></tr></thead><tbody>
     {list.data.map(e=><tr key={e.id}><th scope="row">{e.email}<span className="studio-help team-email">{e.exam.name}, {e.months} months · {SOURCE[e.source]}{e.external_ref?` · ${e.external_ref}`:''}</span></th>
      <td><span className={`partner-state partner-state-${e.status}`}>{STATE[e.status]}</span></td>
      <td>{e.status==='invited'?`Assigned ${day(e.created_at)}`:e.status==='revoked'?`Revoked ${day(e.revoked_at)}`:`${day(e.activated_at)} to ${day(e.access_ends_at)}`}</td>
      <td>{ctx.org.status==='active'&&<SeatActions orgId={ctx.org.id} id={e.id} status={e.status} products={months.get(e.exam.name)??[]}/>}</td></tr>)}</tbody></table></div>
     :<p className="studio-empty">{q||status?'No enrolments match.':'No seats assigned yet.'}</p>}
    {list.total>PAGE&&<p className="students-pager">{page>1&&<Link href={`/partner/students${params({page:String(page-1)})}`}>← Newer</Link>} Page {page} of {Math.ceil(list.total/PAGE)} {page*PAGE<list.total&&<Link href={`/partner/students${params({page:String(page+1)})}`}>Older →</Link>}</p>}
   </section>
  </div>
 </PartnerShell>;
}

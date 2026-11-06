import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {getWebsiteAdmin} from '@/lib/services/site';
import {FaqEditor,MetaEditor,PageEditor,RedirectEditor} from '@/components/studio/website';
import {BlogEditor} from '@/components/studio/blog';
import {listPostsAdmin} from '@/lib/services/content-site';
import {StudioShell} from '@/components/studio/nav';
import '../studio.css';
export const metadata={title:'Website'};
export const dynamic='force-dynamic';
export default async function WebsitePage(props:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const actor=await getCurrentActor();const access=staffAccess(actor);
 if(access==='unauthenticated')redirect('/sign-in');if(access==='unverified')redirect('/verify-email');if(access==='mfa_required')redirect('/account/security');
 if(access!=='allowed'||!actor)return <StudioShell current="website" actor={actor} title="Staff access required."/>;
 const shell={current:'website',title:'Website',sub:'Search titles and descriptions, company and policy pages, FAQs and redirects. Changes go live immediately.'} as const;
 if(actor.role==='reviewer')return <StudioShell {...shell} actor={actor}><p className="studio-help">The website is edited by content managers.</p></StudioShell>;
 const data=await getWebsiteAdmin(getDatabase(),actor.id);
 const posts=await listPostsAdmin(getDatabase(),actor.id);const q=await props.searchParams;
 const post=typeof q.post==='string'?posts.find(p=>p.id===q.post)??null:null;
 const sittings=await getDatabase().query<{id:string;examId:string;label:string}>('SELECT id,exam_id AS "examId",label FROM sittings WHERE published ORDER BY year DESC,month DESC NULLS LAST');
 return <StudioShell {...shell} actor={actor}>
  <p className="studio-help website-intro">Exam and sitting pages are created automatically from the exam catalogue. A sitting gets its own page when “On website” is switched on. <a href="/sitemap.xml" target="_blank" rel="noreferrer">View sitemap ↗</a></p>
  <div className="catalogue-columns"><div><section className="catalogue-panel"><h2>Search appearance</h2><MetaEditor pages={data.pages}/></section>
   <section className="catalogue-panel"><h2>Redirects</h2><RedirectEditor redirects={data.redirects}/></section></div>
   <div><section className="catalogue-panel"><h2>Company and policy pages</h2><PageEditor pages={data.sitePages}/></section>
    <section className="catalogue-panel"><h2>FAQs</h2><FaqEditor faqs={data.faqs} exams={data.exams.map(e=>({id:e.id,name:e.name}))}/></section></div></div>
  <section className="catalogue-panel" id="blog" aria-labelledby="blog-title"><h2 id="blog-title">Blog and guides</h2><BlogEditor posts={posts} post={post} isNew={q.post==='new'} exams={data.exams.map(e=>({id:e.id,name:e.name,sittings:sittings.filter(s=>s.examId===e.id).map(s=>({id:s.id,label:s.label}))}))}/></section>
 </StudioShell>;
}

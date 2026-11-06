import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound,permanentRedirect} from 'next/navigation';
import {getDatabase} from '@/lib/db/client';
import {examPath,findRedirect,getFamilyPage} from '@/lib/services/site';
import {pageHeading,pageMetadata,siteUrl} from '@/lib/seo';
import {JsonLd,breadcrumbs} from '@/components/seo/json-ld';
import {ArrowRight} from '@/components/site/icons';
const TONES=['tab-blue','tab-teal','tab-sky','tab-amber','tab-violet'];
export const dynamic='force-dynamic';
type Props={params:Promise<{family:string}>};
export async function generateMetadata({params}:Props):Promise<Metadata> {
 const {family}=await params;const page=await getFamilyPage(getDatabase(),family);
 if(!page)return {title:'Page not found'};
 return pageMetadata(`/${page.slug}`,{title:`${page.name} Recalls — Question Banks by Exam`,description:`Reviewed ${page.name} recall questions from real exam sittings, organised by exam and sitting, with explanations and references.`});
}
export default async function FamilyPage({params}:Props) {
 const {family}=await params;const db=getDatabase();const page=await getFamilyPage(db,family);
 if(!page){const to=await findRedirect(db,`/${family}`);if(to)permanentRedirect(to);notFound();}
 const h1=await pageHeading(`/${page.slug}`,`${page.name} recalls`);
 return <main id="main" className="hb">
  <JsonLd data={breadcrumbs([{name:'Home',path:'/'},{name:page.name,path:`/${page.slug}`}],siteUrl())}/>
  <section className="pg-hero" aria-labelledby="family-title"><div className="wrap">
   <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><span aria-current="page">{page.name}</span></nav>
   <h1 id="family-title">{h1}</h1><p className="intro">Practise the questions students shared after recent {page.name} sittings. We collect them from study groups, compile them into complete questions and review each one before it is published.</p>
  </div></section>
  <section className="hb-sec wrap" aria-labelledby="desc-title"><div className="head"><h2 id="desc-title">The {page.name} exams</h2><p>Every {page.name} question starts with what students shared after their exam, and ends with a review before it is published.</p></div>
   <ul className="shelf">{page.exams.map((e,i)=><li key={e.id}><Link href={examPath(page.slug,e.seoSlug)} className={TONES[i%TONES.length]}><span className="fam">{page.name}</span><h3>{e.name}</h3><p>{e.description}</p>
    <span className="facts">{e.questionCount>0?<span className="ticket">{e.questionCount} reviewed questions</span>:<span className="ticket">In preparation</span>}{e.sittings>0&&<span className="ticket">{e.sittings} sitting{e.sittings===1?'':'s'}</span>}{e.trial&&<span className="ticket">Free trial</span>}</span>
    <span className="go">See {e.name}<ArrowRight /></span></Link></li>)}</ul></section>
 </main>;
}
